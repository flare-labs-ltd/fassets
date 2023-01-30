// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../interface/IStakingPool.sol";
import "../interface/IWNat.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "./StakingPoolToken.sol"; 

abstract contract StakingPool is StakingPoolToken {

    uint256 public constant CLAIMER_REWARD_BIPS = 3;

    IWNat public wnat;
    IERC20 public fasset;

    // ftso manager for staking the pool
    IFtsoRewardManager public rewardManager;
    uint256 public lastDelegationEpoch;

    // ftso of the agent's f-asset
    IIFtso public ftso;

    constructor(
        IFtsoRewardManager _rewardManager, 
        address _wnat, address _fasset, address _ftso,
        string memory agentId
    ) StakingPoolToken(agentId) {
        wnat = IWNat(_wnat);
        fasset = IERC20(_fasset);
        ftso = IIFtso(_ftso);

        rewardManager = _rewardManager;
        lastDelegationEpoch = rewardManager.getRewardEpochToExpireNext();
    }

    function stake(uint256 _stake) external {
        uint256 tokens = _stakeToTokens(_stake);
        require(tokens > 0, "staked amount is too low");
        wnat.transferFrom(msg.sender, address(this), _stake);
        uint256 fee = _tokensToFee(tokens);
        fasset.transferFrom(msg.sender, address(this), fee);

        _mint(msg.sender, tokens);
        _increaseValue(_stake);
        _increaseFees(fee);
    }

    function unstake(uint256 _stake) external {
        require(value > 0, "pool is empty");
        uint256 tokens = _stakeToTokens(_stake);
        wnat.transfer(msg.sender, _stake);
        uint256 fee = _tokensToFee(tokens);
        fasset.transfer(msg.sender, fee);

        _burn(msg.sender, tokens);
        _decreaseValue(_stake);
        _decreaseFees(fee);
    }

    function updateFtsoDelegations(
        address[] memory _to, uint256[] memory _bips
    ) external onlyOwner {
        IVPToken(wnat).batchDelegate(_to, _bips);
    }

    function claimFtsoRewards(uint256[] memory _rewardEpochs) external {
        uint256 claimedReward = rewardManager.claimAndWrapReward(
            payable(address(this)), _rewardEpochs);
        uint256 callerReward = claimedReward * CLAIMER_REWARD_BIPS / 100;
        msg.sender.transfer(callerReward);
    }

    function _stakeToTokens(uint256 _stake) private view returns (uint256) {
        return (value == 0) ? _stake : _stake * totalSupply() / value;
    }
    function _tokensToFee(uint256 _tokens) private view returns (uint256) {
        uint256 allTokens = totalSupply();
        return (allTokens == 0) ? 0 : _tokens * fees / allTokens;
    }

}