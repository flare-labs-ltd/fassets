// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface IRedemptionTimeExtension {
    function setRedemptionPaymentExtensionSeconds(uint256 _value)
        external;

    function redemptionPaymentExtensionSeconds()
        external view
        returns (uint256);
}
