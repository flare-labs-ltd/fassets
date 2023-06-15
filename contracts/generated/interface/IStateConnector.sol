// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IStateConnector {
    function merkleRoots(uint256 _index) external view returns (bytes32);
    // solhint-disable-next-line func-name-mixedcase
    function TOTAL_STORED_PROOFS() external view returns (uint256);
}
