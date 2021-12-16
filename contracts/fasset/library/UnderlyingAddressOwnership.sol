// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


library UnderlyingAddressOwnership {
    struct Ownership {
        address owner;
    }
    
    struct State {
        // reservation has to be made at least one block before to prevent frontrunning
        // mapping hash(owner, underlyingAddress) => block_number
        mapping (bytes32 => uint256) reservations;
        
        // mapping underlyingAddress => Ownership
        mapping (bytes32 => Ownership) ownership;
    }

    // reservation is required before claim to prevent frontrunning    
    function reserve(
        State storage _state, 
        bytes32 _hash
    ) 
        internal
    {
        _state.reservations[_hash] = block.number;
    }
    
    //
    function claim(
        State storage _state, 
        address _owner, 
        bytes32 _underlyingAddress
    ) 
        internal 
    {
        Ownership storage ownership = _state.ownership[_underlyingAddress];
        if (ownership.owner == address(0)) {
            _checkReservation(_state, _owner, _underlyingAddress);
            ownership.owner = _owner;
        } else {
            require(ownership.owner == _owner, "address already claimed");
        }
    }
    
    function check(
        State storage _state, 
        address _owner, 
        bytes32 _underlyingAddress
    )
        internal view
        returns (bool)
    {
        Ownership storage ownership = _state.ownership[_underlyingAddress];
        return ownership.owner == _owner;
    }
    
    function _checkReservation(State storage _state, address _owner, bytes32 _underlyingAddress) private {
        bytes32 key = _ownerAddressHash(_owner, _underlyingAddress);
        uint256 reservationBlock = _state.reservations[key];
        require(reservationBlock != 0 && reservationBlock < block.number, "source address not reserved");
        delete _state.reservations[key];
    }
    
    function _ownerAddressHash(address _owner, bytes32 _underlyingAddress) private pure returns (bytes32) {
        return keccak256(abi.encode(_owner, _underlyingAddress));
    }
}
