// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Here we declare only the functionalities related to StakingPool.
 */
interface IStakingPool {

    /**
     * Stake takes the staking amount and returns the amount of 
     * newly minted pool tokens (transfered to the owner)
     */
    function stake(uint256 amount) external;

    function stakeWithoutFassetFee(uint256 amount) external;

}