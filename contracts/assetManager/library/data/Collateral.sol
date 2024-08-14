// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;


library Collateral {
    enum Kind {
        VAULT,   // vault collateral (tokens in in agent vault)
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
