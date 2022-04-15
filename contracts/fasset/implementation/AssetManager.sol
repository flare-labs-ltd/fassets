// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interface/IAgentVault.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAssetManagerEvents.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../interface/IFAsset.sol";
import "../implementation/AgentVault.sol";
import "../library/AssetManagerState.sol";
import "../library/AssetManagerSettings.sol";
import "../library/Conversion.sol";
import "../library/PaymentConfirmations.sol";
// external
import "../library/SettingsUpdater.sol";
import "../library/StateUpdater.sol";
import "../library/AvailableAgents.sol";
import "../library/Agents.sol";
import "../library/CollateralReservations.sol";
import "../library/Minting.sol";
import "../library/Redemption.sol";
import "../library/Challenges.sol";
import "../library/Liquidation.sol";
import "../library/AllowedPaymentAnnouncement.sol";
import "../library/UnderlyingFreeBalance.sol";
import "../library/FullAgentInfo.sol";


/**
 * The contract that can mint and burn f-assets while managing collateral and backing funds.
 * There is one instance of AssetManager per f-asset type.
 */
contract AssetManager is ReentrancyGuard, IAssetManager, IAssetManagerEvents {
    AssetManagerState.State private state;
    SettingsUpdater.PendingUpdates private pendingUpdates;
    IFAsset public immutable fAsset;
    
    uint256 internal constant MINIMUM_PAUSE_BEFORE_STOP = 30 days;

    modifier onlyAssetManagerController {
        require(msg.sender == state.settings.assetManagerController, "only asset manager controller");
        _;
    }
    
    constructor(
        AssetManagerSettings.Settings memory _settings,
        IFAsset _fAsset
    ) {
        fAsset = _fAsset;
        SettingsUpdater.validateAndSet(state, _settings);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Settings update

    /**
     * Update all settings with validation.
     * This method cannot be called directly, it has to be called through assetManagerController.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */    
    function updateSettings(
        bytes32 _method,
        bytes calldata _params
    ) 
        external
        onlyAssetManagerController
    {
        SettingsUpdater.callUpdate(state, pendingUpdates, _method, _params);
    }

    /**
     * In update, all settings must be set (and some must stay unchanged), so the updater must call
     * getSetings and then updateSettings with modified structure.
     * @return the current settings
     */
    function getSettings() 
        external view
        returns (AssetManagerSettings.Settings memory)
    {
        return state.settings;
    }
    
    /**
     * Get the asset manager controller, the only address that can change settings.
     */
    function assetManagerController()
        external view
        returns (address)
    {
        return state.settings.assetManagerController;
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
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payment proof of payment on the underlying chain
     */
    function proveUnderlyingAddressEOA(
        IAttestationClient.Payment calldata _payment
    )
        external
    {
        requireWhitelistedSender();
        Agents.claimAddressWithEOAProof(state, _payment);
    }
    
    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults, 
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _underlyingAddressString full address on the underlying chain (not hash)
     */
    function createAgent(
        string memory _underlyingAddressString
    ) 
        external
    {
        requireWhitelistedSender();
        IAgentVault agentVault = new AgentVault(this, msg.sender);
        Agents.createAgent(state, Agents.AgentType.AGENT_100, address(agentVault), _underlyingAddressString);
    }
    
    /**
     * Announce that the agent is going to be destroyed. At this time, agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     */
    function announceDestroyAgent(
        address _agentVault
    )
        external
    {
        Agents.announceDestroy(state, _agentVault);
    }
    
    /**
     * Delete all agent data, selfdestruct agent vault and send remaining collateral to the `_recipient`.
     * Procedure for destroying agent:
     * - exit available agents list
     * - wait until all assets are redeemed or perform self-close
     * - announce destroy (and wait the required time)
     * - call destroyAgent()
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault address of the agent's vault to destroy
     * @param _recipient the address where the remaining funds from the vault will be transfered (as native currency)
     */
    function destroyAgent(
        address _agentVault,
        address payable _recipient
    )
        external
    {
        Agents.destroyAgent(state, _agentVault);
        IAgentVault(_agentVault).destroy(state.settings.wNat, _recipient);
    }
    
    /**
     * Set the ratio at which free collateral for the minting will be accounted.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _agentMinCollateralRatioBIPS the new ratio in BIPS
     */
    function setAgentMinCollateralRatioBIPS(
        address _agentVault,
        uint256 _agentMinCollateralRatioBIPS
    )
        external
    {
        Agents.setAgentMinCollateralRatioBIPS(state, _agentVault, _agentMinCollateralRatioBIPS);
    }
    
    /**
     * Return basic info about an agent, typically needed by a minter.
     * @param _agentVault agent vault address
     * @return structure containing agent's minting fee (BIPS), min collateral ratio (BIPS),
     *      and current free collateral (lots)
     */
    function getAgentInfo(
        address _agentVault
    )
        external view
        returns (FullAgentInfo.AgentInfo memory)
    {
        return FullAgentInfo.getAgentInfo(state, _agentVault);
    }

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     */
    function announceCollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        Agents.announceWithdrawal(state, _agentVault, _valueNATWei);
    }

    /**
     * Called by AgentVault when agent calls `withdraw()`.
     * NOTE: may not be called directly from any EOA address (only through a registered agent vault).
     * @param _valueNATWei the withdrawn amount
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
     * Called by AgentVault when there was a deposit.
     * May pull agent out of liquidation.
     * NOTE: may not be called directly from any EOA address (only through a registered agent vault).
     * @param _valueNATWei the deposited amount
     */
    function depositCollateral(
        uint256 _valueNATWei
    )
        external override
    {
        // Agents.depositExecuted makes sure that only a registered agent vault can call
        Agents.depositExecuted(state, msg.sender, _valueNATWei);
    }
    
    /**
     * After a lot size change by the governance, it may happen that after a redemption
     * there remains less than one lot on a redemption ticket. This is named "dust" and
     * can be self closed or liquidated, but not redeemed. However, after several such redemptions,
     * the total dust can amount to more than one lot. Using this method, the amount, rounded down
     * to a whole number of lots, can be converted to a new redemption ticket.
     * NOTE: we do NOT check that the caller is the agent vault owner, since we want to
     * allow anyone to convert dust to tickets to increase asset fungibility.
     * @param _agentVault agent vault address
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
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
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
        AvailableAgents.makeAvailable(state, _agentVault, _feeBIPS, _agentMinCollateralRatioBIPS);
    }
    
    /**
     * Exit the publicly available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function exitAvailableAgentList(
        address _agentVault
    )
        external
    {
        AvailableAgents.exit(state, _agentVault);
    }
    
    /**
     * Get (a part of) the list of available agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
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
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsDetailedList(
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (AvailableAgents.AgentInfo[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getListWithInfo(state, _start, _end);
    }
    
    ////////////////////////////////////////////////////////////////////////////////////
    // Timekeeping
    
    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     * NOTE: anybody can call.
     * @param _proof proof that a block with given number and timestamp exists
     */
    function updateCurrentBlock(
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof
    )
        external
    {
        StateUpdater.updateCurrentBlock(state, _proof);
    }
    
    /**
     * Get block number and timestamp of the current underlying block.
     * @return _blockNumber current underlying block number tracked by asset manager
     * @return _blockTimestamp current underlying block timestamp tracked by asset manager
     */
    function currentUnderlyingBlock()
        external view
        returns (uint256 _blockNumber, uint256 _blockTimestamp)
    {
        return (state.currentUnderlyingBlock, state.currentUnderlyingBlockTimestamp);
    }
        
    ////////////////////////////////////////////////////////////////////////////////////
    // Minting
    
    /**
     * Before paying underlying assets for minting, minter has to reserve collateral and
     * pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio
     * to requested lots NAT market price.
     * On success the minter receives instructions for underlying payment (value, fee and payment reference) 
     * in event CollateralReserved. Then the minter has to pay `value + fee` on the underlying chain.
     * If the minter pays the underlying amount, the collateral reservation fee is burned and minter obtains
     * f-assets. Otherwise the agent collects the collateral reservation fee.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @param _lots the number of lots for which to reserve collateral
     * @param _maxMintingFeeBIPS maximum minting fee (BIPS) that can be charged by the agent - best is just to
     *      copy current agent's published fee; used to prevent agent from front-running reservation request
     *      and increasing fee (that would mean that the minter would have to pay raised fee or forfeit
     *      collateral reservation fee)
     */
    function reserveCollateral(
        address _agentVault, 
        uint256 _lots,
        uint256 _maxMintingFeeBIPS
    ) 
        external payable 
    {
        requireWhitelistedSender();
        CollateralReservations.reserveCollateral(state, msg.sender, _agentVault, 
            SafeCast.toUint64(_lots), SafeCast.toUint64(_maxMintingFeeBIPS));
    }

    /**
     * Return the collateral reservation fee amount that has to be passed to the reserveCollateral method.
     * @param _lots the number of lots for which to reserve collateral
     * @return _reservationFeeNATWei the amount of reservation fee in NAT wei
     */
    function collateralReservationFee(
        uint256 _lots
    )
        external view
        returns (uint256 _reservationFeeNATWei)
    {
        return CollateralReservations.calculateReservationFee(state, SafeCast.toUint64(_lots));
    }
    
    /**
     * After obtaining proof of underlying payment, the minter calls this method to finish the minting
     * and collect the minted f-assets.
     * NOTE: may only be called by the minter (= creator of CR, the collateral reservation request) 
     *   or the agent owner (= owner of the agent vault in CR).
     * @param _payment proof of the underlying payment (must contain exact `value + fee` amount and correct 
     *      payment reference)
     * @param _collateralReservationId collateral reservation id
     */
    function executeMinting(
        IAttestationClient.Payment calldata _payment,
        uint256 _collateralReservationId
    ) 
        external 
        nonReentrant
    {
        (address minter, uint256 mintedUBA) = Minting.mintingExecuted(state, _payment, 
            SafeCast.toUint64(_collateralReservationId));
        fAsset.mint(minter, mintedUBA);
    }

    /**
     * When the time for minter to pay underlying amount is over (i.e. the last underlying block has passed),
     * the agent can declare payment default. Then the agent collects collateral reservation fee 
     * (it goes directly to the vault), and the reseved collateral is unlocked.
     * NOTE: may only be called by the owner of the agent vault in the collateral reservation request.
     * @param _proof proof that the minter didn't pay with correct payment reference on the underlying chain
     * @param _collateralReservationId id of a collateral reservation created by the minter
     */
    function mintingPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _proof,
        uint256 _collateralReservationId
    )
        external
    {
        CollateralReservations.mintingPaymentDefault(state, _proof, SafeCast.toUint64(_collateralReservationId));
    }
    
    /**
     * If collateral reservation request exists for more than 24 hours, payment or non-payment proof are no longer
     * available. In this case agent can call this method, which burns reserved collateral at market price
     * and releases the remaining collateral (CRF is also burned).
     * NOTE: may only be called by the owner of the agent vault in the collateral reservation request.
     * @param _collateralReservationId collateral reservation id
     */
    function unstickMinting(
        uint256 _collateralReservationId
    ) 
        external 
        nonReentrant
    {
        CollateralReservations.unstickMinting(state, SafeCast.toUint64(_collateralReservationId));
    }
    
    /**
     * Agent can mint against himself. In that case, this is a one-step process, skipping collateral reservation
     * and no collateral reservation fee payment.
     * Moreover, the agent doesn't have to be on the publicly available agents list to self-mint.
     * NOTE: may only be called by the agent vault owner.
     * @param _payment proof of the underlying payment; must contain payment reference of the form
     *      `0x4642505266410012000...0<agent_vault_address>`
     * @param _agentVault agent vault address
     * @param _lots number of lots to mint
     */
    function selfMint(
        IAttestationClient.Payment calldata _payment,
        address _agentVault,
        uint256 _lots
    ) 
        external
        nonReentrant
    {
        uint256 mintedUBA = Minting.selfMint(state, _payment, _agentVault, SafeCast.toUint64(_lots));
        fAsset.mint(msg.sender, mintedUBA);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Redemption
    
    /**
     * Redeem (up to) `_lots` lots of f-assets. The corresponding ammount of the f-assets belonging
     * to the redeemer will be burned and the redeemer will get paid by the agent in underlying currency
     * (or, in case of agent's payment default, by agent's collateral with a premium).
     * NOTE: in some cases not all sent f-assets can be redeemed (either there are not enough tickets or
     * more than a fixed limit of tickets should be redeemed). In this case only part of the approved assets
     * are burned and redeemed and the redeemer can execute this method again for the remaining lots.
     * In such case `RedemptionRequestIncomplete` event will be emitted, indicating the number of remaining lots.
     * Agent receives redemption request id and instructions for underlying payment in 
     * RedemptionRequested event and has to pay `value - fee` and use the provided payment reference.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _lots number of lots to redeem
     * @param _redeemerUnderlyingAddressString the address to which the agent must transfer underlyng amount
     */
    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString
    )
        external
    {
        requireWhitelistedSender();
        uint256 redeemedUBA = Redemption.redeem(state, msg.sender, SafeCast.toUint64(_lots), 
            _redeemerUnderlyingAddressString);
        fAsset.burn(msg.sender, redeemedUBA);
    }
    
    /**
     * After paying to the redeemer, the agent must call this method to unlock the collateral
     * and to make sure that the redeemer cannot demand payment in collateral on timeout.
     * The same method must be called for any payment status (SUCCESS, FAILED, BLOCKED).
     * In case of FAILED, it just releases agent's underlying funds and the redeemer gets paid in collateral
     * after calling redemptionPaymentDefault.
     * In case of SUCCESS or BLOCKED, remaining underlying funds and collateral are relased to the agent.
     * If the agent doesn't confirm payment in enough time (several hours, setting confirmationByOthersAfterSeconds),
     * anybody can do it and get rewarded from agent's vault.
     * NOTE: may only be called by the owner of the agent vault in the redemption request
     *   except if enough time has passed without confirmation - then it can be called by anybody
     * @param _payment proof of the underlying payment (must contain exact `value - fee` amount and correct 
     *      payment reference)
     * @param _redemptionRequestId id of an existing redemption request
     */    
    function confirmRedemptionPayment(
        IAttestationClient.Payment calldata _payment,
        uint256 _redemptionRequestId
    )
        external
    {
        Redemption.confirmRedemptionPayment(state, _payment, SafeCast.toUint64(_redemptionRequestId));
    }

    /**
     * If the agent doesn't transfer the redeemed underlying assets in time (until the last allowed block on
     * the underlying chain), the redeemer calls this method and receives payment in collateral (with some extra).
     * The agent can also call default if the redeemer is unresponsive, to payout the redeemer and free the
     * remaining collateral.
     * NOTE: may only be called by the redeemer (= creator of the redemption request)
     *   or the agent owner (= owner of the agent vault in the redemption request)
     * @param _proof proof that the agent didn't pay with correct payment reference on the underlying chain
     * @param _redemptionRequestId id of an existing redemption request
     */    
    function redemptionPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _proof,
        uint256 _redemptionRequestId
    )
        external
    {
        Redemption.redemptionPaymentDefault(state, _proof, SafeCast.toUint64(_redemptionRequestId));
    }
    
    /**
     * If the agent hasn't performed the payment, the agent can close the redemption request to free underlying funds.
     * It can be done immediatelly after the redeemer or agent calls redemptionPaymentDefault,
     * or this method can trigger the default payment without proof, but only after enough time has passed so that 
     * attestation proof of non-payment is not available any more.
     * NOTE: may only be called by the owner of the agent vault in the redemption request.
     * @param _redemptionRequestId id of an existing, but already defaulted, redemption request
     */
    function finishRedemptionWithoutPayment(
        uint256 _redemptionRequestId
    )
        external
    {
        Redemption.finishRedemptionWithoutPayment(state, SafeCast.toUint64(_redemptionRequestId));
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Self-close
    
    /**
     * Agent can "redeem against himself" by calling selfClose, which burns agent's own f-assets
     * and unlocks agent's collateral. The underlying funds backing the f-assets are released
     * as agent's free underlying funds and can be later withdrawn after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _amountUBA amount of f-assets to self-close
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
    
    /**
     * Announce withdrawal of underlying currency.
     * In the event AllowedPaymentAnnounced the agent receives payment reference, which must be
     * added to the payment, otherwise it can be challenged as illegal.
     * Until the announced payment is performed and confirmed, no other allowed payment can be announced.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function announceAllowedPayment(
        address _agentVault
    )
        external
    {
        AllowedPaymentAnnouncement.announceAllowedPayment(state, _agentVault);
    }
    
    /**
     * Agent must provide confirmation of performed allowed payment, which updates free balance with used gas
     * and releases announcement so that a new one can be made.
     * If the agent doesn't call this method, anyone can call it after a time (confirmationByOthersAfterSeconds).
     * NOTE: may only be called by the owner of the agent vault
     *   except if enough time has passed without confirmation - then it can be called by anybody.
     * @param _payment proof of the underlying payment
     * @param _agentVault agent vault address
     * @param _announcementId id of the allowed payment announcement
     */
    function confirmAllowedPayment(
        IAttestationClient.Payment calldata _payment,
        address _agentVault,
        uint256 _announcementId
    )
        external
    {
        AllowedPaymentAnnouncement.confirmAllowedPayment(state, _payment, _agentVault, 
            SafeCast.toUint64(_announcementId));
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup

    /**
     * When the agent tops up his underlying address, it has to be confirmed by calling this method,
     * which updates the underlying free balance value.
     * NOTE: may only be called by the agent vault owner.
     * @param _payment proof of the underlying payment; must include payment
     *      reference of the form `0x4642505266410011000...0<agents_vault_address>`
     * @param _agentVault agent vault address
     */
    function confirmTopupPayment(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    )
        external
    {
        UnderlyingFreeBalance.confirmTopupPayment(state, _payment, _agentVault);
    }
    
    ////////////////////////////////////////////////////////////////////////////////////
    // Illegal payment and wrong payment report challenges
    
    /**
     * Called with a proof of payment made from agent's underlying address, for which
     * no valid payment reference exists (valid payment references are from redemption and
     * allowed payment announcement calls).
     * On success, immediatelly triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _transaction proof of a transaction from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function illegalPaymentChallenge(
        IAttestationClient.BalanceDecreasingTransaction calldata _transaction,
        address _agentVault
    )
        external
    {
        requireWhitelistedSender();
        Challenges.illegalPaymentChallenge(state, _transaction, _agentVault);
    }

    /**
     * Called with proofs of two payments made from agent's underlying address
     * with the same payment reference (each payment reference is valid for only one payment).
     * On success, immediatelly triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payment1 proof of first payment from the agent's underlying address
     * @param _payment2 proof of second payment from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function doublePaymentChallenge(
        IAttestationClient.BalanceDecreasingTransaction calldata _payment1,
        IAttestationClient.BalanceDecreasingTransaction calldata _payment2,
        address _agentVault
    )
        external
    {
        requireWhitelistedSender();
        Challenges.doublePaymentChallenge(state, _payment1, _payment2, _agentVault);
    }
    
    /**
     * Called with proofs of several (otherwise legal) payments, which together make agent's 
     * underlying free balance negative (i.e. the underlying address balance is less than
     * the total amount of backed f-assets).
     * On success, immediatelly triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payments proofs of several distinct payments from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function freeBalanceNegativeChallenge(
        IAttestationClient.BalanceDecreasingTransaction[] calldata _payments,
        address _agentVault
    )
        external
    {
        requireWhitelistedSender();
        Challenges.paymentsMakeFreeBalanceNegative(state, _payments, _agentVault);
    }
    
    ////////////////////////////////////////////////////////////////////////////////////
    // Liquidation

    /**
     * Checks that the agent's collateral is too low and if true, starts agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     */
    function startLiquidation(
        address _agentVault
    )
        external
    {
        requireWhitelistedSender();
        Liquidation.startLiquidation(state, _agentVault);
    }
    
    /**
     * Burns up to `_amountUBA` f-assets owned by the caller and pays
     * the caller the corresponding amount of native currency with premium
     * (premium depends on the liquidation state).
     * If the agent isn't in liquidation yet, but satisfies conditions,
     * automatically puts the agent in liquidation status.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @param _amountUBA the amount of f-assets to liquidate
     */
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        external
    {
        requireWhitelistedSender();
        uint256 liquidatedUBA = Liquidation.liquidate(state, _agentVault, _amountUBA);
        fAsset.burn(msg.sender, liquidatedUBA);
    }
    
    /**
     * When agent's colateral reaches safe level during liquidation, the liquidation
     * process can be stopped by calling this method.
     * Full liquidation (i.e. the liquidation triggered by illegal underlying payment)
     * cannot be canceled.
     * NOTE: anybody can call.
     * @param _agentVault agent vault address
     */
    function cancelLiquidation(
        address _agentVault
    )
        external
    {
        Liquidation.cancelLiquidation(state, _agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Upgrade (second phase)

    /**
     * When asset manager is paused, no new minting can be made.
     * All other operations continue normally.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function pause()
        external
        onlyAssetManagerController
    {
        if (state.pausedAt == 0) {
            state.pausedAt = SafeCast.toUint64(block.timestamp);
        }
    }
    
    /**
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used only when the asset manager minting has been already paused
     * for a long time but there still exist unredeemable f-assets. In such case, the f-asset contract is
     * terminated and then agents can buy back the collateral at market rate (i.e. they burn market value
     * of backed f-assets in collateral to release the rest of the collateral).
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function terminate()
        external
        onlyAssetManagerController
    {
        require(state.pausedAt != 0 && block.timestamp > state.pausedAt + MINIMUM_PAUSE_BEFORE_STOP,
            "asset manager not paused enough");
        fAsset.terminate();
    }
    
    /**
     * When f-asset is terminated, agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when AssetManager is already paused
     * at least for a month and most f-assets are already burned and the only ones remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     */
    function buybackAgentCollateral(
        address _agentVault
    )
        external
    {
        require(fAsset.terminated(), "f-asset not terminated");
        Agents.buybackAgentCollateral(state, _agentVault);
    }

    /**
     * True if asset manager is paused.
     */    
    function paused()
        external view
        returns (bool)
    {
        return state.pausedAt != 0;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Other

    /**
     * Get WNat contract. Used by AgentVault.
     * @return WNat contract
     */    
    function getWNat() 
        external view 
        returns (IWNat)
    {
        return state.settings.wNat;
    }
    
    /**
     * Optional check that `msg.sender` is whitelisted.
     */
    function requireWhitelistedSender()
        internal view
    {
        if (address(state.settings.whitelist) != address(0)) {
            require(state.settings.whitelist.whitelisted(msg.sender), "not whitelisted");
        }
    }
}
