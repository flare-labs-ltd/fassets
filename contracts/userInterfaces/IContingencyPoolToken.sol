// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IContingencyPoolToken is IERC20 {
    function contingencyPool()
        external view
        returns (address);

    function transferableBalanceOf(address _account)
        external view
        returns (uint256);

    function lockedBalanceOf(address _account)
        external view
        returns (uint256);
}
