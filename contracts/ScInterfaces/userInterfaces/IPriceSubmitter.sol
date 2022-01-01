// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IFtsoRegistry.sol";

interface IPriceSubmitter {
    function getFtsoRegistry() external view returns (IFtsoRegistry);
}
