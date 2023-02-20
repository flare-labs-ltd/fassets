// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";


contract AgentVault is ReentrancyGuard, IAgentVault {
    using SafeERC20 for IERC20;

    IAssetManager public immutable assetManager;
    address payable public immutable override owner;

    IERC20[] private usedTokens;
    mapping(IERC20 => uint256) private tokenUseFlags;

    uint256 private constant TOKEN_DEPOSIT = 1;
    uint256 private constant TOKEN_DELEGATE = 2;
    uint256 private constant TOKEN_DELEGATE_GOVERNANCE = 4;

    modifier onlyOwner {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    constructor(IAssetManager _assetManager, address payable _owner) {
        assetManager = _assetManager;
        owner = _owner;
    }

    // needed to allow wNat.withdraw() to send back funds, since there is no withdrawTo()
    receive() external payable {
        require(msg.sender == address(assetManager.getWNat()), "only wNat");
    }

    // without "onlyOwner" to allow owner to send funds from any source
    function depositNat() external payable override {
        IWNat wnat = assetManager.getWNat();
        wnat.deposit{value: msg.value}();
        assetManager.collateralDeposited(wnat);
        _tokenUsed(wnat, TOKEN_DEPOSIT);
    }

    // must call `token.approve(vault, amount)` before for each token in _tokens
    function depositCollateral(IERC20 _token, uint256 _amount)
        external override
        onlyOwner
    {
        _token.transferFrom(msg.sender, address(this), _amount);
        assetManager.collateralDeposited(_token);
        _tokenUsed(_token, TOKEN_DEPOSIT);
    }

    // update collateral after `transfer(vault, some amount)` was called (alternative to depositCollateral)
    function collateralDeposited(IERC20 _token)
        external
        onlyOwner
    {
        assetManager.collateralDeposited(_token);
        _tokenUsed(_token, TOKEN_DEPOSIT);
    }

    function withdrawNat(uint256 _amount, address payable _recipient)
        external override
        onlyOwner
        nonReentrant
    {
        IWNat wnat = assetManager.getWNat();
        // check that enough was announced and reduce announcement
        assetManager.withdrawCollateral(wnat, _amount);
        // withdraw from wnat contract and transfer it to _recipient
        wnat.withdraw(_amount);
        _transferNAT(_recipient, _amount);
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

    // Allow transfering a token, airdropped to the agent vault, to the owner.
    // Doesn't work for wNat because this would allow withdrawing the locked collateral.
    function transferExternalToken(IERC20 _token, uint256 _amount)
        external override
        onlyOwner
        nonReentrant
    {
        require(!assetManager.isCollateralToken(address(this), _token), "Only non-collateral tokens");
        _token.safeTransfer(owner, _amount);
    }

    // TODO: Should check that _token is a collateral token? There should be no need for that.
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
        IWNat wnat = assetManager.getWNat();
        wnat.governanceVotePower().delegate(_to);
        _tokenUsed(wnat, TOKEN_DELEGATE_GOVERNANCE);
    }

    function undelegateGovernance() external override onlyOwner {
        assetManager.getWNat().governanceVotePower().undelegate();
    }

    // Claim ftso rewards. Aletrnatively, you can set claim executor and then claim directly from FtsoRewardManager.
    function claimFtsoRewards(IFtsoRewardManager _ftsoRewardManager, uint256 _lastRewardEpoch)
        external override
        onlyOwner
        returns (uint256)
    {
        return _ftsoRewardManager.claim(address(this), owner, _lastRewardEpoch, false);
    }

    // Set executors and recipients that can then automatically claim rewards through FtsoRewardManager.
    function setFtsoAutoClaiming(
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

    function claimAirdropDistribution(IDistributionToDelegators _distribution, uint256 _month)
        external override
        onlyOwner
        returns(uint256)
    {
        return _distribution.claim(owner, _month);
    }

    function optOutOfAirdrop(IDistributionToDelegators _distribution) external override onlyOwner {
        _distribution.optOutOfAirdrop();
    }

    // Used by asset manager when destroying agent.
    // Completely erases agent vault and transfers all funds to the owner.
    function destroy()
        external override
        onlyAssetManager
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
            // transfer balance to owner
            if ((useFlags & TOKEN_DEPOSIT) != 0) {
                token.transfer(owner, token.balanceOf(address(this)));
            }
        }
        selfdestruct(owner);
    }

    // Used by asset manager for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    // Is nonReentrant to prevent reentrancy in case anybody ever adds receive hooks on wNat.
    function payout(IERC20 _token, address _recipient, uint256 _amount)
        external override
        onlyAssetManager
        nonReentrant
    {
        _token.safeTransfer(_recipient, _amount);
    }

    // Used by asset manager (only for burn for now).
    // Is nonReentrant to prevent reentrancy, in case this is not the last metod called.
    function payoutNAT(IWNat _wNat, address payable _recipient, uint256 _amount)
        external override
        onlyAssetManager
        nonReentrant
    {
        _wNat.withdraw(_amount);
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
