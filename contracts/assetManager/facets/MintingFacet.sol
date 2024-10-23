// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/Minting.sol";
import "./AssetManagerBase.sol";


contract MintingFacet is AssetManagerBase, ReentrancyGuard {
    using SafeCast for uint256;

    /**
     * After obtaining proof of underlying payment, the minter calls this method to finish the minting
     * and collect the minted f-assets.
     * NOTE: In case hand-shake was required, the payment must be done using only all provided addresses,
     * so `sourceAddressesRoot` matches the calculated Merkle root, otherwise the proof will be rejected.
     * NOTE: may only be called by the minter (= creator of CR, the collateral reservation request),
     *   the executor appointed by the minter, or the agent owner (= owner of the agent vault in CR).
     * @param _payment proof of the underlying payment (must contain exact `value + fee` amount and correct
     *      payment reference)
     * @param _collateralReservationId collateral reservation id
     */
    function executeMinting(
        IPayment.Proof calldata _payment,
        uint256 _collateralReservationId
    )
        external
        nonReentrant
    {
        Minting.executeMinting(_payment, _collateralReservationId.toUint64());
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
        IPayment.Proof calldata _payment,
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
