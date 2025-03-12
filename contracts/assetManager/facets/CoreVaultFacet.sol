// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../diamond/library/LibDiamond.sol";
import "../../governance/implementation/GovernedProxyImplementation.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/CoreVault.sol";
import "./AssetManagerBase.sol";


contract CoreVaultFacet is AssetManagerBase, GovernedProxyImplementation, ReentrancyGuard, ICoreVault {
    using SafeCast for uint256;

    constructor() {
        CoreVault.getState().initialized = true;
    }

    function initCoreVaultFacet(
        IICoreVaultManager _coreVaultManager,
        address payable _nativeAddress,
        uint256 _transferFeeBIPS,
        uint256 _redemptionFeeBIPS,
        uint256 _minimumAmountLeftBIPS
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
        state.coreVaultManager = _coreVaultManager;
        state.nativeAddress = _nativeAddress;
        state.transferFeeBIPS = _transferFeeBIPS.toUint16();
        state.redemptionFeeBIPS = _redemptionFeeBIPS.toUint32();
        state.minimumAmountLeftBIPS = _minimumAmountLeftBIPS.toUint16();
    }

    /**
     * Agent can transfer their backing to core vault.
     * They then get a redemption requests which the owner pays just like any other redemption request.
     * After that, the agent's collateral is released.
     * NOTE: only agent vault owner can call
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
     * Cancel a transfer to core vault.
     * If the payment was not made, this is the only way to release agent's collateral,
     * since redemption requests for transfer to core vault cannot default or expire.
     * NOTE: only agent vault owner can call
     * @param _agentVault the agent vault address
     */
    function cancelTransferToCoreVault(
        address _agentVault
    )
        external
        nonReentrant
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        CoreVault.cancelTransferToCoreVault(agent);
    }

    /**
     * Request that core vault transfers funds to the agent's underlying address,
     * which makes them available for redemptions. This method reserves agent's collateral.
     * This may be sent by an agent when redemptions dominate mintings, so that the agents
     * are empty but want to earn from redemptions.
     * NOTE: only agent vault owner can call
     * NOTE: there can be only one active return request (until it is confirmed or cancelled).
     * @param _agentVault the agent vault address
     * @param _lots number of lots (same lots as for minting and redemptions)
     */
    function requestReturnFromCoreVault(
        address _agentVault,
        uint64 _lots
    )
        external
        nonReentrant
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        CoreVault.requestReturnFromCoreVault(agent, _lots);
    }

    /**
     * Before the return request is processed, it can be cancelled, releasing the agent's reserved collateral.
     * @param _agentVault the agent vault address
     */
    function cancelReturnFromCoreVault(
        address _agentVault
    )
        external
        nonReentrant
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        CoreVault.cancelReturnFromCoreVault(agent);
    }

    /**
     * Confirm the payment from core vault to the agent's underlying address.
     * This adds the reserved funds to the agent's backing.
     * @param _payment FDC payment proof
     * @param _agentVault the agent vault address
     */
    function confirmReturnFromCoreVault(
        IPayment.Proof calldata _payment,
        address _agentVault
    )
        external
        nonReentrant
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        CoreVault.confirmReturnFromCoreVault(_payment, agent);
    }

    /**
     * Directly redeem from core vault by a user holding FAssets.
     * This is like ordinary redemption, but the redemption time is much longer (a day or more)
     * and there is no possibility of redemption.
     * @param _lots the number of lots, must be larger than `coreVaultMinimumRedeemLots` setting
     * @param _redeemerUnderlyingAddress the underlying address to which the assets will be redeemed;
     *      must have been added to the `allowedDestinations` list in the core vault manager by
     *      the governance before the redemption request.
     */
    function redeemFromCoreVault(
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        external
        nonReentrant
    {
        CoreVault.redeemFromCoreVault(_lots, _redeemerUnderlyingAddress);
    }

    /**
     * Return the amount of NAT that has to be paid in `transferToCoreVault` call.
     * @param _amountUBA the amount to transfer to the core vault
     * @return _transferFeeNatWei the amount that has to be included as `msg.value` and is paid to the core vault
     */
    function transferToCoreVaultFee(
        uint256 _amountUBA
    )
        external view
        returns (uint256 _transferFeeNatWei)
    {
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        return CoreVault.getTransferFee(amountAMG);
    }

    function maximumTransferToCoreVault(
        address _agentVault
    )
        external view
        returns (uint256 _maximumTransferUBA, uint256 _minimumLeftAmountUBA)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        (uint256 _maximumTransferAMG, uint256 _minimumLeftAmountAMG) =
             CoreVault.getMaximumTransferToCoreVaultAMG(agent);
        _maximumTransferUBA = Conversion.convertAmgToUBA(_maximumTransferAMG.toUint64());
        _minimumLeftAmountUBA = Conversion.convertAmgToUBA(_minimumLeftAmountAMG.toUint64());
    }

    ///////////////////////////////////////////////////////////////////////////////////
    // Settings

    function setCoreVaultManager(
        address _coreVaultManager
    )
        external
        onlyGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.coreVaultManager = IICoreVaultManager(_coreVaultManager);
    }

    function setCoreVaultNativeAddress(
        address payable _nativeAddress
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.nativeAddress = _nativeAddress;
    }

    function setCoreVaultTransferFeeBIPS(
        uint256 _transferFeeBIPS
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.transferFeeBIPS = _transferFeeBIPS.toUint16();
    }

    function setCoreVaultRedemptionFeeBIPS(
        uint256 _redemptionFeeBIPS
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.redemptionFeeBIPS = _redemptionFeeBIPS.toUint32();
    }

    function setCoreVaultMinimumAmountLeftBIPS(
        uint256 _minimumAmountLeftBIPS
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.minimumAmountLeftBIPS = _minimumAmountLeftBIPS.toUint16();
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
            coreVaultManager: address(state.coreVaultManager),
            nativeAddress: state.nativeAddress,
            transferFeeBIPS: state.transferFeeBIPS,
            redemptionFeeBIPS: state.redemptionFeeBIPS,
            minimumAmountLeftBIPS: state.minimumAmountLeftBIPS
        });
    }
}
