// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/CollateralReservations.sol";
import "../library/Minting.sol";
import "./AssetManagerBase.sol";


contract MintingFacet is AssetManagerBase, ReentrancyGuard {
    using SafeCast for uint256;

    /**
     * Before paying underlying assets for minting, minter has to reserve collateral and
     * pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio
     * to requested lots NAT market price.
     * If the agent requires hand-shake, then HandShakeRequired event is emitted and
     * the minter has to wait for the agent to approve or reject the reservation. If there is no response within
     * the `cancelCollateralReservationAfterSeconds`, the minter can cancel the reservation and get the fee back.
     * If hand-shake is not required, the minter receives instructions for underlying payment
     * (value, fee and payment reference) in event CollateralReserved.
     * Then the minter has to pay `value + fee` on the underlying chain.
     * If the minter pays the underlying amount, the collateral reservation fee is burned and minter obtains
     * f-assets. Otherwise the agent collects the collateral reservation fee.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * NOTE: the owner of the agent vault must be in the AgentOwnerRegistry.
     * @param _agentVault agent vault address
     * @param _lots the number of lots for which to reserve collateral
     * @param _maxMintingFeeBIPS maximum minting fee (BIPS) that can be charged by the agent - best is just to
     *      copy current agent's published fee; used to prevent agent from front-running reservation request
     *      and increasing fee (that would mean that the minter would have to pay raised fee or forfeit
     *      collateral reservation fee)
     * @param _executor the account that is allowed to execute minting (besides minter and agent)
     */
    function reserveCollateral(
        address _agentVault,
        uint256 _lots,
        uint256 _maxMintingFeeBIPS,
        address payable _executor
    )
        external payable
        onlyAttached
        onlyWhitelistedSender
        notEmergencyPaused
    {
        CollateralReservations.reserveCollateral(msg.sender, _agentVault,
            _lots.toUint64(), _maxMintingFeeBIPS.toUint64(), _executor);
    }

    /**
     * Agent approves the collateral reservation request after checking the minter's identity.
     * NOTE: may only be called by the agent vault owner.
     * @param _collateralReservationId collateral reservation id
     */
    function approveCollateralReservation(
        uint256 _collateralReservationId
    )
        external
        notEmergencyPaused
    {
        CollateralReservations.approveCollateralReservation(_collateralReservationId.toUint64());
    }

    /**
     * Agent rejects the collateral reservation request after checking the minter's identity.
     * The collateral reservation fee is returned to the minter.
     * NOTE: may only be called by the agent vault owner.
     * @param _collateralReservationId collateral reservation id
     */
    function rejectCollateralReservation(
        uint256 _collateralReservationId
    )
        external
        nonReentrant
    {
        CollateralReservations.rejectCollateralReservation(_collateralReservationId.toUint64());
    }

    /**
     * Minter cancels the collateral reservation request if the agent didn't respond in time.
     * The collateral reservation fee is returned to the minter.
     * It can only be called after `cancelCollateralReservationAfterSeconds` from the collateral reservation request.
     * NOTE: may only be called by the minter.
     * @param _collateralReservationId collateral reservation id
     */
    function cancelCollateralReservation(
        uint256 _collateralReservationId
    )
        external
        nonReentrant
    {
        CollateralReservations.cancelCollateralReservation(_collateralReservationId.toUint64());
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
        external view
        returns (uint256 _reservationFeeNATWei)
    {
        return CollateralReservations.calculateReservationFee(_lots.toUint64());
    }

    /**
     * After obtaining proof of underlying payment, the minter calls this method to finish the minting
     * and collect the minted f-assets.
     * NOTE: may only be called by the minter (= creator of CR, the collateral reservation request),
     *   the executor appointed by the minter, or the agent owner (= owner of the agent vault in CR).
     * @param _payment proof of the underlying payment (must contain exact `value + fee` amount and correct
     *      payment reference)
     * @param _collateralReservationId collateral reservation id
     */
    function executeMinting(
        Payment.Proof calldata _payment,
        uint256 _collateralReservationId
    )
        external
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
        external
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
        external payable
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
        external
        onlyAttached
        notEmergencyPaused
        nonReentrant
    {
        Minting.selfMint(_payment, _agentVault, _lots.toUint64());
    }
}
