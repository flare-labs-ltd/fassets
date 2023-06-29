// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../../addressValidator/interface/IAddressValidator.sol";
import "./data/AssetManagerState.sol";


library UnderlyingAddresses {
    function validateAndNormalize(string memory _underlyingAddressString)
        internal view
        returns (string memory _normalizedAddressString, bytes32 _uniqueHash)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        IAddressValidator validator = IAddressValidator(settings.underlyingAddressValidator);
        require(bytes(_underlyingAddressString).length != 0, "empty underlying address");
        require(validator.validate(_underlyingAddressString), "invalid underlying address");
        return validator.normalize(_underlyingAddressString);
    }
}
