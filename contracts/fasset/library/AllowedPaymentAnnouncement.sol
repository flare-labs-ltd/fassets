// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/lib/SafeMath64.sol";


library AllowedPaymentAnnouncement {
    struct Announcement {
        bytes32 underlyingAddress;
        uint256 valueUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 createdAtBlock;
    }
    
    struct State {
        // mapping (agentVault, announcementId) => Announcement
        mapping(bytes32 => Announcement) announcements;
        // new id
        uint64 newAnnouncementId;
    }

    function createAnnouncement(
        State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock,
        uint64 _lastUnderlyingBlock
    )
        internal
        returns (uint64 _announcementId)
    {
        _announcementId = ++_state.newAnnouncementId;
        _state.announcements[_announcementKey(_agentVault, _announcementId)] = Announcement({
            underlyingAddress: _underlyingAddress,
            valueUBA: _valueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: _lastUnderlyingBlock,
            createdAtBlock: SafeMath64.toUint64(block.number)
        });
    }
    
    function deleteAnnouncement(
        State storage _state,
        address _agentVault,
        uint64 _announcementId
    )
        internal
    {
        delete _state.announcements[_announcementKey(_agentVault, _announcementId)];
    }
    
    function getAnnouncement(
        State storage _state,
        address _agentVault,
        uint64 _announcementId
    )
        internal view
        returns (Announcement storage _announcement)
    {
        _announcement = _state.announcements[_announcementKey(_agentVault, _announcementId)];
        require(_announcement.underlyingAddress != 0, "invalid announcement id");
    }
    
    function _announcementKey(address _agentVault, uint64 _id) private pure returns (bytes32) {
        return bytes32(uint256(_agentVault) | (uint256(_id) << 160));
    }
}
