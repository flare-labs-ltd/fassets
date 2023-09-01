// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interface/IICollateralPoolToken.sol";
import "../interface/IICollateralPool.sol";


contract CollateralPoolToken is IICollateralPoolToken, ERC20 {
    address public immutable collateralPool;
    mapping(address => uint256[]) internal timelockedAmounts;
    mapping(address => uint256[]) internal timelockedEndTimes;
    bool private ignoreTimelocked;

    modifier onlyCollateralPool {
        require(msg.sender == collateralPool, "only collateral pool");
        _;
    }

    constructor(address payable _collateralPool)
        ERC20("FAsset Collateral Pool Token", "FCPT")
    {
        collateralPool = _collateralPool;
    }

    function mint(
        address _account,
        uint256 _amount
    )
        external
        onlyCollateralPool
    {
        _mint(_account, _amount);
        uint256 timelockDuration = _getTimelockDuration();
        if (timelockDuration > 0 && _amount > 0) {
            uint256[] storage amounts = timelockedAmounts[_account];
            timelockedEndTimes[_account].push(block.timestamp + timelockDuration);
            amounts.push(_amount);
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
        uint256[] storage amounts = timelockedAmounts[_account];
        uint256[] storage endTimes = timelockedEndTimes[_account];
        for (uint256 i = 0; i < amounts.length; i++) {
            if (endTimes[i] > block.timestamp) {
                _timelocked += amounts[i];
            }
        }
    }

    function nonTimelockedBalanceOf(
        address _account
    )
        public view
        returns (uint256)
    {
        uint256 totalBalance = balanceOf(_account);
        uint256 timelocked = timelockedBalanceOf(_account);
        // in agent payout, locked tokens can be burnt without an update
        return (totalBalance > timelocked) ? totalBalance - timelocked : 0;
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
            uint256 timelocked = getAndUpdateTimelockedBalanceOf(_from, type(uint256).max);
            uint256 nonTimelocked = balanceOf(_from) - timelocked;
            require(_amount <= nonTimelocked, "insufficient non-timelocked balance");
        }
    }

    // this can be called externally by anyone with different _maxTimelockedEntries,
    // if there are too many timelocked entries to clear in one transaction
    // (should be rare, especially if timelock duration is short - e.g. <= day)
    function getAndUpdateTimelockedBalanceOf(
        address _account, uint256 _maxTimelockedEntries
    )
        public
        returns (uint256 _timelocked)
    {
        uint256[] storage endTimes = timelockedEndTimes[_account];
        uint256[] storage amounts = timelockedAmounts[_account];
        uint256 i = 0;
        while (i < endTimes.length && i < _maxTimelockedEntries) {
            if (endTimes[i] <= block.timestamp) {
                endTimes[i] = endTimes[endTimes.length - 1];
                amounts[i] = amounts[amounts.length - 1];
                endTimes.pop();
                amounts.pop();
            } else {
                _timelocked += amounts[i];
                i++;
            }
        }
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
}
