// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "./AssetManagerBase.sol";

contract TransferFeeFacet is AssetManagerBase {
    function fassetTransferFeePaid(uint256 _fee)
        external
    {
        // TODO
    }

    function fassetTransferFeeAmount(uint256 _amount)
        external view
        returns (uint256)
    {
        return 0;
    }
}
