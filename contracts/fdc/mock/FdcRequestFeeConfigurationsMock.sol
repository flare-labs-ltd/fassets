// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcRequestFeeConfigurations.sol";


contract FdcRequestFeeConfigurationsMock is IFdcRequestFeeConfigurations {
    function getRequestFee(bytes calldata /* _data */) external pure returns (uint256) {
        return 0;
    }
}
