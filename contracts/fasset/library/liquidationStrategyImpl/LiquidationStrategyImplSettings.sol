// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../../utils/lib/SafePct.sol";
import "../AMEvents.sol";


library LiquidationStrategyImplSettings {
    using SafeCast for uint256;

    struct Data {
        // If there was no liquidator for the current liquidation offer,
        // go to the next step of liquidation after a certain period of time.
        // rate-limited
        uint64 liquidationStepSeconds;

        // Factor with which to multiply the asset price in native currency to obtain the payment
        // to the liquidator.
        // Expressed in BIPS, e.g. [12000, 16000, 20000] means that the liquidator will be paid 1.2, 1.6 and 2.0
        // times the market price of the liquidated assets.
        // Values in array must increase and be greater than 100%.
        // rate-limited
        uint32[] liquidationCollateralFactorBIPS;

        // How much of the liquidation is paid in class1 token.
        // The rest will be paid in pool tokens.
        uint32[] liquidationFactorClass1BIPS;
    }

    bytes32 internal constant SETTINGS_POSITION = keccak256("fasset.AssetManager.LiquidationStrategyImplSettings");

    function verifyAndUpdate(bytes memory _encodedSettings) internal {
        (uint256 stepSeconds, uint256[] memory liquidationFactors, uint256[] memory class1Factors) =
            abi.decode(_encodedSettings, (uint256, uint256[], uint256[]));
        _updateFactors(liquidationFactors, class1Factors);
        _updateLiquidationStepSeconds(stepSeconds);
    }

    function getEncoded() internal view returns (bytes memory) {
        LiquidationStrategyImplSettings.Data storage settings = LiquidationStrategyImplSettings.get();
        return abi.encode(settings.liquidationStepSeconds, settings.liquidationCollateralFactorBIPS,
            settings.liquidationFactorClass1BIPS);
    }

    function get()
        internal pure
        returns (LiquidationStrategyImplSettings.Data storage _settings)
    {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = SETTINGS_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _settings.slot := position
        }
    }

    function _updateFactors(uint256[] memory _liquidationFactors, uint256[] memory _class1Factors) private {
        LiquidationStrategyImplSettings.Data storage settings = LiquidationStrategyImplSettings.get();
        // validate
        require(_liquidationFactors.length == _class1Factors.length, "lengths not equal");
        require(_liquidationFactors.length >= 1, "at least one factor required");
        // update
        delete settings.liquidationCollateralFactorBIPS;
        delete settings.liquidationFactorClass1BIPS;
        for (uint256 i = 0; i < _liquidationFactors.length; i++) {
            // per item validations
            require(_liquidationFactors[i] > SafePct.MAX_BIPS, "factor not above 1");
            require(_class1Factors[i] <= _liquidationFactors[i], "class1 factor higher than total");
            require(i == 0 || _liquidationFactors[i] > _liquidationFactors[i - 1], "factors not increasing");
            // set
            settings.liquidationCollateralFactorBIPS.push(_liquidationFactors[i].toUint32());
            settings.liquidationFactorClass1BIPS.push(_class1Factors[i].toUint32());
        }
        // emit events
        emit AMEvents.SettingArrayChanged("liquidationCollateralFactorBIPS", _liquidationFactors);
        emit AMEvents.SettingArrayChanged("liquidationFactorClass1BIPS", _class1Factors);
    }

    function _updateLiquidationStepSeconds(uint256 _stepSeconds) private {
        LiquidationStrategyImplSettings.Data storage settings = LiquidationStrategyImplSettings.get();
        // validate
        require(_stepSeconds > 0, "cannot be zero");
        require(settings.liquidationStepSeconds == 0 || _stepSeconds <= settings.liquidationStepSeconds * 2,
            "increase too big");
        require(_stepSeconds >= settings.liquidationStepSeconds / 2, "decrease too big");
        // update
        settings.liquidationStepSeconds = _stepSeconds.toUint64();
        emit AMEvents.SettingChanged("liquidationStepSeconds", _stepSeconds);
    }
}
