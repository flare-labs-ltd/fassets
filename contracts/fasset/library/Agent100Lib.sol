// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMathX.sol";
import "../interface/IAgentVault.sol";


library Agent100Lib {
    using SafeMath for uint256;
    using SafePct for uint256;
    
    struct CollateralReservation {
        bytes32 agentUnderlyingAddress;
        bytes32 minterUnderlyingAddress;
        uint192 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint192 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 lots;
        address minter;
        uint8 availabilityEnterCountMod2;
    }
    
    struct RedemptionRequest {
        bytes32 agentUnderlyingAddress;
        bytes32 redeemerUnderlyingAddress;
        uint192 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint192 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 lots;
        address redeemer;
    }
    
    struct TopupRequirement {
        bytes32 underlyingAddress;
        uint256 valueUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
    }
    
    struct State {
        // default values
        uint16 initialMinCollateralRatioBIPS;
        uint16 liquidationMinCollateralRatioBIPS;
        uint64 minSecondsToExitAvailableForMint;
        uint64 underlyingBlocksForPayment;
        uint64 underlyingBlocksForAllowedPayment;
        uint64 underlyingBlocksForTopup;
        uint256 lotSizeUBA;                              // in underlying asset wei/satoshi
        uint256 redemptionFeeUBA;                        // in underlying asset wei/satoshi
        uint32 redemptionFailureFactorBIPS;              // e.g 1.2 (12000)
        //
        mapping(address => Agent) agents;                       // mapping agentVaultAddress=>agent
        mapping(uint64 => CollateralReservation) crts;          // mapping crt_id=>crt
        mapping(uint64 => RedemptionRequest) redemptionRequests;    // mapping request_id=>request
        mapping(bytes32 => address) underlyingAddressOwner;
        AvailableAgentForMint[] availableAgentsForMint;
        uint64 newCrtId;                    // increment before assigning to ticket (to avoid 0)
        uint64 newRedemptionRequestId;
    }
    
    struct CallContext {
        uint256 fullAgentCollateralWei;     // the total amount of native currency in the agent vault
        uint256 lotSizeWei;                 // current lot value in native currency WEI
    }
    
    event AgentFreeCollateralChanged(
        address vaultAddress, 
        uint256 freeCollateral);

    event CollateralReserved(
        address indexed minter,
        uint256 collateralReservationId,
        bytes32 underlyingAddress,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock);
        
    event MintingExecuted(
        address indexed vaultAddress,
        uint256 collateralReservationId,
        uint256 redemptionTicketId,
        bytes32 underlyingAddress,
        uint256 mintedLots,
        uint256 receivedFeeUBA);

    event AllowedPaymentAnnounced(
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 announcementId);
        
    event RedemptionRequested(
        address indexed vaultAddress,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);
        
    event TopupRequired(
        address indexed vaultAddress,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);

    function _initAgent(State storage _state, address _agentVault) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AgentStatus.EMPTY, "agent already exists");
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.initialMinCollateralRatioBIPS;
    }
    
    
    function _claimMinterUnderlyingAddress(State storage _state, address _minter, bytes32 _address) internal {
        if (_state.underlyingAddressOwner[_address] == address(0)) {
            _state.underlyingAddressOwner[_address] = _minter;
        } else if (_state.underlyingAddressOwner[_address] != _minter) {
            revert("address belongs to other minter");
        }
    }
    
    function _reserveCollateral(
        State storage _state, 
        CallContext memory _context,
        address _minter,
        bytes32 _minterUnderlyingAddress,
        address _agentVault, 
        uint64 _lots,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsForMintPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(_freeCollateralLots(agent, _context) >= _lots, "not enough free collateral");
        _claimMinterUnderlyingAddress(_state, _minter, _minterUnderlyingAddress);
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForPayment);
        agent.reservedLots = SafeMath64.add64(agent.reservedLots, _lots);
        uint256 underlyingValueUBA = _state.lotSizeUBA.mul(_lots);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulDiv(agent.feeBIPS, MAX_BIPS);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            agentUnderlyingAddress: agent.underlyingAddress,
            minterUnderlyingAddress: _minterUnderlyingAddress,
            underlyingValueUBA: SafeMathX.toUint192(underlyingValueUBA),
            underlyingFeeUBA: SafeMathX.toUint192(underlyingFeeUBA),
            agentVault: _agentVault,
            lots: SafeMath64.toUint64(_lots),
            minter: _minter,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            availabilityEnterCountMod2: agent.availabilityEnterCountMod2
        });
        emit CollateralReserved(_minter, crtId, 
            agent.underlyingAddress, underlyingValueUBA, underlyingFeeUBA, lastUnderlyingBlock);
        emit AgentFreeCollateralChanged(_agentVault, _freeCollateral(agent, _context));
    }
    
    function _mintingExecuted(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _crtId
    )
        internal
    {
        CollateralReservation storage crt = _getCollateralReservation(_state, _crtId);
        uint256 expectedPaymentUBA = uint256(crt.underlyingValueUBA).add(crt.underlyingFeeUBA);
        _verifyRequiredPayment(_state, _paymentInfo, 
            crt.minterUnderlyingAddress, crt.agentUnderlyingAddress, expectedPaymentUBA, 
            crt.firstUnderlyingBlock, crt.lastUnderlyingBlock);
        address agentVault = crt.agentVault;
        uint64 lots = crt.lots;
        uint64 redemptionTicketId = _createRedemptionTicket(_state, agentVault, lots, crt.agentUnderlyingAddress);
        Agent storage agent = _state.agents[agentVault];
        if (crt.availabilityEnterCountMod2 == agent.availabilityEnterCountMod2) {
            agent.reservedLots = SafeMath64.sub64(agent.reservedLots, lots, "invalid reserved lots");
        } else {
            agent.oldReservedLots = SafeMath64.sub64(agent.oldReservedLots, lots, "invalid reserved lots");
        }
        agent.mintedLots = SafeMath64.add64(agent.mintedLots, lots);
        agent.allowedUnderlyingPayments[crt.agentUnderlyingAddress] = 
            agent.allowedUnderlyingPayments[crt.agentUnderlyingAddress].add(crt.underlyingFeeUBA);
        delete _state.crts[_crtId];
        emit MintingExecuted(agentVault, _crtId, redemptionTicketId, 
            crt.agentUnderlyingAddress, lots, crt.underlyingFeeUBA);
    }
    
    function _announceAllowedPayment(
        State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(_valueUBA > 0, "invalid value");
        require(agent.allowedUnderlyingPayments[_underlyingAddress] >= _valueUBA,
            "payment larger than allowed");
        agent.allowedUnderlyingPayments[_underlyingAddress] -= _valueUBA;   // guarded by require
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, 
            _state.underlyingBlocksForAllowedPayment);
        uint64 announcementId = _state.allowedPaymentAnnouncements.createAnnouncement(
            _agentVault, _underlyingAddress, _valueUBA, _currentUnderlyingBlock, lastUnderlyingBlock);
        emit AllowedPaymentAnnounced(_underlyingAddress, _valueUBA, 
            _currentUnderlyingBlock, lastUnderlyingBlock, announcementId);
    }
    
    function _reportAllowedPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        internal
    {
        AllowedPaymentAnnouncement.Announcement storage announcement = 
            _state.allowedPaymentAnnouncements.getAnnouncement(_agentVault, _announcementId);
        verifyPayment(_state, _paymentInfo, 
            announcement.underlyingAddress, 0 /* target not needed for allowed payments */,
            announcement.valueUBA, announcement.firstUnderlyingBlock, announcement.lastUnderlyingBlock);
        // TODO: check and remove pending challenge
        // TODO: possible topup for gas
    }
    
    function _redeemAgainstTicket(
        State storage _state,
        uint64 _redemptionTicketId,
        address _redeemer,
        uint64 _lots,
        bytes32 _redeemerUnderlyingAddress,
        uint64 _currentUnderlyingBlock
    ) 
        internal 
        returns (uint64 _redeemedLots)
    {
        require(_lots != 0, "cannot redeem 0 lots");
        require(_redemptionTicketId != 0, "invalid redemption id");
        RedemptionTicket storage ticket = _state.redemptionQueue[_redemptionTicketId];
        require(ticket.lots != 0, "invalid redemption id");
        uint64 requestId = ++_state.newRedemptionRequestId;
        _redeemedLots = _lots <= ticket.lots ? _lots : ticket.lots;
        uint256 redeemedValueUBA = SafeMath.mul(_redeemedLots, _state.lotSizeUBA);
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForPayment);
        _state.redemptionRequests[requestId] = RedemptionRequest({
            agentUnderlyingAddress: ticket.underlyingAddress,
            redeemerUnderlyingAddress: _redeemerUnderlyingAddress,
            underlyingValueUBA: SafeMathX.toUint192(redeemedValueUBA),
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingFeeUBA: SafeMathX.toUint192(_state.redemptionFeeUBA),
            lastUnderlyingBlock: lastUnderlyingBlock,
            redeemer: _redeemer,
            agentVault: ticket.agentVault,
            lots: ticket.lots
        });
        uint256 paymentValueUBA = redeemedValueUBA.sub(_state.redemptionFeeUBA);
        emit RedemptionRequested(ticket.agentVault, ticket.underlyingAddress, 
            paymentValueUBA, _currentUnderlyingBlock, lastUnderlyingBlock, requestId);
        if (_redeemedLots == ticket.lots) {
            _deleteRedemptionTicket(_state, _redemptionTicketId);
        } else {
            ticket.lots -= _redeemedLots;   // safe, _redeemedLots = min(_lots, ticket.lots)
        }
    }
    
    function _confirmRedemptionRequestPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        require(_redemptionRequestId != 0, "invalid request id");
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.lots != 0, "invalid request id");
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        _verifyRequiredPayment(_state, _paymentInfo, 
            request.agentUnderlyingAddress, request.redeemerUnderlyingAddress,
            paymentValueUBA, request.firstUnderlyingBlock, request.lastUnderlyingBlock);
        Agent storage agent = _state.agents[request.agentVault];
        agent.mintedLots = SafeMath64.sub64(agent.mintedLots, request.lots, "ERROR: not enough minted lots");
        // TODO: remove pending challenge
        if (request.underlyingFeeUBA >= _paymentInfo.gasUBA) {
            agent.allowedUnderlyingPayments[request.agentUnderlyingAddress] +=
                request.underlyingFeeUBA - _paymentInfo.gasUBA;     // += cannot overflow - both are uint192
        } else {
            uint256 requiredTopup = _paymentInfo.gasUBA - request.underlyingFeeUBA;
            _requireUnderlyingTopup(_state, request.agentVault, request.agentUnderlyingAddress, 
                requiredTopup, _currentUnderlyingBlock);
        }
        delete _state.redemptionRequests[_redemptionRequestId];
    }
    
    function _requireUnderlyingTopup(
        State storage _state,
        address _agentVault,
        bytes32 _agentUnderlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForTopupPayment);
        agent.requiredUnderlyingTopups.push(TopupRequirement({
            underlyingAddress: _agentUnderlyingAddress,
            valueUBA: _valueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock
        }));
        agent.allowedUnderlyingPayments[_agentUnderlyingAddress] = 0;
        emit TopupRequired(_agentVault, _agentUnderlyingAddress, _valueUBA, 
            _currentUnderlyingBlock, lastUnderlyingBlock, 
            SafeMath64.toUint64(agent.requiredUnderlyingTopups.length));
    }
    
    function _redemptionPaymentFailure(
        State storage _state,
        uint256 _lotSizeWei,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        require(_redemptionRequestId != 0, "invalid request id");
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.lots != 0, "invalid request id");
        require(request.lastUnderlyingBlock <= _currentUnderlyingBlock, "too soon for default");
        require(msg.sender == request.redeemer, "only redeemer");
        // pay redeemer in native currency
        uint256 amount = _lotSizeWei.mul(request.lots).mulDiv(_state.redemptionFailureFactorBIPS, MAX_BIPS);
        // TODO: move out of library?
        IAgentVault(request.agentVault).liquidate(request.redeemer, amount);
        // release agent collateral and underlying collateral
        Agent storage agent = _state.agents[request.agentVault];
        agent.mintedLots = SafeMath64.sub64(agent.mintedLots, request.lots, "ERROR: not enough minted lots");
        agent.allowedUnderlyingPayments[request.agentUnderlyingAddress] +=
                uint256(request.lots).mul(_state.lotSizeUBA);
        delete _state.redemptionRequests[_redemptionRequestId];
    }
    
    function _getCollateralReservation(State storage _state, uint64 _crtId) 
        internal view
        returns (CollateralReservation storage) 
    {
        require(_crtId > 0 && _state.crts[_crtId].lots != 0, "invalid crt id");
        return _state.crts[_crtId];
    }

    function _getAgent(State storage _state, address _agentVault) internal view returns (Agent storage) {
        return _state.agents[_agentVault];
    }
    
}
