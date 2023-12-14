// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interface/IIAgentVault.sol";
import "../interface/IIAssetManager.sol";
import "../../stateConnector/interface/ISCProofVerifier.sol";
import "../interface/IFAsset.sol";
import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
import "../library/LiquidationStrategy.sol";
// external
import "../library/SettingsUpdater.sol";
import "../library/StateUpdater.sol";
import "../library/AvailableAgents.sol";
import "../library/AgentsExternal.sol";
import "../library/AgentsCreateDestroy.sol";
import "../library/CollateralReservations.sol";
import "../library/Minting.sol";
import "../library/RedemptionRequests.sol";
import "../library/RedemptionConfirmations.sol";
import "../library/RedemptionFailures.sol";
import "../library/Challenges.sol";
import "../library/Liquidation.sol";
import "../library/UnderlyingWithdrawalAnnouncements.sol";
import "../library/UnderlyingBalance.sol";
import "../library/FullAgentInfo.sol";
import "../library/CollateralTypes.sol";
import "../library/AgentSettingsUpdater.sol";


/**
 * The contract that can mint and burn f-assets while managing collateral and backing funds.
 * There is one instance of AssetManager per f-asset type.
 */
contract AssetManager is ReentrancyGuard, IIAssetManager, IERC165 {
    using SafeCast for uint256;

    uint256 internal constant MINIMUM_PAUSE_BEFORE_STOP = 30 days;

    modifier onlyAssetManagerController {
        _checkOnlyAssetManagerController();
        _;
    }

    modifier onlyAttached {
        _checkOnlyAttached();
        _;
    }

    modifier onlyWhitelistedSender {
        _checkOnlyWhitelistedSender();
        _;
    }

    constructor(
        AssetManagerSettings.Data memory _settings,
        CollateralType.Data[] memory _initialCollateralTypes,
        bytes memory _initialLiquidationSettings
    ) {
        SettingsUpdater.validateAndSet(_settings);
        CollateralTypes.initialize(_initialCollateralTypes);
        LiquidationStrategy.initialize(_initialLiquidationSettings);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Data update

    /**
     * Update all settings with validation.
     * This method cannot be called directly, it has to be called through assetManagerController.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function updateSettings(
        bytes32 _method,
        bytes calldata _params
    )
        external override
        onlyAssetManagerController
    {
        SettingsUpdater.callUpdate(_method, _params);
    }

    /**
     * Get complete current settings.
     * @return the current settings
     */
    function getSettings()
        external view override
        returns (AssetManagerSettings.Data memory)
    {
        return AssetManagerState.getSettings();
    }

    /**
     * Get settings for current liquidation strategy. Format depends on the liquidation strategy implementation.
     * @return the current settings
     */
    function getLiquidationSettings()
        external view override
        returns (bytes memory)
    {
        return LiquidationStrategy.getSettings();
    }

    /**
     * Get the asset manager controller, the only address that can change settings.
     */
    function assetManagerController()
        external view override
        returns (address)
    {
        return AssetManagerState.getSettings().assetManagerController;
    }

    /**
     * When `attached` is true, asset manager has been added to the asset manager controller.
     * Even though the asset manager controller address is set at the construction time, the manager may not
     * be able to be added to the controller immediately because the method addAssetManager must be called
     * by the governance multisig (with timelock). During this time it is impossible to verify through the
     * controller that the asset manager is legit.
     * Therefore creating agents and minting is disabled until the asset manager controller notifies
     * the asset manager that it has been added.
     * The `attached` can be set to false when the retired asset manager is removed from the controller.
     */
    function attachController(bool attached)
        external override
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        state.attached = attached;
    }

    /**
     * When `controllerAttached` is true, asset manager has been added to the asset manager controller.
     */
    function controllerAttached() external view override returns (bool) {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.attached;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent handling

    function setOwnerWorkAddress(address _ownerWorkAddress)
        external override
    {
        AgentsCreateDestroy.setOwnerWorkAddress(_ownerWorkAddress);
    }

    /**
     * This method fixes the underlying address to be used by given agent owner.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to this method caller's address.
     * NOTE: calling this method before `createAgentVault()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     * NOTE: may only be called by a whitelisted agent
     * @param _payment proof of payment on the underlying chain
     */
    function proveUnderlyingAddressEOA(
        Payment.Proof calldata _payment
    )
        external override
    {
        AgentsCreateDestroy.claimAddressWithEOAProof(_payment);
    }

    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults,
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by a whitelisted agent
     * @return _agentVault the new agent vault address
     */
    function createAgentVault(
        AgentSettings.Data calldata _settings
    )
        external override
        onlyAttached
        returns (address _agentVault)
    {
        return AgentsCreateDestroy.createAgentVault(this, _settings);
    }

    /**
     * Announce that the agent is going to be destroyed. At this time, agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @return _destroyAllowedAt the timestamp at which the destroy can be executed
     */
    function announceDestroyAgent(
        address _agentVault
    )
        external override
        returns (uint256 _destroyAllowedAt)
    {
        return AgentsCreateDestroy.announceDestroy(_agentVault);
    }

    /**
     * Delete all agent data, selfdestruct agent vault and send remaining collateral to the `_recipient`.
     * Procedure for destroying agent:
     * - exit available agents list
     * - wait until all assets are redeemed or perform self-close
     * - announce destroy (and wait the required time)
     * - call destroyAgent()
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the remaining funds from the vault will be transferred to the provided recipient.
     * @param _agentVault address of the agent's vault to destroy
     * @param _recipient address that receives the remaining funds and possible vault balance
     */
    function destroyAgent(
        address _agentVault,
        address payable _recipient
    )
        external override
    {
        AgentsCreateDestroy.destroyAgent(_agentVault, _recipient);
    }

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method announces a setting change. The change can be executed after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     * @return _updateAllowedAt the timestamp at which the update can be executed
     */
    function announceAgentSettingUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    )
        external override
        returns (uint256 _updateAllowedAt)
    {
        return AgentSettingsUpdater.announceUpdate(_agentVault, _name, _value);
    }

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method executes a setting change after the timelock expired.
     * NOTE: may only be called by the agent vault owner.
     */
    function executeAgentSettingUpdate(
        address _agentVault,
        string memory _name
    )
        external override
    {
        AgentSettingsUpdater.executeUpdate(_agentVault, _name);
    }

    /**
     * If the current agent's vault collateral token gets deprecated, the agent must switch with this method.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: at the time of switch, the agent must have enough of both collaterals in the vault.
     */
    function switchVaultCollateral(
        address _agentVault,
        IERC20 _token
    )
        external override
    {
        AgentsExternal.switchVaultCollateral(_agentVault, _token);
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
        external view override
        returns (AgentInfo.Info memory)
    {
        return FullAgentInfo.getAgentInfo(_agentVault);
    }

    /**
     * Get (a part of) the list of all agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAllAgents(
        uint256 _start,
        uint256 _end
    )
        external view override
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AgentsExternal.getAllAgents(_start, _end);
    }

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _withdrawalAllowedAt the timestamp when the withdrawal can be made
     */
    function announceVaultCollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    )
        external override
        returns (uint256 _withdrawalAllowedAt)
    {
        return AgentsExternal.announceWithdrawal(Collateral.Kind.VAULT, _agentVault, _valueNATWei);
    }

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _redemptionAllowedAt the timestamp when the redemption can be made
     */
    function announceAgentPoolTokenRedemption(
        address _agentVault,
        uint256 _valueNATWei
    )
        external override
        returns (uint256 _redemptionAllowedAt)
    {
        return AgentsExternal.announceWithdrawal(Collateral.Kind.AGENT_POOL, _agentVault, _valueNATWei);
    }

    /**
     * Called by AgentVault when agent calls `withdraw()`.
     * NOTE: may only be called from an agent vault, not from an EOA address.
     * @param _valueNATWei the withdrawn amount
     */
    function beforeCollateralWithdrawal(
        IERC20 _token,
        uint256 _valueNATWei
    )
        external override
    {
        // AgentsExternal.beforeCollateralWithdrawal makes sure that only a registered agent vault can call
        AgentsExternal.beforeCollateralWithdrawal(_token, msg.sender, _valueNATWei);
    }

    /**
     * Called by AgentVault when there was a deposit.
     * May pull agent out of liquidation.
     * NOTE: may only be called from an agent vault or collateral pool, not from an EOA address.
     */
    function updateCollateral(
        address _agentVault,
        IERC20 _token
    )
        external override
    {
        // AgentsExternal.depositExecuted makes sure that only agent vault or pool can call
        AgentsExternal.depositExecuted(_agentVault, _token);
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
    function convertDustToTicket(
        address _agentVault
    )
        external override
    {
        AgentsExternal.convertDustToTicket(_agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Manage list of agents, publicly available for minting

    /**
     * Add the agent to the list of publicly available agents.
     * Other agents can only self-mint.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function makeAgentAvailable(
        address _agentVault
    )
        external override
    {
        AvailableAgents.makeAvailable(_agentVault);
    }

    /**
     * Announce exit from the publicly available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @return _exitAllowedAt the timestamp when the agent can exit
     */
    function announceExitAvailableAgentList(
        address _agentVault
    )
        external override
        returns (uint256 _exitAllowedAt)
    {
        return AvailableAgents.announceExit(_agentVault);
    }

    /**
     * Exit the publicly available agents list.
     * NOTE: may only be called by the agent vault owner and after announcement.
     * @param _agentVault agent vault address
     */
    function exitAvailableAgentList(
        address _agentVault
    )
        external override
    {
        AvailableAgents.exit(_agentVault);
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
        external view override
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getList(_start, _end);
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
        external view override
        returns (AvailableAgentInfo.Data[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getListWithInfo(_start, _end);
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
        ConfirmedBlockHeightExists.Proof calldata _proof
    )
        external override
    {
        StateUpdater.updateCurrentBlock(_proof);
    }

    /**
     * Get block number and timestamp of the current underlying block.
     * @return _blockNumber current underlying block number tracked by asset manager
     * @return _blockTimestamp current underlying block timestamp tracked by asset manager
     */
    function currentUnderlyingBlock()
        external view override
        returns (uint256 _blockNumber, uint256 _blockTimestamp)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
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
     * NOTE: the owner of the agent vault must be whitelisted agent.
     * @param _agentVault agent vault address
     * @param _lots the number of lots for which to reserve collateral
     * @param _maxMintingFeeBIPS maximum minting fee (BIPS) that can be charged by the agent - best is just to
     *      copy current agent's published fee; used to prevent agent from front-running reservation request
     *      and increasing fee (that would mean that the minter would have to pay raised fee or forfeit
     *      collateral reservation fee)
     * @param _executor the account that is allowed to represent minter in `executeMinting()`
     */
    function reserveCollateral(
        address _agentVault,
        uint256 _lots,
        uint256 _maxMintingFeeBIPS,
        address payable _executor
    )
        external payable override
        onlyAttached
        onlyWhitelistedSender
    {
        CollateralReservations.reserveCollateral(msg.sender, _agentVault,
            _lots.toUint64(), _maxMintingFeeBIPS.toUint64(), _executor);
    }

    /**
     * Return the collateral reservation fee amount that has to be passed to the reserveCollateral method.
     * NOTE: the *exact* amount of the collateral fee must be paid. Even if the amount paid in `reserveCollateral` is
     * more than required, the transaction will revert. This is intentional to protect the minter from accidentally
     * overpaying, but may cause unexpected reverts if the FTSO prices get published between calls to
     * `collateralReservationFee` and `reserveCollateral`.
     * @param _lots the number of lots for which to reserve collateral
     * @return _reservationFeeNATWei the amount of reservation fee in NAT wei
     */
    function collateralReservationFee(
        uint256 _lots
    )
        external view override
        returns (uint256 _reservationFeeNATWei)
    {
        return CollateralReservations.calculateReservationFee(_lots.toUint64());
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
        Payment.Proof calldata _payment,
        uint256 _collateralReservationId
    )
        external override
        nonReentrant
    {
        Minting.executeMinting(_payment, _collateralReservationId.toUint64());
    }

    /**
     * When the time for minter to pay underlying amount is over (i.e. the last underlying block has passed),
     * the agent can declare payment default. Then the agent collects collateral reservation fee
     * (it goes directly to the vault), and the reserved collateral is unlocked.
     * NOTE: may only be called by the owner of the agent vault in the collateral reservation request.
     * @param _proof proof that the minter didn't pay with correct payment reference on the underlying chain
     * @param _collateralReservationId id of a collateral reservation created by the minter
     */
    function mintingPaymentDefault(
        ReferencedPaymentNonexistence.Proof calldata _proof,
        uint256 _collateralReservationId
    )
        external override
    {
        CollateralReservations.mintingPaymentDefault(_proof, _collateralReservationId.toUint64());
    }

    /**
     * If collateral reservation request exists for more than 24 hours, payment or non-payment proof are no longer
     * available. In this case agent can call this method, which burns reserved collateral at market price
     * and releases the remaining collateral (CRF is also burned).
     * NOTE: may only be called by the owner of the agent vault in the collateral reservation request.
     * NOTE: the agent (management address) receives the vault collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral
     *      amount multiplied by `vaultCollateralBuyForFlareFactorBIPS`.
     * @param _proof proof that the attestation query window can not not contain
     *      the payment/non-payment proof anymore
     * @param _collateralReservationId collateral reservation id
     */
    function unstickMinting(
        ConfirmedBlockHeightExists.Proof calldata _proof,
        uint256 _collateralReservationId
    )
        external payable override
        nonReentrant
    {
        CollateralReservations.unstickMinting(_proof, _collateralReservationId.toUint64());
    }

    /**
     * Agent can mint against himself. In that case, this is a one-step process, skipping collateral reservation
     * and no collateral reservation fee payment.
     * Moreover, the agent doesn't have to be on the publicly available agents list to self-mint.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the caller must be a whitelisted agent.
     * @param _payment proof of the underlying payment; must contain payment reference of the form
     *      `0x4642505266410012000...0<agent_vault_address>`
     * @param _agentVault agent vault address
     * @param _lots number of lots to mint
     */
    function selfMint(
        Payment.Proof calldata _payment,
        address _agentVault,
        uint256 _lots
    )
        external override
        onlyAttached
        nonReentrant
    {
        Minting.selfMint(_payment, _agentVault, _lots.toUint64());
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Redemption

    /**
     * Redeem (up to) `_lots` lots of f-assets. The corresponding amount of the f-assets belonging
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
     * @param _redeemerUnderlyingAddressString the address to which the agent must transfer underlying amount
     * @return _redeemedAmountUBA the actual redeemed amount; may be less then requested if there are not enough
     *      redemption tickets available or the maximum redemption ticket limit is reached
     */
    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString
    )
        external override
        onlyWhitelistedSender
        returns (uint256 _redeemedAmountUBA)
    {
        return RedemptionRequests.redeem(msg.sender, _lots.toUint64(), _redeemerUnderlyingAddressString);
    }

    /**
     * After paying to the redeemer, the agent must call this method to unlock the collateral
     * and to make sure that the redeemer cannot demand payment in collateral on timeout.
     * The same method must be called for any payment status (SUCCESS, FAILED, BLOCKED).
     * In case of FAILED, it just releases agent's underlying funds and the redeemer gets paid in collateral
     * after calling redemptionPaymentDefault.
     * In case of SUCCESS or BLOCKED, remaining underlying funds and collateral are released to the agent.
     * If the agent doesn't confirm payment in enough time (several hours, setting confirmationByOthersAfterSeconds),
     * anybody can do it and get rewarded from agent's vault.
     * NOTE: may only be called by the owner of the agent vault in the redemption request
     *   except if enough time has passed without confirmation - then it can be called by anybody
     * @param _payment proof of the underlying payment (must contain exact `value - fee` amount and correct
     *      payment reference)
     * @param _redemptionRequestId id of an existing redemption request
     */
    function confirmRedemptionPayment(
        Payment.Proof calldata _payment,
        uint256 _redemptionRequestId
    )
        external override
    {
        RedemptionConfirmations.confirmRedemptionPayment(_payment, _redemptionRequestId.toUint64());
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
        ReferencedPaymentNonexistence.Proof calldata _proof,
        uint256 _redemptionRequestId
    )
        external override
    {
        RedemptionFailures.redemptionPaymentDefault(_proof, _redemptionRequestId.toUint64());
    }

    /**
     * If the agent hasn't performed the payment, the agent can close the redemption request to free underlying funds.
     * It can be done immediately after the redeemer or agent calls redemptionPaymentDefault,
     * or this method can trigger the default payment without proof, but only after enough time has passed so that
     * attestation proof of non-payment is not available any more.
     * NOTE: may only be called by the owner of the agent vault in the redemption request.
     * @param _proof proof that the attestation query window can not not contain
     *      the payment/non-payment proof anymore
     * @param _redemptionRequestId id of an existing, but already defaulted, redemption request
     */
    function finishRedemptionWithoutPayment(
        ConfirmedBlockHeightExists.Proof calldata _proof,
        uint256 _redemptionRequestId
    )
        external override
    {
        RedemptionFailures.finishRedemptionWithoutPayment(_proof, _redemptionRequestId.toUint64());
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
     * @return _closedAmountUBA the actual self-closed amount, may be less then requested if there are not enough
     *      redemption tickets available or the maximum redemption ticket limit is reached
     */
    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    )
        external override
        returns (uint256 _closedAmountUBA)
    {
        // in SelfClose.selfClose we check that only agent can do this
        return RedemptionRequests.selfClose(_agentVault, _amountUBA);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying withdrawal announcements

    /**
     * Announce withdrawal of underlying currency.
     * In the event UnderlyingWithdrawalAnnounced the agent receives payment reference, which must be
     * added to the payment, otherwise it can be challenged as illegal.
     * Until the announced withdrawal is performed and confirmed or cancelled, no other withdrawal can be announced.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function announceUnderlyingWithdrawal(
        address _agentVault
    )
        external override
    {
        UnderlyingWithdrawalAnnouncements.announceUnderlyingWithdrawal(_agentVault);
    }

    /**
     * Agent must provide confirmation of performed underlying withdrawal, which updates free balance with used gas
     * and releases announcement so that a new one can be made.
     * If the agent doesn't call this method, anyone can call it after a time (confirmationByOthersAfterSeconds).
     * NOTE: may only be called by the owner of the agent vault
     *   except if enough time has passed without confirmation - then it can be called by anybody.
     * @param _payment proof of the underlying payment
     * @param _agentVault agent vault address
     */
    function confirmUnderlyingWithdrawal(
        Payment.Proof calldata _payment,
        address _agentVault
    )
        external override
    {
        UnderlyingWithdrawalAnnouncements.confirmUnderlyingWithdrawal(_payment, _agentVault);
    }

    /**
     * Cancel ongoing withdrawal of underlying currency.
     * Needed in order to reset announcement timestamp, so that others cannot front-run agent at
     * confirmUnderlyingWithdrawal call. This could happen if withdrawal would be performed more
     * than confirmationByOthersAfterSeconds seconds after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function cancelUnderlyingWithdrawal(
        address _agentVault
    )
        external override
    {
        UnderlyingWithdrawalAnnouncements.cancelUnderlyingWithdrawal(_agentVault);
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
        Payment.Proof calldata _payment,
        address _agentVault
    )
        external override
    {
        UnderlyingBalance.confirmTopupPayment(_payment, _agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Illegal payment and wrong payment report challenges

    /**
     * Called with a proof of payment made from agent's underlying address, for which
     * no valid payment reference exists (valid payment references are from redemption and
     * underlying withdrawal announcement calls).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _transaction proof of a transaction from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    )
        external override
        onlyWhitelistedSender
    {
        Challenges.illegalPaymentChallenge(_transaction, _agentVault);
    }

    /**
     * Called with proofs of two payments made from agent's underlying address
     * with the same payment reference (each payment reference is valid for only one payment).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payment1 proof of first payment from the agent's underlying address
     * @param _payment2 proof of second payment from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    )
        external override
        onlyWhitelistedSender
    {
        Challenges.doublePaymentChallenge(_payment1, _payment2, _agentVault);
    }

    /**
     * Called with proofs of several (otherwise legal) payments, which together make agent's
     * underlying free balance negative (i.e. the underlying address balance is less than
     * the total amount of backed f-assets).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payments proofs of several distinct payments from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    )
        external override
        onlyWhitelistedSender
    {
        Challenges.paymentsMakeFreeBalanceNegative(_payments, _agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Liquidation

    /**
     * Checks that the agent's collateral is too low and if true, starts agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @return _liquidationStatus 0=no liquidation, 1=CCB, 2=liquidation
     * @return _liquidationStartAt if the status is LIQUIDATION, the timestamp when liquidation started;
     *  if the status is CCB, the timestamp when liquidation will start; otherwise 0
     */
    function startLiquidation(
        address _agentVault
    )
        external override
        onlyWhitelistedSender
        returns (uint8 _liquidationStatus, uint256 _liquidationStartAt)
    {
        (Agent.LiquidationPhase phase, uint256 startTs) = Liquidation.startLiquidation(_agentVault);
        _liquidationStatus = uint8(phase);
        _liquidationStartAt = startTs;
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
     * @return _liquidatedAmountUBA liquidated amount of f-asset
     * @return _amountPaidVault amount paid to liquidator (in agent's vault collateral)
     * @return _amountPaidPool amount paid to liquidator (in NAT from pool)
     */
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        external override
        onlyWhitelistedSender
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidVault, uint256 _amountPaidPool)
    {
        (_liquidatedAmountUBA, _amountPaidVault, _amountPaidPool) =
            Liquidation.liquidate(_agentVault, _amountUBA);
    }

    /**
     * When agent's collateral reaches safe level during liquidation, the liquidation
     * process can be stopped by calling this method.
     * Full liquidation (i.e. the liquidation triggered by illegal underlying payment)
     * cannot be stopped.
     * NOTE: anybody can call.
     * @param _agentVault agent vault address
     */
    function endLiquidation(
        address _agentVault
    )
        external override
    {
        Liquidation.endLiquidation(_agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Upgrade (second phase)

    /**
     * When asset manager is paused, no new minting can be made.
     * All other operations continue normally.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function pause()
        external override
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        if (state.pausedAt == 0) {
            state.pausedAt = block.timestamp.toUint64();
        }
    }

    /**
     * If f-asset was not terminated yet, minting can continue.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function unpause()
        external override
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(!terminated(), "f-asset terminated");
        state.pausedAt = 0;
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
        external override
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.pausedAt != 0 && block.timestamp > state.pausedAt + MINIMUM_PAUSE_BEFORE_STOP,
            "asset manager not paused enough");
        Globals.getFAsset().terminate();
    }

    /**
     * When f-asset is terminated, agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when AssetManager is already paused
     * at least for a month and most f-assets are already burned and the only ones remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the agent (management address) receives the vault collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral
     *      amount multiplied by `vaultCollateralBuyForFlareFactorBIPS`.
     */
    function buybackAgentCollateral(
        address _agentVault
    )
        external payable override
        nonReentrant
    {
        require(terminated(), "f-asset not terminated");
        AgentsCreateDestroy.buybackAgentCollateral(_agentVault);
    }

    /**
     * True if asset manager is paused.
     */
    function paused()
        external view override
        returns (bool)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.pausedAt != 0;
    }

    /**
     * True if asset manager is terminated.
     */
    function terminated()
        public view override
        returns (bool)
    {
        return Globals.getFAsset().terminated();
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral type management

    function addCollateralType(
        CollateralType.Data calldata _data
    )
        external override
        onlyAssetManagerController
    {
        CollateralTypes.add(_data);
    }

    function setCollateralRatiosForToken(
        CollateralType.Class _collateralClass,
        IERC20 _token,
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external override
        onlyAssetManagerController
    {
        CollateralTypes.setCollateralRatios(_collateralClass, _token,
            _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
    }

    function deprecateCollateralType(
        CollateralType.Class _collateralClass,
        IERC20 _token,
        uint256 _invalidationTimeSec
    )
        external override
        onlyAssetManagerController
    {
        CollateralTypes.deprecate(_collateralClass, _token, _invalidationTimeSec);
    }

    /**
     * When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType,
     * pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for
     * new ones and sets it for use by the pool.
     */
    function upgradeWNatContract(
        address _agentVault
    )
        external override
    {
        // AgentsExternal.upgradeWNat checks that only agent owner can call
        AgentsExternal.upgradeWNatContract(_agentVault);
    }

    /**
     * Get collateral  information about a token.
     */
    function getCollateralType(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        external view override
        returns (CollateralType.Data memory)
    {
        return CollateralTypes.getInfo(_collateralClass, _token);
    }

    /**
     * Get the list of all available and deprecated tokens used for collateral.
     */
    function getCollateralTypes()
        external view override
        returns (CollateralType.Data[] memory)
    {
        return CollateralTypes.getAllInfos();
    }

    /**
     * Check if `_token` is either vault collateral token for `_agentVault` or the pool token.
     * These types of tokens cannot be simply transfered from the agent vault, but can only be
     * withdrawn after announcement if they are not backing any f-assets.
     */
    function isLockedVaultToken(address _agentVault, IERC20 _token)
        external view override
        returns (bool)
    {
        return AgentsExternal.isLockedVaultToken(_agentVault, _token);
    }

    function getCollateralPool(address _agentVault)
        external view override
        returns (address)
    {
        return address(Agent.get(_agentVault).collateralPool);
    }

    function getFAssetsBackedByPool(address _agentVault)
        external view override
        returns (uint256)
    {
        return AgentsExternal.getFAssetsBackedByPool(_agentVault);
    }

    function isAgentVaultOwner(address _agentVault, address _address)
        external view override
        returns (bool)
    {
        return Agents.isOwner(Agent.get(_agentVault), _address);
    }

    function getAgentVaultOwner(address _agentVault)
        external view override
        returns (address _ownerManagementAddress, address _ownerWorkAddress)
    {
        return AgentsExternal.getAgentVaultOwner(_agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral pool redemptions

    /**
     * Create a redemption from a single agent. Used in self-close exit from the collateral pool.
     * Note: only collateral pool can call this method.
     */
    function redeemFromAgent(
        address _agentVault,
        address _receiver,
        uint256 _amountUBA,
        string memory _receiverUnderlyingAddress
    )
        external override
    {
        RedemptionRequests.redeemFromAgent(_agentVault, _receiver, _amountUBA, _receiverUnderlyingAddress);
    }

    /**
     * Burn fassets from  a single agent and get paid in vault collateral by the agent.
     * Price is FTSO price, multiplied by factor buyFAssetByAgentFactorBIPS (set by agent).
     * Used in self-close exit from the collateral pool when requested or when self-close amount is less than 1 lot.
     * Note: only collateral pool can call this method.
     */
    function redeemFromAgentInCollateral(
        address _agentVault,
        address _receiver,
        uint256 _amountUBA
    )
        external override
    {
        RedemptionRequests.redeemFromAgentInCollateral(_agentVault, _receiver, _amountUBA);
    }

    /**
     * To avoid unlimited work, the maximum number of redemption tickets closed in redemption, self close
     * or liquidation is limited. This means that a single redemption/self close/liquidation is limited.
     * This function calculates the maximum single rededemption amount.
     */
    function maxRedemptionFromAgent(
        address _agentVault
    )
        external view
        returns (uint256)
    {
        return RedemptionRequests.maxRedemptionFromAgent(_agentVault);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Other

    /**
     * Get the f-asset contract managed by this asset manager instance.
     */
    function fAsset()
        external view override
        returns (IERC20)
    {
        return IERC20(address(Globals.getFAsset()));
    }

    /**
     * Get WNat contract. Used by AgentVault.
     * @return WNat contract
     */
    function getWNat()
        external view override
        returns (IWNat)
    {
        return Globals.getWNat();
    }

    /**
     * return lot size in UBA.
     */
    function lotSize()
        external view override
        returns (uint256 _lotSizeUBA)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return settings.lotSizeAMG * settings.assetMintingGranularityUBA;
    }

    /**
     * Returns price of asset (UBA) in NAT Wei as a fraction.
     */
    function assetPriceNatWei()
        external view override
        returns (uint256 _multiplier, uint256 _divisor)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        _multiplier = Conversion.currentAmgPriceInTokenWei(Globals.getPoolCollateral());
        _divisor = Conversion.AMG_TOKEN_WEI_PRICE_SCALE * settings.assetMintingGranularityUBA;
    }

    /**
     * Returns timelock duration during for which collateral pool tokens are locked after minting.
     */
    function getCollateralPoolTokenTimelockSeconds()
        external view override
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return settings.collateralPoolTokenTimelockSeconds;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // ERC 165

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IAssetManager).interfaceId
            || _interfaceId == type(IIAssetManager).interfaceId;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Condition checks

    function _checkOnlyAssetManagerController() private view {
        require(msg.sender == AssetManagerState.getSettings().assetManagerController,
            "only asset manager controller");
    }

    function _checkOnlyAttached() private view {
        require(AssetManagerState.get().attached, "not attached");
    }

    function _checkOnlyWhitelistedSender() private view {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        if (settings.whitelist != address(0)) {
            require(IWhitelist(settings.whitelist).isWhitelisted(msg.sender), "not whitelisted");
        }
    }
}
