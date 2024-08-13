// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/StateUpdater.sol";
import "./AssetManagerBase.sol";


contract SystemStateManagementFacet is AssetManagerBase {
    /**
     * When `attached` is true, asset manager has been added to the asset manager controller.
     * Even though the asset manager controller address is set at the construction time, the manager may not
     * be able to be added to the controller immediately because the method addAssetManager must be called
     * by the governance multisig (with timelock). During this time it is impossible to verify through the
     * controller that the asset manager is legit.
     * Therefore creating agents and minting is disabled until the asset manager controller notifies
     * the asset manager that it has been added.
     * The `attached` can be set to false when the retired asset manager is removed from the controller.
     */
    function attachController(bool attached)
        external
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        state.attached = attached;
    }

    /**
     * When asset manager is paused, no new minting can be made.
     * All other operations continue normally.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function pauseMinting()
        external
        onlyAssetManagerController
    {
        StateUpdater.pauseMinting();
    }

    /**
     * If f-asset was not terminated yet, minting can continue.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function unpauseMinting()
        external
        onlyAssetManagerController
    {
        StateUpdater.unpauseMinting();
    }

    /**
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used only when the asset manager minting has been already paused
     * for a long time but there still exist unredeemable f-assets. In such case, the f-asset contract is
     * terminated and then agents can buy back the collateral at market rate (i.e. they burn market value
     * of backed f-assets in collateral to release the rest of the collateral).
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function terminate()
        external
        onlyAssetManagerController
    {
        StateUpdater.terminate();
    }
}
