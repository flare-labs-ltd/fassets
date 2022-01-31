// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../interface/IAgentVault.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAttestationClient.sol";
import "../interface/IFAsset.sol";
import "../library/Agents.sol";
import "../library/AssetManagerState.sol";
import "../library/AssetManagerSettings.sol";
import "../library/CollateralReservations.sol";
import "../library/Conversion.sol";
import "../library/Minting.sol";
import "../library/PaymentVerification.sol";
import "../library/TransactionAttestation.sol";
import "../../utils/lib/SafeBips.sol";
import "../../utils/lib/SafeMath64.sol";

// One asset manager per fAsset type
contract AssetManager is ReentrancyGuard {
    using AssetManagerState for AssetManagerState.State;

    AssetManagerState.State private state;
    IFAsset public immutable fAsset;
    address public assetManagerController;  // TODO: should be replaceable?

    constructor(
        AssetManagerSettings.Settings memory _settings,
        IFAsset _fAsset,
        address _assetManagerController
    ) {
        fAsset = _fAsset;
        assetManagerController = _assetManagerController;
        _updateSettings(_settings);
    }

    function updateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        external
    {
        require(msg.sender == assetManagerController, "only asset manager controller");
        _updateSettings(_settings);
    }

    function reserveCollateral(
        bytes32 _minterUnderlyingAddress, 
        address _selectedAgent, 
        uint64 _lotsToMint, 
        uint64 _currentUnderlyingBlock
    ) 
        external payable 
        returns (bytes32 agentsUnderlyingAddress, uint256 crtId)
    {
        CollateralReservations.reserveCollateral(
            state,
            msg.sender, 
            _minterUnderlyingAddress,
            _selectedAgent, 
            IAgentVault(_selectedAgent).fullCollateral(),
            Conversion.calculateAmgToNATWeiPrice(state.settings),
            _lotsToMint,
            _currentUnderlyingBlock // This can be challanged in state connector if too high
        );

        return (Agents.getAgent(state, _selectedAgent).underlyingAddress, state.newCrtId);
    }

    function executeMinting(
        IAttestationClient.LegalPayment calldata _payment,
        uint64 _crtId
    ) 
        external 
        nonReentrant
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyLegalPayment(state.settings, _payment, false);
        (address minter, uint256 mintValue) = Minting.mintingExecuted(state, paymentInfo, _crtId);
        fAsset.mint(minter, mintValue);
    }

    function calculateLots(
        uint256 _underlyingValueUBA, 
        address _selectedAgent
    ) 
        external view 
        returns (uint64 lots, uint256 baseValueUBA, uint256 fullBaseValueUBA) 
    {
        uint256 coef = state.settings.assetMintingGranularityUBA * state.settings.lotSizeAMG;
        uint256 target = _underlyingValueUBA / coef; 
        uint256 agentFeeBips = Agents.getAgent(state, _selectedAgent).feeBIPS;
        return (SafeCast.toUint64(target), target * coef, SafeBips.mulBips(target * coef, agentFeeBips));
    }

    function _updateSettings(AssetManagerSettings.Settings memory _settings) private {
        // TODO: check settings validity
        state.settings = _settings;
    }
}
