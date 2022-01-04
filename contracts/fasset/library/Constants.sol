// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IPriceSubmitter} from "../../ScInterfaces/userInterfaces/IPriceSubmitter.sol";

library Constants {
    address public constant PRICE_SUBMITTER_ADDRESS = 0x1000000000000000000000000000000000000003;
    IPriceSubmitter public constant PRICE_SUBMITTER = IPriceSubmitter(PRICE_SUBMITTER_ADDRESS);

    // TODO: Fix this when deploying to mainnet
    // Does changing this to a smaller datatype save size later on?
    uint256 public constant WNAT_ASSET_INDEX = 0;
}
