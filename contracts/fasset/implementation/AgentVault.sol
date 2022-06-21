// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";


contract AgentVault is ReentrancyGuard, IAgentVault {
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
    
    constructor(IAssetManager _assetManager, address payable _owner) {
        assetManager = _assetManager;
        owner = _owner;
    }
    
    // needed to allow wNat.withdraw() to send back funds
    receive() external payable {
        require(msg.sender == address(assetManager.getWNat()), "only wNat");
    }

    // without "onlyOwner" to allow owner to send funds from any source
    function deposit() external payable override {
        assetManager.getWNat().deposit{value: msg.value}();
        assetManager.depositCollateral(msg.value);
    }

    function delegate(address _to, uint256 _bips) external override onlyOwner {
        assetManager.getWNat().delegate(_to, _bips);
    }

    function undelegateAll() external override onlyOwner {
        assetManager.getWNat().undelegateAll();
    }

    function revokeDelegationAt(address _who, uint256 _blockNumber) external override onlyOwner {
        assetManager.getWNat().revokeDelegationAt(_who, _blockNumber);
    }

    function delegateGovernance(address _to) external override onlyOwner {
        assetManager.getWNat().governanceVotePower().delegate(_to);
    }

    function undelegateGovernance() external override onlyOwner {
        assetManager.getWNat().governanceVotePower().undelegate();
    }

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256[] memory _rewardEpochs
    ) 
        external override
        onlyOwner
        returns (uint256)
    {
        return _ftsoRewardManager.claimReward(owner, _rewardEpochs);
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
    
    function withdraw(uint256 _amount) external override onlyOwner nonReentrant {
        // check that enough was announced and reduce announcement
        assetManager.withdrawCollateral(_amount);
        // withdraw from wnat contract and transfer it to _recipient
        assetManager.getWNat().withdraw(_amount);
        _transferNAT(owner, _amount);
    }

    // Used by asset manager when destroying agent.
    // Completely erases agent vault and deposits all funds to the _recipient.
    function destroy(IWNat _wNat) external override onlyAssetManager {
        if (address(_wNat.governanceVotePower()) != address(0)) {
            _wNat.governanceVotePower().undelegate();
        }
        _wNat.undelegateAll();
        _wNat.withdraw(_wNat.balanceOf(address(this)));
        selfdestruct(owner);
    }

    // Used by asset manager for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    // Is nonReentrant to prevent reentrancy in case anybody ever adds receive hooks on wNat. 
    function payout(IWNat _wNat, address _recipient, uint256 _amount)
        external override
        onlyAssetManager
        nonReentrant
    {
        bool success = _wNat.transfer(_recipient, _amount);
        assert(success);
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
    function transferToOwner(IERC20 _token, uint256 _amount) external override onlyOwner {
        require(assetManager.getWNat() != _token, "not alowed from wnat");
        _token.transfer(owner, _amount);
    }

    function _transferNAT(address payable _recipient, uint256 _amount) private {
        if (_amount > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send
            (bool success, ) = _recipient.call{value: _amount}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    }
}
