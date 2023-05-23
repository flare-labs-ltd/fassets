// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;


library Collateral {
    enum Kind {
        AGENT_CLASS1,   // class 1 collateral (stablecoins in agent vault)
        POOL,           // pool collateral (NAT)
        AGENT_POOL      // agent's pool tokens (expressed in NAT) - only important for minting
    }

    struct Data {
        Kind kind;
        uint256 fullCollateral;
        uint256 amgToTokenWeiPrice;
    }

    struct CombinedData {
        Collateral.Data agentCollateral;
        Collateral.Data poolCollateral;
        Collateral.Data agentPoolTokens;
    }
}
