// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../interfaces/IICollateralPool.sol";


library Agent {
    enum Status {
        EMPTY,              // agent does not exist
        NORMAL,
        LIQUIDATION,        // CCB or liquidation due to CR - ends when agent is healthy
        FULL_LIQUIDATION,   // illegal payment liquidation - must liquidate all and close vault
        DESTROYING          // agent announced destroy, cannot mint again
    }

    enum LiquidationPhase {
        NONE,
        CCB,
        LIQUIDATION
    }

    // For agents to withdraw NAT collateral, they must first announce it and then wait
    // withdrawalAnnouncementSeconds.
    // The announced amount cannot be used as collateral for minting during that time.
    // This makes sure that agents cannot just remove all collateral if they are challenged.
    struct WithdrawalAnnouncement {
        // Announce amount in collateral token's minimum unit (wei).
        uint128 amountWei;

        // The timestamp when withdrawal can be executed.
        uint64 allowedAt;
    }

    // Struct to store agent's pending setting updates.
    struct SettingUpdate {
        uint128 value;
        uint64 validAt;
    }

    struct State {
        IICollateralPool collateralPool;

        // Address of the agent owner. This is the management address, which is immutable.
        // The work address can be retrieved from the global state mapping between
        // management and work addresses.
        address ownerManagementAddress;

        // Current address for underlying agent's collateral.
        // Agent can change this address anytime and it affects future mintings.
        string underlyingAddressString;

        // `underlyingAddressString` is only used for sending the minter a correct payment address;
        // for matching payment addresses we always use `underlyingAddressHash = keccak256(underlyingAddressString)`
        bytes32 underlyingAddressHash;

        // Current status of the agent (changes for liquidation).
        Agent.Status status;

        // Index of collateral vault token.
        // The data is obtained as state.collateralTokens[vaultCollateralIndex].
        uint16 vaultCollateralIndex;

        // Index of token in collateral pool. This is always wrapped FLR/SGB, however the wrapping
        // contract (WNat) may change. In such case we add new collateral token with class POOL but the
        // agent must call a method to upgrade to new contract, se we must track the actual token used.
        uint16 poolCollateralIndex;

        // Position of this agent in the list of agents available for minting.
        // Value is actually `list index + 1`, so that 0 means 'not in the list'.
        uint32 availableAgentsPos;

        // Minting fee in BIPS (collected in underlying currency).
        uint16 feeBIPS;

        // Share of the minting fee that goes to the pool as percentage of the minting fee.
        uint16 poolFeeShareBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 mintingVaultCollateralRatioBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 mintingPoolCollateralRatioBIPS;

        // Timestamp of the startLiquidation call.
        // If the agent's CR is above ccbCR, agent is put into CCB state for a while.
        // However, if the agent's CR falls below ccbCR before ccb time expires, anyone can call startLiquidation
        // again to put agent in liquidation immediately (in this case, liquidationStartedAt and
        // initialLiquidationPhase are reset to new values).
        uint64 liquidationStartedAt;

        // Liquidation phase at the time when liquidation started.
        LiquidationPhase initialLiquidationPhase;

        // Bitmap signifying which collateral type(s) triggered liquidation (LF_VAULT | LF_POOL).
        uint8 collateralsUnderwater;

        // Amount of collateral locked by collateral reservation.
        uint64 reservedAMG;

        // Amount of collateral backing minted fassets.
        uint64 mintedAMG;

        // The amount of fassets being redeemed. In this case, the fassets were already burned,
        // but the collateral must still be locked to allow payment in case of redemption failure.
        // The distinction between 'minted' and 'redeemed' assets is important in case of challenge.
        uint64 redeemingAMG;

        // The amount of fassets being redeemed EXCEPT those from pool self-close exits.
        // Unlike normal redemption, pool collateral was already withdrawn, so the redeeming collateral
        // must only be accounte for / locked for vault collateral.
        // On redemption payment failure, redeemer will be paid only in vault collateral in this case
        // (and will be paid less if there isn't enough - small extra risk for pool token holders).
        // There will always be `poolRedeemingAMG <= redeemingAMG`.
        uint64 poolRedeemingAMG;

        // When lot size changes, there may be some leftover after redemption that doesn't fit
        // a whole lot size. It is added to dustAMG and can be recovered via self-close.
        // Unlike redeemingAMG, dustAMG is still counted in the mintedAMG.
        uint64 dustAMG;

        // The amount of funds that on the agent's underlying address.
        // If it is higher than the amount neded to back mintings, it can be withdrawn after announcement.
        // It is signed int, because unreported deposits combined with other operations can in principle
        // make it negative. We could truncate it at 0, but if deposit report comes later, this would make
        // the value wrong.
        int128 underlyingBalanceUBA;

        // There can be only one announced underlying withdrawal per agent active at any time.
        // This variable holds the id, or 0 if there is no announced underlying withdrawal going on.
        uint64 announcedUnderlyingWithdrawalId;

        // The time when ongoing underlying withdrawal was announced.
        uint64 underlyingWithdrawalAnnouncedAt;

        // Announcement for vault collateral withdrawal.
        WithdrawalAnnouncement vaultCollateralWithdrawalAnnouncement;

        // Announcement for pool token withdrawal (which also means pool collateral withdrawal).
        WithdrawalAnnouncement poolTokenWithdrawalAnnouncement;

        // Underlying block when the agent was created.
        // Challenger's should track underlying address activity since this block
        // and topups are only valid after this block (both inclusive).
        uint64 underlyingBlockAtCreation;

        // The time when ongoing agent vault destroy was announced.
        uint64 destroyAllowedAt;

        // The factor set by the agent to multiply the price at which agent buys f-assets from pool
        // token holders on self-close exit (when requested or the redeemed amount is less than 1 lot).
        uint16 buyFAssetByAgentFactorBIPS;

        // The announced time when the agent is exiting available agents list.
        uint64 exitAvailableAfterTs;

        // The position of the agent in the list of all agents.
        uint32 allAgentsPos;

        // Agent's pending setting updates.
        mapping(bytes32 => SettingUpdate) settingUpdates;

        // Agent's hand-shake type - minting or redeeming can be rejected.
        // 0 - no verification, 1 - manual verification, ...
        uint32 handShakeType;

        // Only used for calculating Agent.State size. See deleteStorage() below.
        uint256[1] _endMarker;
    }

    // underwater collateral classes
    uint8 internal constant LF_VAULT = 1 << 0;
    uint8 internal constant LF_POOL = 1 << 1;

    // diamond state accessors

    bytes32 internal constant AGENTS_POSITION = keccak256("fasset.AssetManager.Agent");

    function get(address _address)
        internal view
        returns (Agent.State storage _agent)
    {
        bytes32 position = bytes32(uint256(AGENTS_POSITION) ^ (uint256(uint160(_address)) << 64));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _agent.slot := position
        }
        require(_agent.status != Agent.Status.EMPTY, "invalid agent vault address");
    }

    function getWithoutCheck(address _address) internal pure returns (Agent.State storage _agent) {
        bytes32 position = bytes32(uint256(AGENTS_POSITION) ^ (uint256(uint160(_address)) << 64));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _agent.slot := position
        }
    }

    function vaultAddress(Agent.State storage _agent) internal pure returns (address) {
        bytes32 position;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            position := _agent.slot
        }
        return address(uint160((uint256(position) ^ uint256(AGENTS_POSITION)) >> 64));
    }

    // Using `delete` doesn't work for storage pointers, so this is a workaround for
    // clearing agent storage at calculated location. The last member of the agent struct
    // must always be empty `_endMarker` for calculating the size to delete.
    function deleteStorage(Agent.State storage _agent) internal {
        uint256[1] storage endMarker = _agent._endMarker;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let pos := _agent.slot
            let end := endMarker.slot
            for { } lt(pos, end) { pos := add(pos, 1) } {
                sstore(pos, 0)
            }
        }
    }
}
