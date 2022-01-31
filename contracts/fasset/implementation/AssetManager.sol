// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
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
import "../library/UnderlyingAddressOwnership.sol";
import "../library/Redemption.sol";
import "../library/IllegalPaymentChallenge.sol";
import "../../utils/lib/SafeBips.sol";
import "../../utils/lib/SafeMath64.sol";

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
        bytes32 _underlyingAddress,
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo = 
            TransactionAttestation.verifyLegalPayment(state.settings, _payment, true);
        require(paymentInfo.sourceAddress == _underlyingAddress, "wrong underlying address");
        UnderlyingAddressOwnership.claimWithProof(state.underlyingAddressOwnership, 
            paymentInfo, _agentVault, _underlyingAddress);
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
        bytes32 _underlyingAddress
    ) 
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.createAgent(state, _agentType, _agentVault, _underlyingAddress);
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
    
    function exitAvailableAgentList(
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        AvailableAgents.exit(state, _agentVault);
    }
    
    function getAvailableAgentsList(
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getList(state, _start, _end);
    }

    function getAvailableAgentsDetailedList(
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (AvailableAgents.AvailableAgentInfo[] memory _agents, uint256 _totalLength)
    {
        uint256 amgToNATWeiPrice = Conversion.currentAmgToNATWeiPrice(state.settings);
        return AvailableAgents.getListWithInfo(state, amgToNATWeiPrice,_start, _end);
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
     */
    function redeem(
        uint64 _lots,
        bytes32 _redeemerUnderlyingAddress,
        uint64 _currentUnderlyingBlock
    )
        external
    {
        uint64 redeemedLots = Redemption.redeem(state, msg.sender, _lots, 
            _redeemerUnderlyingAddress, _currentUnderlyingBlock);
        uint256 redeemedUBA = Conversion.convertLotsToUBA(state.settings, redeemedLots);
        fAsset.burn(msg.sender, redeemedUBA);
    }
    
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
    // Challenge
    
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

}
