// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../diamond/library/LibDiamond.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/CoreVault.sol";
import "./AssetManagerBase.sol";


contract CoreVaultFacet is AssetManagerBase, ReentrancyGuard, ICoreVault {
    constructor() {
        CoreVault.getState().initialized = true;
    }

    function initCoreVaultFacet(
        address payable _nativeAddress,
        address payable _executorAddress,
        string memory _underlyingAddressString,
        uint32 _redemptionFeeBIPS,
        uint32 _transferTimeExtensionSeconds
    )
        public
    {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "diamond not initialized");
        ds.supportedInterfaces[type(ICoreVault).interfaceId] = true;
        // init settings
        CoreVault.State storage state = CoreVault.getState();
        require(!state.initialized, "already initialized");
        state.initialized = true;
        state.nativeAddress = _nativeAddress;
        state.executorAddress = _executorAddress;
        state.underlyingAddressString = _underlyingAddressString;
        state.redemptionFeeBIPS = _redemptionFeeBIPS;
        state.transferTimeExtensionSeconds = _transferTimeExtensionSeconds;
    }

    /**
     * Agent can transfer their backing to core vault.
     * They then get a redemption requests which the owner pays just like any other redemption request.
     * After that, the agent's collateral is released.
     * @param _agentVault the agent vault address
     * @param _amountUBA the amount to transfer to the core vault
     */
    function transferToCoreVault(
        address _agentVault,
        uint256 _amountUBA
    )
        external payable
        nonReentrant
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        CoreVault.transferToCoreVault(agent, amountAMG);
    }

    /**
     * Return the core vault settings.
     */
    function getCoreVaultSettings()
        external view
        returns (CoreVaultSettings memory)
    {
        CoreVault.State storage state = CoreVault.getState();
        return CoreVaultSettings({
            nativeAddress: state.nativeAddress,
            executorAddress: state.executorAddress,
            underlyingAddressString: state.underlyingAddressString,
            redemptionFeeBIPS: state.redemptionFeeBIPS,
            transferTimeExtensionSeconds: state.transferTimeExtensionSeconds
        });
    }
}
