// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/assetManager/IAgentVaultAndPoolSupport.sol";
import "../library/data/AssetManagerState.sol";
import "../library/AgentsExternal.sol";
import "../library/Agents.sol";
import "./AssetManagerBase.sol";


contract AgentVaultAndPoolSupportFacet is AssetManagerBase, IAgentVaultAndPoolSupport {
    /**
     * Returns price of asset (UBA) in NAT Wei as a fraction.
     */
    function assetPriceNatWei()
        external view override
        returns (uint256 _multiplier, uint256 _divisor)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        _multiplier = Conversion.currentAmgPriceInTokenWei(Globals.getPoolCollateral());
        _divisor = Conversion.AMG_TOKEN_WEI_PRICE_SCALE * settings.assetMintingGranularityUBA;
    }

    /**
     * Check if `_token` is either vault collateral token for `_agentVault` or the pool token.
     * These types of tokens cannot be simply transfered from the agent vault, but can only be
     * withdrawn after announcement if they are not backing any f-assets.
     */
    function isLockedVaultToken(address _agentVault, IERC20 _token)
        external view override
        returns (bool)
    {
        return AgentsExternal.isLockedVaultToken(_agentVault, _token);
    }

    function getFAssetsBackedByPool(address _agentVault)
        external view override
        returns (uint256)
    {
        return AgentsExternal.getFAssetsBackedByPool(_agentVault);
    }

    function isAgentVaultOwner(address _agentVault, address _address)
        external view override
        returns (bool)
    {
        return Agents.isOwner(Agent.get(_agentVault), _address);
    }

    /**
     * Get WNat contract. Used by AgentVault.
     * @return WNat contract
     */
    function getWNat()
        external view override
        returns (IWNat)
    {
        return Globals.getWNat();
    }
}
