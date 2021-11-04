// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "../interface/IAssetMinter.sol";
import "../interface/IAgentVault.sol";

contract AgentVault is IAgentVault {
    IAssetMinter public immutable assetMinter;
    WNat public immutable wnat;
    address public immutable override owner;

    modifier onlyOwner {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyAssetMinter {
        require(msg.sender == owner, "only asset minter");
        _;
    }
    
    constructor(IAssetMinter _assetMinter, WNat _wnat, address _owner) {
        assetMinter = _assetMinter;
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
        require(assetMinter.maxWithdrawAllowed(address(this)) >= _amount, "amount not allowed");
        wnat.withdraw(_amount);
        _recipient.transfer(_amount);
    }
    
    function withdrawAccidental(address payable _recipient) external override onlyOwner {
        _recipient.transfer(address(this).balance);
    }

    // agent should make sure to claim rewards before calling destroy(), or they will be forfeit
    function destroy(address payable _recipient) external override onlyOwner {
        require(assetMinter.canDestroy(address(this)), "destroy not allowed");
        wnat.undelegateAll();
        wnat.withdraw(wnat.balanceOf(address(this)));
        selfdestruct(_recipient);
    }

    // Used by asset minter for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    function liquidate(address _recipient, uint256 _amount) external override onlyAssetMinter {
        wnat.transfer(_recipient, _amount);
    }
}
