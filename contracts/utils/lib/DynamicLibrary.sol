// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

// solhint-disable no-inline-assembly
// solhint-disable avoid-low-level-calls

library DynamicLibrary {
    function delegateCall(address _library, bytes memory _data)
        internal
        returns (bytes memory)
    {
        (bool success, bytes memory result) = _library.delegatecall(_data);
        if (success) {
            return result;
        }
        /// @solidity memory-safe-assembly
        assembly {
            let size := returndatasize()
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, size))
            returndatacopy(ptr, 0, size)
            revert(ptr, size)
        }
    }

    /**
     * A hack to allow using `delegatecall` from a `view` function.
     * Warning: this circumvents the Solidity type system, so be careful to only call view functions.
     */
    function staticDelegateCall(address _library, bytes memory _data)
        internal view
        returns (bytes memory)
    {
        function (address, bytes memory) internal returns (bytes memory) originalFunc = delegateCall;
        function (address, bytes memory) internal view returns (bytes memory) viewFunc;
        assembly {
            viewFunc := originalFunc
        }
        return viewFunc(_library, _data);
    }
}
