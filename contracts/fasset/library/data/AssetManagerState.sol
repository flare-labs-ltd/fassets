// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./AssetManagerSettings.sol";
import "./Agent.sol";
import "./RedemptionQueue.sol";
import "./PaymentConfirmations.sol";
import "./UnderlyingAddressOwnership.sol";
import "./CollateralReservation.sol";
import "./Redemption.sol";
import "./CollateralToken.sol";


library AssetManagerState {
    struct State {
        AssetManagerSettings.Data settings;
        
        // All collateral types, used for class 1 or pool.
        // Pool collateral (always WNat) has index 0.
        CollateralToken.Data[] collateralTokens;
        
        // A list of all agents that are available for minting.
        // Type: array of agent vault addresses; when one is deleted, its position is filled with last
        address[] availableAgents;
        
        // Ownership of underlying source addresses is needed to prevent someone
        // overtaking the payer and presenting an underlying payment as his own.
        UnderlyingAddressOwnership.State underlyingAddressOwnership;
        
        // Type: mapping collateralReservationId => collateralReservation
        mapping(uint64 => CollateralReservation.Data) crts;
        
        // redemption queue
        RedemptionQueue.State redemptionQueue;
        
        // mapping redemptionRequest_id => request
        mapping(uint256 => Redemption.Request) redemptionRequests;
        
        // verified payment hashes; expire in 5 days
        PaymentConfirmations.State paymentConfirmations;
        
        // New ids (listed together to save storage); all must be incremented before assigning, so 0 means empty
        uint64 newCrtId;
        uint64 newRedemptionRequestId;
        uint64 newPaymentAnnouncementId;
        
        // Total collateral reservations (in underlying AMG units). Used by minting cap.
        uint64 totalReservedCollateralAMG;
        
        // Current block number and timestamp on the underlying chain
        uint64 currentUnderlyingBlock;
        uint64 currentUnderlyingBlockTimestamp;
        
        // The timestamp (on this network) when the underlying block was last updated
        uint64 currentUnderlyingBlockUpdatedAt;

        // If non-zero, asset manager is paused and has been paused at the time indicated by timestamp pausedAt.
        // When asset manager is paused, no new mintings can be done.
        // It is an extreme measure, which can be used in case there is a dangerous hole in the system.
        uint64 pausedAt;
        
        // When true, asset manager has been added to the asset manager controller.
        // Even though the asset manager controller address is set at the construction time, the manager may not
        // be able to be added to the controller immediatelly because the method addAssetMaanager must be called
        // by the governance multisig (with timelock).
        // During this time it is impossible to verify through the controller that the asset manager is legit.
        // Therefore creating agents and minting is disabled until the asset manager controller notifies 
        // the asset manager that it has been added.
        bool attached;
    }

    // diamond state access to state and settings
    
    bytes32 internal constant STATE_POSITION = keccak256("fasset.AssetManager.State");
    
    function get() internal pure returns (AssetManagerState.State storage _state) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = STATE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }

    function getSettings() internal view returns (AssetManagerSettings.Data storage) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = STATE_POSITION;
        AssetManagerState.State storage state;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            state.slot := position
        }
        return state.settings;
    }
}
