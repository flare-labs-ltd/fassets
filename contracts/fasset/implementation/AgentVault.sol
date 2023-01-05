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

    modifier onlyOwner {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    modifier onlyCollateral(IERC20 _token) {
        require(assetManager.isCollateralToken(_token), "only collateral tokens");
        _;
    }
    
    constructor(IAssetManager _assetManager, address payable _owner) {
        assetManager = _assetManager;
        owner = _owner;
    }
    
    // needed to allow wNat.withdraw() to send back funds
    receive() external payable {
        require(msg.sender == address(assetManager.getWNat()), "only wNat");
    }

    // without "onlyOwner" to allow owner to send funds from any source
    function depositNat() external payable override {
        IWNat wnat = assetManager.getWNat();
        wnat.deposit{value: msg.value}();
        assetManager.updateCollateral(wnat);    // implicitly checks wnat is collateral token
    }
    
    // must call `_token.approve(vault, _amount)` before
    function depositCollateral(IERC20 _token, uint256 _amount) external override {
        _token.transferFrom(msg.sender, address(this), _amount);
        assetManager.updateCollateral(_token);  // implicitly checks _token is collateral token
    }

    // update collateral after `transfer(vault, some amount)` was called (alternative to depositCollateral)
    function updateCollateral(IERC20 _token) external override onlyCollateral(_token) {
        assetManager.updateCollateral(_token);  // implicitly checks onlyCollateral(_token)
    }

    // TODO: Should check that _token is a collateral token? There should be no need for that.
    function delegate(IVPToken _token, address _to, uint256 _bips) external override onlyOwner {
        _token.delegate(_to, _bips);
    }

    function undelegateAll(IVPToken _token) external override onlyOwner {
        _token.undelegateAll();
    }

    function revokeDelegationAt(IVPToken _token, address _who, uint256 _blockNumber) external override onlyOwner {
        _token.revokeDelegationAt(_who, _blockNumber);
    }

    function delegateGovernance(address _to) external override onlyOwner {
        assetManager.getWNat().governanceVotePower().delegate(_to);
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

    // Claim ftso rewards. Aletrnatively, you can set claim executor and then claim directly from FtsoRewardManager.
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

    function optOutOfAirdrop(IDistributionToDelegators _distribution) external override onlyOwner {
        _distribution.optOutOfAirdrop();
    }

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month
    )
        external override
        onlyOwner
        returns(uint256)
    {
        return _distribution.claim(owner, _month);
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

    // Used by asset manager when destroying agent.
    // Completely erases agent vault and transfers all funds to the owner.
    function destroy(IERC20[] memory _tokens, TokenType[] memory _tokenTypes)
        external override
        onlyAssetManager
    {
        for (uint256 i = 0; i < _tokens.length; i++) {
            IERC20 token = _tokens[i];
            TokenType tokenType = _tokenTypes[i];
            if (tokenType == TokenType.WNAT) {
                IWNat wnat = IWNat(address(token));
                if (address(wnat.governanceVotePower()) != address(0)) {
                    wnat.governanceVotePower().undelegate();
                }
                wnat.undelegateAll();
            } else if (tokenType == TokenType.VP_TOKEN) {
                IVPToken(address(token)).undelegateAll();
            }
            token.transfer(owner, token.balanceOf(address(this)));
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

    // Allow transfering a token, airdropped to the agent vault, to the owner.
    // Doesn't work for wNat because this would allow withdrawing the locked collateral.
    function transferExternalToken(IERC20 _token, uint256 _amount) 
        external override 
        onlyOwner 
        nonReentrant 
    {
        require(!assetManager.isCollateralToken(_token), "Only non-collateral tokens");
        _token.safeTransfer(owner, _amount);
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
}
