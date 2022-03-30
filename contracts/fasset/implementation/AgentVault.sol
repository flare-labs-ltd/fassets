// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";


contract AgentVault is ReentrancyGuard, IAgentVault {
    IAssetManager public immutable assetManager;
    address public immutable override owner;

    modifier onlyOwner {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }
    
    constructor(IAssetManager _assetManager, address _owner) {
        assetManager = _assetManager;
        owner = _owner;
    }
    
    // needed to allow wNat.withdraw() to send back funds
    // does not lock funds - they can be retrieved by the owner via withdrawAccidental() or destroy()
    receive() external payable {
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

    function claimReward(
        IFtsoRewardManager ftsoRewardManager,
        address payable _recipient,
        uint256[] memory _rewardEpochs
    ) 
        external override
        onlyOwner
    {
        ftsoRewardManager.claimReward(_recipient, _rewardEpochs);
    }
    
    function withdraw(address payable _recipient, uint256 _amount) external override onlyOwner {
        // check that enough was announced and reduce announcement
        assetManager.withdrawCollateral(_amount);
        // withdraw from wnat contract and transfer it to _recipient
        assetManager.getWNat().withdraw(_amount);
        _recipient.transfer(_amount);
    }
    
    function withdrawAccidental(address payable _recipient) external override onlyOwner {
        _recipient.transfer(address(this).balance);
    }

    // Used by asset manager when destroying agent.
    // Completely erases agent vault and deposits all funds to the _recipient.
    function destroy(IWNat wNat, address payable _recipient) external override onlyAssetManager {
        wNat.undelegateAll();
        wNat.withdraw(wNat.balanceOf(address(this)));
        selfdestruct(_recipient);
    }

    // Used by asset manager for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    // Is nonReentrant to prevent reentrancy in case anybody ever adds receive hooks on wNat. 
    function payout(IWNat wNat, address _recipient, uint256 _amount)
        external override
        onlyAssetManager
        nonReentrant
    {
        wNat.transfer(_recipient, _amount);
    }
}
