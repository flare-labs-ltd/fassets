// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interface/IAgentVault.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAttestationClient.sol";
import "../interface/IFAsset.sol";
import "../../utils/lib/SafeBips.sol";
import "../../utils/lib/SafeMath64.sol";
import "../library/Agents.sol";
import "../library/AssetManagerState.sol";
import "../library/AssetManagerSettings.sol";
import "../library/CollateralReservations.sol";
import "../library/Conversion.sol";
import "../library/Minting.sol";
import "../library/PaymentVerification.sol";
import "../library/TransactionAttestation.sol";
import "../library/UnderlyingAddressOwnership.sol";
import "../library/Redemption.sol";
import "../library/IllegalPaymentChallenge.sol";
import "../library/Liquidation.sol";
import "../library/AllowedPaymentAnnouncement.sol";
import "../library/UnderlyingFreeBalance.sol";

// One asset manager per fAsset type
contract AssetManager is ReentrancyGuard {
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

    ////////////////////////////////////////////////////////////////////////////////////
    // Settings update
    
    function updateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        external
    {
        require(msg.sender == assetManagerController, "only asset manager controller");
        // TODO: prevent immutable settings change
        _updateSettings(_settings);
    }

    function _updateSettings(AssetManagerSettings.Settings memory _settings) private {
        // TODO: check settings validity
        state.settings = _settings;
    }
    
    ////////////////////////////////////////////////////////////////////////////////////
    // Agent handling
    
    /**
     * This method fixes the underlying address to be used with given `_agentVault`.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to `_agentVault` address.
     * NOTE: calling this method before `createAgent()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     */
    function claimAgentUnderlyingAddress(
        IAttestationClient.LegalPayment calldata _payment,
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyLegalPayment(state.settings, _payment, true);
        UnderlyingAddressOwnership.claimWithProof(state.underlyingAddressOwnership, 
            paymentInfo, _agentVault, paymentInfo.sourceAddressHash);
    }
    
    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults, 
     *  but in fasset system, each agent vault acts as an independent agent.)
     */
    function createAgent(
        Agents.AgentType _agentType,
        address _agentVault,
        bytes memory _underlyingAddressString
    ) 
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.createAgent(state, _agentType, _agentVault, _underlyingAddressString);
    }

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     */
    function announceCollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.announceWithdrawal(state, _agentVault, _valueNATWei);
    }

    /**
     * Called by AgentVault when agent calls `withdraw()`.
     * Will revert if called directly by any address that is not registered as agent vault.
     */
    function withdrawCollateral(
        uint256 _valueNATWei
    )
        external
    {
        // Agents.withdrawalExecuted makes sure that only a registered agent vault can call
        Agents.withdrawalExecuted(state, msg.sender, _valueNATWei);
    }
    
    /**
     * After a lot size change by the governance, it may happen that after a redemption
     * there remains less than one lot on a redemption ticket. This is named "dust" and
     * can be self closed or liquidated, but not redeemed. However, after several such redemptions,
     * the total dust can amount to more than one lot. Using this method, the amount, rounded down
     * to a whole number of lots, can be converted to a new redemption ticket.
     * NOTE: we do NOT check that the caller is the agent vault owner, since we want to
     * allow anyone to convert dust to tickets to increase asset fungibility.
     */
    function convertDustToTickets(
        address _agentVault
    )
        external
    {
        Agents.convertDustToTickets(state, _agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Manage list of agents, publicly available for minting

    /**
     * Add the agent to the list of publicly available agents.
     * Other agents can only self-mint.
     */    
    function makeAgentAvailable(
        address _agentVault,
        uint256 _feeBIPS,
        uint256 _agentMinCollateralRatioBIPS
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        AvailableAgents.makeAvailable(state, _agentVault, _feeBIPS, _agentMinCollateralRatioBIPS);
    }
    
    /**
     * Exit the publicly available agents list.
     */
    function exitAvailableAgentList(
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        AvailableAgents.exit(state, _agentVault);
    }
    
    /**
     * Get (a part of) the list of available agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     */
    function getAvailableAgentsList(
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getList(state, _start, _end);
    }

    /**
     * Get (a part of) the list of available agents with extra information about agents' fee, min collateral ratio
     * and available collateral (in lots).
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * NOTE: agent's available collateral can change anytime due to price changes, minting, or changes 
     * in agent's min collateral ratio, so it is only to be used as estimate.
     */
    function getAvailableAgentsDetailedList(
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (AvailableAgents.AvailableAgentInfo[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getListWithInfo(state, _start, _end);
    }
        
    ////////////////////////////////////////////////////////////////////////////////////
    // Minting
    
    /**
     * Before paying underlying assets for minting, minter has to reserve collateral and
     * pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio
     * to requested lots NAT market price.
     * @param _selectedAgent agent's vault address
     * @param _lotsToMint the number of lots for which to reserve collateral
     * @param _underlyingBlock the minter provides the current block number on underlying chain;
     *   if it is too high (giving minter too much time for the underlying payment), it can be
     *   challenged by the agent via `challengeCollateralReservationBlock` and in that case the
     *   minter must provide proof of the block.
     */
    function reserveCollateral(
        address _selectedAgent, 
        uint64 _lotsToMint, 
        uint64 _underlyingBlock
    ) 
        external payable 
    {
        CollateralReservations.reserveCollateral(state,
            msg.sender, _selectedAgent, _lotsToMint, _underlyingBlock);
    }
    
    /**
     * If the underlying block, provided by the minter in collateral reservation,
     * is too high (giving minter too much time for the underlying payment), it can be
     * challenged by the agent by calling this method and in that case the
     * minter must provide proof of the block.
     * @param _crtId collateral reservation request ID (from the CollateralReserved event)
     */
    function challengeCollateralReservationBlock(
        uint64 _crtId
    )
        external
    {
        CollateralReservations.challengeReservationUnderlyingBlock(state, _crtId);
    }
    
    /**
     * When agent requests underlying block proof, the minter must verify block height via state
     * connector and provide the proof of a mined block at least this high.
     */
    function proveCollateralReservationBlock(
        IAttestationClient.BlockHeightExists calldata _proof,
        uint64 _crtId
    )
        external
    {
        uint64 underlyingBlock = TransactionAttestation.verifyBlockHeightExists(state.settings, _proof);
        CollateralReservations.verifyUnderlyingBlock(state, _crtId, underlyingBlock);
    }
    
    /**
     * When the time for minter to prove provided block (setting minSecondsForBlockChallengeResponse) has passed,
     * the agent can declare payment timeout. Then the agent collects collateral reservation fee 
     * (it goes directly to the vault), and the reserved collateral is unlocked.
     */
    function collateralReservationBlockChallengeTimeout(
        uint64 _crtId
    )
        external
    {
        CollateralReservations.underlyingBlockChallengeTimeout(state, _crtId);
    }
    
    /**
     * After obtaining proof of underlying payment, the minter calls this method to finish the minting
     * and collect the minted f-assets.
     */
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

    /**
     * When the time for minter to pay underlying amount is over (i.e. the last underlying block has passed),
     * the agent can declare payment timeout. Then the agent collects collateral reservation fee 
     * (it goes directly to the vault), and the reseved collateral is unlocked.
     */
    function mintingPaymentTimeout(
        IAttestationClient.BlockHeightExists calldata _proof,
        uint64 _crtId
    )
        external
    {
        uint64 underlyingBlock = TransactionAttestation.verifyBlockHeightExists(state.settings, _proof);
        CollateralReservations.collateralReservationTimeout(state, _crtId, underlyingBlock);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Redemption
    
    /**
     * F-assets must be provided by calling `IERC20(fasset).approve(assetManager, redeemed asset amount)`.
     * NOTE: in some cases not all sent f-assets can be redeemed (either there are not enough tickets or
     * more than a fixed limit of tickets should be redeemed). In this case only part of the approved assets
     * are burned and redeemed and the redeemer can execute this method again for the remaining lots.
     * In such case `RedemptionRequestIncomplete` event will be emitted, indicating the number of remaining lots.
     * @param _lots number of lots to redeem
     * @param _redeemerUnderlyingAddressString the address to which the agent must transfer underlyng amount
     * @param _currentUnderlyingBlock current block height on the underlyng chain, used to calculate the block 
     *   height by which the agent must pay; can be challenged by agent if it is too small
     */
    function redeem(
        uint64 _lots,
        bytes memory _redeemerUnderlyingAddressString,
        uint64 _currentUnderlyingBlock
    )
        external
    {
        uint64 redeemedLots = Redemption.redeem(state, msg.sender, _lots, 
            _redeemerUnderlyingAddressString, _currentUnderlyingBlock);
        uint256 redeemedUBA = Conversion.convertLotsToUBA(state.settings, redeemedLots);
        fAsset.burn(msg.sender, redeemedUBA);
    }
    
    /**
     * If redeemer provides to small block height in `redeem` request, the agent may provide proof
     * of existing higher block with this method. For this, the agent's time for redemption payment is
     * until both the target underlying block height is achieved and some timestamp is reached 
     * (enough to react to to small provided block height with this challenge).
     * After this method is called, agent's block when payment must be proved is increased, based
     * on the block height provided in this proof.
     */
    function challengeRedemptionRequestBlock(
        IAttestationClient.BlockHeightExists calldata _proof,
        uint64 _redemptionRequestId
    )
        external
    {
        // TODO: should only agent call this?
        uint64 underlyingBlock = TransactionAttestation.verifyBlockHeightExists(state.settings, _proof);
        Redemption.challengeRedemptionRequestUnderlyingBlock(state, _redemptionRequestId, underlyingBlock);
    }
    
    /**
     * To prevent illegal payment challenge proof from overtaking payment proof,
     * agent must report payment before proof is available. After reporting, challenge
     * can only be executed if it can prove that report is lying about some data.
     */
    function reportRedemptionRequestPayment(
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,  // TODO: rename fields to be like LegalPayment
        uint64 _redemptionRequestId
    )
        external
    {
        Redemption.reportRedemptionRequestPayment(state, _paymentInfo, _redemptionRequestId);
    }
    
    function confirmRedemptionRequestPayment(
        IAttestationClient.LegalPayment calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyLegalPayment(state.settings, _payment, false);
        Redemption.confirmRedemptionRequestPayment(state, paymentInfo, _redemptionRequestId);
    }
    
    function redemptionPaymentTimeout(
        IAttestationClient.BlockHeightExists calldata _proof,
        uint64 _redemptionRequestId
    )
        external
    {
        uint64 underlyingBlock = TransactionAttestation.verifyBlockHeightExists(state.settings, _proof);
        Redemption.redemptionPaymentTimeout(state, _redemptionRequestId, underlyingBlock);
    }
    
    function redemptionPaymentBlocked(
        IAttestationClient.LegalPayment calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        TransactionAttestation.verifyLegalPayment(state.settings, _payment, true);
        require(_payment.status == TransactionAttestation.PAYMENT_BLOCKED,
            "redemption payment not blocked");
        Redemption.redemptionPaymentBlocked(state, _redemptionRequestId);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Self-close
    
    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    )
        external
    {
        // in Redemption.selfClose we check that only agent can do this
        uint256 closedUBA = Redemption.selfClose(state, _agentVault, _amountUBA);
        fAsset.burn(msg.sender, closedUBA);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Allowed payment announcements
    
    function announceAllowedPayment(
        address _agentVault,
        uint256 _valueUBA
    )
        external
    {
        AllowedPaymentAnnouncement.announceAllowedPayment(state, _agentVault, _valueUBA);
    }
    
    function reportAllowedPayment(
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        external
    {
        AllowedPaymentAnnouncement.reportAllowedPayment(state, _paymentInfo, _agentVault, _announcementId);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup

    function confirmTopupPayment(
        IAttestationClient.LegalPayment calldata _payment,
        address _agentVault
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyLegalPayment(state.settings, _payment, false);
        UnderlyingFreeBalance.confirmTopupPayment(state, paymentInfo, _agentVault);
    }
    
    function triggerTopupLiquidation(
        IAttestationClient.BlockHeightExists calldata _proof,
        address _agentVault
    )
        internal
    {
        uint64 underlyingBlock = TransactionAttestation.verifyBlockHeightExists(state.settings, _proof);
        UnderlyingFreeBalance.triggerTopupLiquidation(state, _agentVault, underlyingBlock);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Illegal payment and wrong payment report challenges
    
    function createIllegalPaymentChallenge(
        address _agentVault,
        bytes32 _transactionHash
    )
        external
    {
        IllegalPaymentChallenge.createChallenge(state, _agentVault, _transactionHash);
    }
    
    function confirmIllegalPaymentChallenge(
        IAttestationClient.SourceUsingTransaction calldata _transaction
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifySourceUsingTransaction(state.settings, _transaction);
        IllegalPaymentChallenge.confirmChallenge(state, paymentInfo);
    }
    
    function challengeWrongPaymentReportWithPayment(
        IAttestationClient.LegalPayment calldata _payment,
        address _agentVault
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyLegalPayment(state.settings, _payment, false);
        IllegalPaymentChallenge.confirmWrongReportChallenge(state, paymentInfo, _agentVault);
    }
    
    function challengeWrongPaymentReportWithTransaction(
        IAttestationClient.SourceUsingTransaction calldata _transaction,
        address _agentVault
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifySourceUsingTransaction(state.settings, _transaction);
        IllegalPaymentChallenge.confirmWrongReportChallenge(state, paymentInfo, _agentVault);
    }
    
    ////////////////////////////////////////////////////////////////////////////////////
    // Liquidation

    function startLiquidation(
        address _agentVault
    )
        external
    {
        Liquidation.startLiquidation(state, _agentVault, false);
    }
    
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        external
    {
        uint64 amountAMG = Conversion.convertUBAToAmg(state.settings, _amountUBA);
        uint64 liquidatedAMG = Liquidation.liquidate(state, _agentVault, amountAMG);
        uint256 liquidatedUBA = Conversion.convertAmgToUBA(state.settings, liquidatedAMG);
        fAsset.burn(msg.sender, liquidatedUBA);
    }
    
    function cancelLiquidation(
        address _agentVault
    )
        external
    {
        Liquidation.cancelLiquidation(state, _agentVault);
    }
}
