// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IICollateralPoolToken.sol";
import "../interfaces/IICollateralPool.sol";


contract CollateralPoolToken is IICollateralPoolToken, ERC20, UUPSUpgradeable {
    using SafeCast for uint256;

    struct Timelock {
        uint128 amount;
        uint64 endTime;
    }

    struct TimelockQueue {
        mapping(uint256 => Timelock) data;
        uint128 start;
        uint128 end;
    }

    address public collateralPool;  // practically immutable because there is no setter

    string private tokenName;       // practically immutable because there is no setter
    string private tokenSymbol;     // practically immutable because there is no setter

    mapping(address => TimelockQueue) private timelocksByAccount;
    bool private ignoreTimelocked;
    bool private initialized;

    modifier onlyCollateralPool {
        require(msg.sender == collateralPool, "only collateral pool");
        _;
    }

    // Only used in some tests.
    // The implementation in production will always be deployed with all zero address for collateral pool.
    constructor(
        address _collateralPool,
        string memory _tokenName,
        string memory _tokenSymbol
    )
        ERC20(_tokenName, _tokenSymbol)
    {
        initialize(_collateralPool, _tokenName, _tokenSymbol);
    }

    function initialize(
        address _collateralPool,
        string memory _tokenName,
        string memory _tokenSymbol
    )
        public
    {
        require(!initialized, "already initialized");
        initialized = true;
        // init vars
        collateralPool = _collateralPool;
        tokenName = _tokenName;
        tokenSymbol = _tokenSymbol;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return tokenName;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return tokenSymbol;
    }

    function mint(
        address _account,
        uint256 _amount
    )
        external
        onlyCollateralPool
        returns (uint256 _timelockExpiresAt)
    {
        _mint(_account, _amount);
        uint256 timelockDuration = _getTimelockDuration();
        _timelockExpiresAt = block.timestamp + timelockDuration;
        if (timelockDuration > 0 && _amount > 0) {
            TimelockQueue storage timelocks = timelocksByAccount[_account];
            timelocks.data[timelocks.end++] = Timelock({
                amount: _amount.toUint128(),
                endTime: _timelockExpiresAt.toUint64()
            });
        }
    }

    function burn(
        address _account,
        uint256 _amount,
        bool _ignoreTimelocked
    )
        external
        onlyCollateralPool
    {
        if (_ignoreTimelocked) {
            ignoreTimelocked = true;
        }
        _burn(_account, _amount);
        if (_ignoreTimelocked) {
            ignoreTimelocked = false;
        }
    }

    function destroy(
        address payable _recipient
    )
        external
        onlyCollateralPool
    {
        // do nothing since selfdestruct is deprecated
    }

    function lockedBalanceOf(
        address _account
    )
        external view
        returns (uint256)
    {
        uint256 debtLockedBalance = debtLockedBalanceOf(_account);
        uint256 timelockedBalance = timelockedBalanceOf(_account);
        return (debtLockedBalance > timelockedBalance) ? debtLockedBalance : timelockedBalance;
    }

    function transferableBalanceOf(
        address _account
    )
        external view
        returns (uint256)
    {
        uint256 debtFreeBalance = debtFreeBalanceOf(_account);
        uint256 nonTimelockedBalance = nonTimelockedBalanceOf(_account);
        return (debtFreeBalance < nonTimelockedBalance) ? debtFreeBalance : nonTimelockedBalance;
    }

    function debtFreeBalanceOf(
        address _account
    )
        public view
        returns (uint256)
    {
        return IICollateralPool(collateralPool).debtFreeTokensOf(_account);
    }

    function debtLockedBalanceOf(
        address _account
    )
        public view
        returns (uint256)
    {
        return IICollateralPool(collateralPool).debtLockedTokensOf(_account);
    }

    function timelockedBalanceOf(
        address _account
    )
        public view
        returns (uint256 _timelocked)
    {
        TimelockQueue storage timelocks = timelocksByAccount[_account];
        uint256 end = timelocks.end;
        for (uint256 i = timelocks.start; i < end; i++) {
            Timelock storage timelock = timelocks.data[i];
            if (timelock.endTime > block.timestamp) {
                _timelocked += timelock.amount;
            }
        }
        // in agent payout, locked tokens can be burnt without a timelock update,
        // which makes timelockedBalance > totalBalance
        uint256 totalBalance = balanceOf(_account);
        _timelocked = (_timelocked < totalBalance) ? _timelocked : totalBalance;
    }

    function nonTimelockedBalanceOf(
        address _account
    )
        public view
        returns (uint256)
    {
        return balanceOf(_account) - timelockedBalanceOf(_account);
    }

    function _beforeTokenTransfer(
        address _from, address /* _to */, uint256 _amount
    )
        internal override
    {
        if (msg.sender != collateralPool) {
            uint256 transferable = debtFreeBalanceOf(_from);
            require(_amount <= transferable, "insufficient transferable balance");
        }
        // either user transfer or non-minting collateral pool with ignoreTimelocked=false flag
        if (!ignoreTimelocked && _from != address(0)) {
            // 10 is some arbitrary number that is usually enough; however, there isn't much damage
            // if it is too little - just the non-timelocked balance may be too small and you have to call again
            cleanupExpiredTimelocks(_from, 10);
            uint256 nonTimelocked = nonTimelockedBalanceOf(_from);
            require(_amount <= nonTimelocked, "insufficient non-timelocked balance");
        }
        // if ignoreTimelock, then we are spending from timelocked balance,
        // the reason why it is not updated is because it might not fit in one transaction
        // (if timelock data is too large), which could block the asset manager from making
        // agent payout from the pool
    }

    // this can be called externally by anyone with different _maxTimelockedEntries,
    // if there are too many timelocked entries to clear in one transaction
    // (should be rare, especially if timelock duration is short - e.g. <= day)
    function cleanupExpiredTimelocks(
        address _account,
        uint256 _maxTimelockedEntries
    )
        public
        returns (bool _cleanedAllExpired)
    {
        TimelockQueue storage timelocks = timelocksByAccount[_account];
        uint256 start = timelocks.start;
        for (uint256 count = 0; count < _maxTimelockedEntries; count++) {
            if (start >= timelocks.end || timelocks.data[start].endTime > block.timestamp) {
                break;
            }
            delete timelocks.data[start++];
        }
        timelocks.start = start.toUint128();
        return start >= timelocks.end || timelocks.data[start].endTime > block.timestamp;
    }

    function _getTimelockDuration()
        internal view
        returns (uint256)
    {
        IIAssetManager assetManager = IICollateralPool(collateralPool).assetManager();
        return assetManager.getCollateralPoolTokenTimelockSeconds();
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IERC20).interfaceId
            || _interfaceId == type(ICollateralPoolToken).interfaceId;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // UUPS proxy upgrade

    function implementation() external view returns (address) {
        return _getImplementation();
    }

    /**
     * Upgrade calls can only arrive through asset manager.
     * See UUPSUpgradeable._authorizeUpgrade.
     */
    function _authorizeUpgrade(address /* _newImplementation */)
        internal virtual override
    {
        IIAssetManager assetManager = IICollateralPool(collateralPool).assetManager();
        require(msg.sender == address(assetManager), "only asset manager");
    }
}
