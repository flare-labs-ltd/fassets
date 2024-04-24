// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../utils/lib/SafePct.sol";
import "./Globals.sol";
import "./SettingsValidators.sol";

library SettingsInitializer {
    using SafePct for *;

    struct SettingsWrapper {
        AssetManagerSettings.Data settings;
    }

    function validateAndSet(
        AssetManagerSettings.Data memory _settings
    )
        internal
    {
        _validateSettings(_settings);
        _setAllSettings(_settings);
    }

    function _setAllSettings(
        AssetManagerSettings.Data memory _settings
    )
        private
    {
        // cannot set value at pointer structure received by Globals.getSettings() due to Solidity limitation,
        // so we need to create wrapper structure at the same address and then set member
        SettingsWrapper storage wrapper;
        bytes32 position = Globals.ASSET_MANAGER_SETTINGS_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            wrapper.slot := position
        }
        wrapper.settings = _settings;
    }

    function _validateSettings(
        AssetManagerSettings.Data memory _settings
    )
        private pure
    {
        require(_settings.fAsset != address(0), "zero fAsset address");
        require(_settings.agentVaultFactory != address(0), "zero agentVaultFactory address");
        require(_settings.collateralPoolFactory != address(0), "zero collateralPoolFactory address");
        require(_settings.collateralPoolTokenFactory != address(0), "zero collateralPoolTokenFactory address");
        require(_settings.scProofVerifier != address(0), "zero scProofVerifier address");
        require(_settings.priceReader != address(0), "zero priceReader address");
        require(_settings.agentOwnerRegistry != address(0), "zero agentOwnerRegistry address");

        require(_settings.assetUnitUBA > 0, "cannot be zero");
        require(_settings.assetMintingGranularityUBA > 0, "cannot be zero");
        require(_settings.underlyingBlocksForPayment > 0, "cannot be zero");
        require(_settings.underlyingSecondsForPayment > 0, "cannot be zero");
        require(_settings.redemptionFeeBIPS > 0, "cannot be zero");
        require(_settings.collateralReservationFeeBIPS > 0, "cannot be zero");
        require(_settings.confirmationByOthersRewardUSD5 > 0, "cannot be zero");
        require(_settings.maxRedeemedTickets > 0, "cannot be zero");
        require(_settings.ccbTimeSeconds > 0, "cannot be zero");
        require(_settings.maxTrustedPriceAgeSeconds > 0, "cannot be zero");
        require(_settings.minUpdateRepeatTimeSeconds > 0, "cannot be zero");
        require(_settings.buybackCollateralFactorBIPS > 0, "cannot be zero");
        require(_settings.withdrawalWaitMinSeconds > 0, "cannot be zero");
        require(_settings.averageBlockTimeMS > 0, "cannot be zero");
        SettingsValidators.validateTimeForPayment(_settings.underlyingBlocksForPayment,
            _settings.underlyingSecondsForPayment, _settings.averageBlockTimeMS);
        require(_settings.lotSizeAMG > 0, "cannot be zero");
        require(_settings.mintingCapAMG == 0 || _settings.mintingCapAMG >= _settings.lotSizeAMG,
            "minting cap too small");
        require(_settings.minUnderlyingBackingBIPS > 0, "cannot be zero");
        require(_settings.minUnderlyingBackingBIPS <= SafePct.MAX_BIPS, "bips value too high");
        require(_settings.collateralReservationFeeBIPS <= SafePct.MAX_BIPS, "bips value too high");
        require(_settings.redemptionFeeBIPS <= SafePct.MAX_BIPS, "bips value too high");
        uint256 redemptionFactorBIPS =
            _settings.redemptionDefaultFactorVaultCollateralBIPS + _settings.redemptionDefaultFactorPoolBIPS;
        require(redemptionFactorBIPS > SafePct.MAX_BIPS, "bips value too low");
        require(_settings.attestationWindowSeconds >= 1 days, "window too small");
        require(_settings.confirmationByOthersAfterSeconds >= 2 hours, "must be at least two hours");
        require(_settings.announcedUnderlyingConfirmationMinSeconds <= 1 hours, "confirmation time too big");
        require(_settings.vaultCollateralBuyForFlareFactorBIPS >= SafePct.MAX_BIPS, "value too small");
        require(_settings.agentTimelockedOperationWindowSeconds >= 1 hours, "value too small");
        require(_settings.collateralPoolTokenTimelockSeconds >= 1 minutes, "value too small");
        require(_settings.liquidationStepSeconds > 0, "cannot be zero");
        SettingsValidators.validateLiquidationFactors(_settings.liquidationCollateralFactorBIPS,
            _settings.liquidationFactorVaultCollateralBIPS);
    }
}
