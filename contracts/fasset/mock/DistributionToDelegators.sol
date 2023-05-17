// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../interface/IWNat.sol";

contract DistributionToDelegators {
    IWNat private wNat;

    event OptedOutOfAirdrop(address account);

    constructor(IWNat _wNat) {
        wNat = _wNat;
    }

    function claim(address /* _rewardOwner */, address _recipient, uint256 /* _month */, bool /* _wrap */)
        external returns(uint256 _rewardAmount)
    {
        uint256 reward = 1 ether;
        wNat.transfer(_recipient, reward);
        return reward;
    }

    function optOutOfAirdrop() external {
        emit OptedOutOfAirdrop(msg.sender);
    }

}
