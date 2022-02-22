// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interface/IAgentVault.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAttestationClient.sol";
import "../interface/IFAsset.sol";
import "../implementation/AgentVault.sol";
import "../library/AssetManagerState.sol";
import "../library/AssetManagerSettings.sol";
import "../library/Conversion.sol";
import "../library/Contracts.sol";
import "../library/TransactionAttestation.sol";
import "../library/PaymentVerification.sol";
// external
import "../library/AvailableAgents.sol";
import "../library/Agents.sol";
import "../library/CollateralReservations.sol";
import "../library/Minting.sol";
import "../library/Redemption.sol";
import "../library/Challenges.sol";
import "../library/Liquidation.sol";
import "../library/AllowedPaymentAnnouncement.sol";
import "../library/UnderlyingFreeBalance.sol";


/**
 * The contract that can mint and burn f-assets while managing collateral and backing funds.
 * There is one instance of AssetManager per f-asset type.
 */
contract AssetManager is ReentrancyGuard, IAssetManager {
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
     * This method fixes the underlying address to be used by given agent owner.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to this method caller's address.
     * NOTE: calling this method before `createAgent()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     */
    function claimAgentUnderlyingAddress(
        IAttestationClient.PaymentProof calldata _payment
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProofSuccess(state.settings, _payment, true);
        UnderlyingAddressOwnership.claimWithProof(state.underlyingAddressOwnership, 
            paymentInfo, state.paymentVerifications, msg.sender, paymentInfo.sourceAddressHash);
    }
    
    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults, 
     *  but in fasset system, each agent vault acts as an independent agent.)
     */
    function createAgent(
        Agents.AgentType _agentType,
        bytes memory _underlyingAddressString
    ) 
        external
    {
        IAgentVault agentVault = new AgentVault(this, Contracts.getWNat(state.settings), msg.sender);
        Agents.createAgent(state, _agentType, address(agentVault), _underlyingAddressString);
    }
    
    /**
     * Delete all agent data. Only used internally by AgentVault.destroy().
     * Procedure for destroying agent:
     * - exit available agents list
     * - wait until all assets are redeemed or self-close
     * - announce withdrawal of full collateral (and wait the required time)
     * - call agentVault.destroy()
     */
    function destroyAgent(
        address _agentVault
    )
        external override
    {
        require(_agentVault == msg.sender, "call agentVault.destroy()");
        Agents.destroyAgent(state, _agentVault);
    }
    
    /**
     * Set the ratio at which free collateral for the minting will be accounted.
     */
    function setAgentMinCollateralRatioBIPS(
        address _agentVault,
        uint256 _agentMinCollateralRatioBIPS
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.setAgentMinCollateralRatioBIPS(state, _agentVault, _agentMinCollateralRatioBIPS);
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
        external override
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
     * @param _feeBIPS fee charged to minters (paid in underlying currency along with backing assets)
     * @param _agentMinCollateralRatioBIPS when agent is created, free colateral is accounted at the
     *  global min collateral ratio; for public agents this can very quickly lead to liquidation,
     *  therefore it is required for agent to set it when becoming available.
     *  Note that agentMinCollateralRatioBIPS can also be set separately by setAgentMinCollateralRatioBIPS method.
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
    // Timekeeping
    
    function updateCurrentBlock(
        IAttestationClient.BlockHeightExists calldata _proof
    )
        external
    {
        (uint64 underlyingBlock, uint64 underlyingBlockTimestamp) = 
            TransactionAttestation.verifyBlockHeightExists(state.settings, _proof);
        bool changed = false;
        if (underlyingBlock > state.currentUnderlyingBlock) {
            state.currentUnderlyingBlock = underlyingBlock;
            changed = true;
        }
        if (underlyingBlockTimestamp > state.currentUnderlyingBlockTimestamp) {
            state.currentUnderlyingBlockTimestamp = underlyingBlockTimestamp;
            changed = true;
        }
        if (changed) {
            state.currentUnderlyingBlockUpdatedAt = SafeCast.toUint64(block.timestamp);
        }
    }
    
    function currentUnderlyingBlock()
        external view
        returns (uint64 _blockNumber, uint64 _blockTimestamp)
    {
        return (state.currentUnderlyingBlock, state.currentUnderlyingBlockTimestamp);
    }
        
    ////////////////////////////////////////////////////////////////////////////////////
    // Minting
    
    /**
     * Before paying underlying assets for minting, minter has to reserve collateral and
     * pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio
     * to requested lots NAT market price.
     * @param _selectedAgent agent's vault address
     * @param _lotsToMint the number of lots for which to reserve collateral
     */
    function reserveCollateral(
        address _selectedAgent, 
        uint64 _lotsToMint
    ) 
        external payable 
    {
        CollateralReservations.reserveCollateral(state, msg.sender, _selectedAgent, _lotsToMint);
    }
    
    /**
     * After obtaining proof of underlying payment, the minter calls this method to finish the minting
     * and collect the minted f-assets.
     */
    function executeMinting(
        IAttestationClient.PaymentProof calldata _payment,
        uint64 _crtId
    ) 
        external 
        nonReentrant
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProofSuccess(state.settings, _payment, false);
        (address minter, uint256 mintedUBA) = Minting.mintingExecuted(state, paymentInfo, _crtId);
        fAsset.mint(minter, mintedUBA);
    }

    /**
     * When the time for minter to pay underlying amount is over (i.e. the last underlying block has passed),
     * the agent can declare payment timeout. Then the agent collects collateral reservation fee 
     * (it goes directly to the vault), and the reseved collateral is unlocked.
     */
    function mintingPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _proof,
        uint64 _crtId
    )
        external
    {
        TransactionAttestation.verifyReferencedPaymentNonexistence(state.settings, _proof);
        CollateralReservations.collateralReservationTimeout(state, _proof, _crtId);
    }
    
    /**
     * Agent can mint against himself. In that case, this is a one-step process, skipping collateral reservation
     * and no collateral reservation fee payment.
     * Moreover, the agent doesn't have to be on the publicly available agents list to self-mint.
     */
    function selfMint(
        IAttestationClient.PaymentProof calldata _payment,
        address _agentVault,
        uint64 _lots
    ) 
        external 
    {
        Agents.requireAgentVaultOwner(_agentVault);
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProofSuccess(state.settings, _payment, false);
        uint256 mintedUBA = Minting.selfMint(state, paymentInfo, _agentVault, _lots);
        fAsset.mint(msg.sender, mintedUBA);
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
     */
    function redeem(
        uint64 _lots,
        bytes memory _redeemerUnderlyingAddressString
    )
        external
    {
        uint64 redeemedLots = Redemption.redeem(state, msg.sender, _lots, _redeemerUnderlyingAddressString);
        uint256 redeemedUBA = Conversion.convertLotsToUBA(state.settings, redeemedLots);
        fAsset.burn(msg.sender, redeemedUBA);
    }
    
    /**
     * After paying to the redeemer, the agent must call this method to unlock the collateral
     * and to make sure that the redeemer cannot demand payment in collateral on timeout.
     */    
    function confirmRedemptionPayment(
        IAttestationClient.PaymentProof calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProofSuccess(state.settings, _payment, false);
        Redemption.confirmRedemptionPayment(state, paymentInfo, _redemptionRequestId);
    }

    /**
     * If the agent doesn't transfer the redeemed underlying assets in time (until the last allowed block on
     * the underlying chain), the redeemer calls this method and receives payment in collateral (with some extra).
     */    
    function redemptionPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _proof,
        uint64 _redemptionRequestId
    )
        external
    {
        TransactionAttestation.verifyReferencedPaymentNonexistence(state.settings, _proof);
        Redemption.redemptionPaymentDefault(state, _proof, _redemptionRequestId);
    }
    
    /**
     * If the agent cannot perform the payment due to redeemer's fault (redeemer blocking the target address,
     * which is for example possible with a contract on EVM chains), the agent doesn't have to pay anymore,
     * and can keep both the collateral and underlying funds.
     */
    function redemptionPaymentBlocked(
        IAttestationClient.PaymentProof calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProof(state.settings, _payment, true);
        require(_payment.status == TransactionAttestation.PAYMENT_BLOCKED,
            "redemption payment not blocked");
        Redemption.redemptionPaymentBlocked(state, paymentInfo, _redemptionRequestId);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Self-close
    
    /**
     * Agent can "redeem against himself" by calling selfClose, which burns agent's own f-assets
     * and unlocks agent's collateral. The underlying funds backing the f-assets are released
     * as agent's free underlying funds and can be later withdrawn after announcement.
     */
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
        address _agentVault
    )
        external
    {
        AllowedPaymentAnnouncement.announceAllowedPayment(state, _agentVault);
    }
    
    function confirmAllowedPayment(
        IAttestationClient.PaymentProof calldata _payment,
        address _agentVault,
        uint64 _announcementId
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProof(state.settings, _payment, false);
        AllowedPaymentAnnouncement.confirmAllowedPayment(state, paymentInfo, _agentVault, _announcementId);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup

    function confirmTopupPayment(
        IAttestationClient.PaymentProof calldata _payment,
        address _agentVault
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyPaymentProofSuccess(state.settings, _payment, false);
        UnderlyingFreeBalance.confirmTopupPayment(state, paymentInfo, _agentVault);
    }
    
    ////////////////////////////////////////////////////////////////////////////////////
    // Illegal payment and wrong payment report challenges
    
    function illegalPaymentChallenge(
        IAttestationClient.BalanceDecreasingTransaction calldata _transaction,
        address _agentVault
    )
        external
    {
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyBalanceDecreasingTransaction(state.settings, _transaction);
        Challenges.illegalPaymentChallenge(state, paymentInfo, _agentVault);
    }
    
    // TODO: add other types
    
    
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
