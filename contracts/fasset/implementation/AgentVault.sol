// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";


contract AgentVault is IAgentVault {
    IAssetManager public immutable assetManager;
    WNat public immutable wnat;
    address public immutable override owner;

    modifier onlyOwner {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }
    
    constructor(IAssetManager _assetManager, WNat _wnat, address _owner) {
        assetManager = _assetManager;
        owner = _owner;
        wnat = _wnat;
    }
    
    // needed to allow wnat.withdraw() to send back funds
    // does not lock funds - they can be retrieved by the owner via withdrawAccidental() or destroy()
    receive() external payable {
    }

    // without "onlyOwner" to allow owner to send funds from any source
    function deposit() external payable override {
        wnat.deposit{value: msg.value}();
    }

    function delegate(address _to, uint256 _bips) external override onlyOwner {
        wnat.delegate(_to, _bips);
    }

    function undelegateAll() external override onlyOwner {
        wnat.undelegateAll();
    }

    function revokeDelegationAt(address _who, uint256 _blockNumber) external override onlyOwner {
        wnat.revokeDelegationAt(_who, _blockNumber);
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
        require(assetManager.maxWithdrawAllowed(address(this)) >= _amount, "amount not allowed");
        wnat.withdraw(_amount);
        _recipient.transfer(_amount);
    }
    
    function withdrawAccidental(address payable _recipient) external override onlyOwner {
        _recipient.transfer(address(this).balance);
    }

    // agent should make sure to claim rewards before calling destroy(), or they will be forfeit
    function destroy(address payable _recipient) external override onlyOwner {
        require(assetManager.canDestroy(address(this)), "destroy not allowed");
        wnat.undelegateAll();
        wnat.withdraw(wnat.balanceOf(address(this)));
        selfdestruct(_recipient);
    }

    // Used by asset manager for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    function liquidate(address _recipient, uint256 _amount) external override onlyAssetManager {
        wnat.transfer(_recipient, _amount);
    }
}
