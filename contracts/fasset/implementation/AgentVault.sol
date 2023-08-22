// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../userInterfaces/ICollateralPool.sol";
import "../interface/IWNat.sol";
import "../interface/IIAgentVault.sol";
import "../interface/IIAssetManager.sol";


contract AgentVault is ReentrancyGuard, IIAgentVault, IERC165 {
    using SafeERC20 for IERC20;

    IIAssetManager public immutable assetManager;

    IERC20[] private usedTokens;

    mapping(IERC20 => uint256) private tokenUseFlags;

    IWNat public wNat;

    bool private internalWithdrawal;

    uint256 private constant TOKEN_DEPOSIT = 1;
    uint256 private constant TOKEN_DELEGATE = 2;
    uint256 private constant TOKEN_DELEGATE_GOVERNANCE = 4;

    modifier onlyOwner {
        require(isOwner(msg.sender), "only owner");
        _;
    }

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    constructor(IIAssetManager _assetManager) {
        assetManager = _assetManager;
        wNat = _assetManager.getWNat();
    }

    // needed to allow wNat.withdraw() to send back funds, since there is no withdrawTo()
    receive() external payable {
        require(internalWithdrawal, "internal use only");
    }

    // only supposed to be used from asset manager, but safe to be used by anybody
    function depositNat() external payable override {
        wNat.deposit{value: msg.value}();
        assetManager.updateCollateral(address(this), wNat);
        _tokenUsed(wNat, TOKEN_DEPOSIT);
    }

    // without "onlyOwner" to allow owner to send funds from any source
    function buyCollateralPoolTokens()
        external payable
    {
        collateralPool().enter{value: msg.value}(0, false);
    }

    function withdrawPoolFees(uint256 _amount, address _recipient)
        external
        onlyOwner
    {
        collateralPool().withdrawFees(_amount);
        assetManager.fAsset().safeTransfer(_recipient, _amount);
    }

    function redeemCollateralPoolTokens(uint256 _amount, address payable _recipient)
        external
        onlyOwner
    {
        ICollateralPool pool = collateralPool();
        assetManager.withdrawCollateral(pool.poolToken(), _amount);
        (uint256 natShare, uint256 fassetShare) =
            pool.exit(_amount, ICollateralPool.TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
        _withdrawWNatTo(_recipient, natShare);
        assetManager.fAsset().safeTransfer(_recipient, fassetShare);
    }

    // must call `token.approve(vault, amount)` before for each token in _tokens
    function depositCollateral(IERC20 _token, uint256 _amount)
        external override
    {
        _token.safeTransferFrom(msg.sender, address(this), _amount);
        assetManager.updateCollateral(address(this), _token);
        _tokenUsed(_token, TOKEN_DEPOSIT);
    }

    // update collateral after `transfer(vault, some amount)` was called (alternative to depositCollateral)
    function updateCollateral(IERC20 _token)
        external
    {
        assetManager.updateCollateral(address(this), _token);
        _tokenUsed(_token, TOKEN_DEPOSIT);
    }

    function withdrawCollateral(IERC20 _token, uint256 _amount, address _recipient)
        external override
        onlyOwner
        nonReentrant
    {
        // check that enough was announced and reduce announcement
        assetManager.withdrawCollateral(_token, _amount);
        // transfer tokens to recipient
        _token.safeTransfer(_recipient, _amount);
    }

    // Allow transferring a token, airdropped to the agent vault, to the owner (management address).
    // Doesn't work for collateral tokens because this would allow withdrawing the locked collateral.
    function transferExternalToken(IERC20 _token, uint256 _amount)
        external override
        onlyOwner
        nonReentrant
    {
        require(!assetManager.isLockedVaultToken(address(this), _token), "only non-collateral tokens");
        (address ownerManagementAddress,) = assetManager.getAgentVaultOwner(address(this));
        _token.safeTransfer(ownerManagementAddress, _amount);
    }

    function delegate(IVPToken _token, address _to, uint256 _bips) external override onlyOwner {
        _token.delegate(_to, _bips);
        _tokenUsed(_token, TOKEN_DELEGATE);
    }

    function undelegateAll(IVPToken _token) external override onlyOwner {
        _token.undelegateAll();
    }

    function revokeDelegationAt(IVPToken _token, address _who, uint256 _blockNumber) external override onlyOwner {
        _token.revokeDelegationAt(_who, _blockNumber);
    }

    function delegateGovernance(address _to) external override onlyOwner {
        wNat.governanceVotePower().delegate(_to);
        _tokenUsed(wNat, TOKEN_DELEGATE_GOVERNANCE);
    }

    function undelegateGovernance() external override onlyOwner {
        wNat.governanceVotePower().undelegate();
    }

    // Claim ftso rewards. Alternatively, you can set claim executor and then claim directly from FtsoRewardManager.
    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch,
        address payable _recipient
    )
        external override
        onlyOwner
        returns (uint256)
    {
        return _ftsoRewardManager.claim(address(this), _recipient, _lastRewardEpoch, false);
    }

    // Set executors and recipients that can then automatically claim rewards and airdrop.
    function setAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors,
        address[] memory _allowedRecipients
    )
        external payable override
        onlyOwner
    {
        _claimSetupManager.setClaimExecutors{value: msg.value}(_executors);
        _claimSetupManager.setAllowedClaimRecipients(_allowedRecipients);
    }

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month,
        address payable _recipient
    )
        external override
        onlyOwner
        returns(uint256)
    {
        return _distribution.claim(address(this), _recipient, _month, false);
    }

    function optOutOfAirdrop(IDistributionToDelegators _distribution)
        external override
        onlyOwner
    {
        _distribution.optOutOfAirdrop();
    }

    // Used by asset manager when destroying agent.
    // Completely erases agent vault and transfers all funds to the owner.
    function destroy(address payable _recipient)
        external override
        onlyAssetManager
        nonReentrant
    {
        uint256 length = usedTokens.length;
        for (uint256 i = 0; i < length; i++) {
            IERC20 token = usedTokens[i];
            uint256 useFlags = tokenUseFlags[token];
            // undelegate all governance delegation
            if ((useFlags & TOKEN_DELEGATE_GOVERNANCE) != 0) {
                IWNat(address(token)).governanceVotePower().undelegate();
            }
            // undelegate all FTSO delegation
            if ((useFlags & TOKEN_DELEGATE) != 0) {
                IVPToken(address(token)).undelegateAll();
            }
            // transfer balance to recipient
            if ((useFlags & TOKEN_DEPOSIT) != 0) {
                uint256 balance = token.balanceOf(address(this));
                if (balance > 0) {
                    token.safeTransfer(_recipient, balance);
                }
            }
        }
        // transfer native balance, if any (used to be done by selfdestruct)
        _transferNAT(_recipient, address(this).balance);
    }

    // Used by asset manager for liquidation and failed redemption.
    // Is nonReentrant to prevent reentrancy in case the token has receive hooks.
    function payout(IERC20 _token, address _recipient, uint256 _amount)
        external override
        onlyAssetManager
        nonReentrant
    {
        _token.safeTransfer(_recipient, _amount);
    }

    // Used by asset manager (only for burn for now).
    // Is nonReentrant to prevent reentrancy, in case this is not the last method called.
    function payoutNAT(address payable _recipient, uint256 _amount)
        external override
        onlyAssetManager
        nonReentrant
    {
        _withdrawWNatTo(_recipient, _amount);
    }

    function collateralPool()
        public view
        returns (ICollateralPool)
    {
        return ICollateralPool(assetManager.getCollateralPool(address(this)));
    }

    function isOwner(address _address)
        public view
        returns (bool)
    {
        return assetManager.isAgentVaultOwner(address(this), _address);
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IAgentVault).interfaceId
            || _interfaceId == type(IIAgentVault).interfaceId;
    }

    function _withdrawWNatTo(address payable _recipient, uint256 _amount) private {
        internalWithdrawal = true;
        wNat.withdraw(_amount);
        internalWithdrawal = false;
        _transferNAT(_recipient, _amount);
    }

    function _transferNAT(address payable _recipient, uint256 _amount) private {
        if (_amount > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = _recipient.call{value: _amount}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    }

    function _tokenUsed(IERC20 _token, uint256 _flags) private {
        if (tokenUseFlags[_token] == 0) {
            usedTokens.push(_token);
        }
        tokenUseFlags[_token] |= _flags;
    }
}
