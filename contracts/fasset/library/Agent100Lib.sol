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
    
    enum AgentStatus { 
        EMPTY,
        NORMAL,
        LIQUIDATION
    }

    struct AllowedPaymentAnouncement {
        bytes32 underlyingAddress;
        uint256 valueUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
    }
    
    struct Agent {
        bytes32 underlyingAddress;
        // agent is allowed to withdraw fee or liquidated underlying amount (including gas)
        mapping(bytes32 => uint256) allowedUnderlyingPayments;      // underlyingAddress -> allowedUBA
        AllowedPaymentAnouncement[] announcedUnderlyingPayments;
        uint64 reservedLots;
        uint64 mintedLots;
        uint32 minCollateralRatioBIPS;
        uint64 availableAgentsForMintPos;    // (index in mint queue)+1; 0 = not in queue
        uint16 feeBIPS;
        uint32 mintingCollateralRatioBIPS;
        uint64 firstRedemptionTicketId;
        uint64 lastRedemptionTicketId;
        AgentStatus status;
        // When an agent exits and re-enters availability list, mintingCollateralRatio changes
        // so we have to acocunt for that when calculating total reserved collateral.
        // We simplify by only allowing one change before the old CRs are executed or cleared.
        // Therefore we store relevant old values here and match old/new by 0/1 flag 
        // named `availabilityEnterCountMod2` here and in CR.
        uint64 oldReservedLots;
        uint32 oldMintingCollateralRatioBIPS;
        uint8 availabilityEnterCountMod2;
    }
    
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
    }
    
    struct UnderlyingPaymentInfo {
        bytes32 sourceAddress;
        bytes32 targetAddress;
        bytes32 paymentHash;
        uint256 valueUBA;
        uint192 gasUBA;
        uint64 underlyingBlock;
    }
    
    struct AvailableAgentForMint {
        address agentVault;
        uint64 allowExitTimestamp;
    }
    
    struct RedemptionTicket {
        address agentVault;
        uint64 lots;
        bytes32 underlyingAddress;
        uint64 prev;
        uint64 next;
        uint64 prevForAgent;
        uint64 nextForAgent;
    }
    
    struct State {
        // default values
        uint16 initialMinCollateralRatioBIPS;
        uint16 liquidationMinCollateralRatioBIPS;
        uint64 minSecondsToExitAvailableForMint;
        uint64 underlyingBlocksForPayment;
        uint64 underlyingBlocksForAllowedPayment;
        uint256 lotSizeUBA;                              // in underlying asset wei/satoshi
        uint256 redemptionFee;                                  // in underlying asset wei/satoshi
        //
        mapping(address => Agent) agents;                       // mapping agentVaultAddress=>agent
        mapping(uint64 => CollateralReservation) crts;          // mapping crt_id=>crt
        mapping(uint64 => RedemptionTicket) redemptionQueue;    // mapping redemption_id=>ticket
        mapping(uint64 => RedemptionRequest) redemptionRequests;    // mapping request_id=>request
        AvailableAgentForMint[] availableAgentsForMint;
        uint64 firstRedemptionTicketId;
        uint64 lastRedemptionTicketId;
        uint64 newRedemptionTicketId;       // increment before assigning to ticket (to avoid 0)
        uint64 newCrtId;                    // increment before assigning to ticket (to avoid 0)
        uint64 newRedemptionRequestId;
        // payment verification
        // a store of payment hashes to prevent payment being used / challenged twice
        mapping(bytes32 => bytes32) verifiedPayments;
        // a linked list of payment hashes (one list per day) used for cleanup
        mapping(uint256 => bytes32) verifiedPaymentsForDay;
        uint256 verifiedPaymentsForDayStart;
    }
    
    struct CallContext {
        uint256 fullAgentCollateralWei;     // the total amount of native currency in the agent vault
        uint256 lotSizeWei;                 // current lot value in native currency WEI
    }
    
    uint256 internal constant MAX_BIPS = 10000;

    uint256 internal constant VERIFICATION_CLEANUP_DAYS = 5;
    
    event AgentEnteredMintQueue(
        address vaultAddress, 
        uint256 feeBIPS, 
        uint256 mintingCollateralRatioBIPS,
        uint256 freeCollateral);

    event AgentFreeCollateralChanged(
        address vaultAddress, 
        uint256 freeCollateral);

    event AgentExitAnounced(address vaultAddress);

    event AgentExitedMintQueue(address vaultAddress);
    
    event CollateralReserved(
        address indexed minter,
        uint256 reservationId,
        bytes32 underlyingAddress,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock);
        
    event MintingExecuted(
        address indexed vaultAddress,
        uint256 redemptionTicketId,
        uint256 lots);

    event AllowedPaymentAnnounced(
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 announcementId);
        
    event RedemptionRequested(
        bytes32 indexed underlyingAddress,
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
    
    function _enterMintQueue(
        State storage _state,
        CallContext memory _context,
        address _agentVault,
        uint16 _feeBIPS,
        uint32 _mintingCollateralRatioBIPS
    ) 
        internal 
    {
        Agent storage agent = _state.agents[_agentVault];
        // checks
        require(agent.status == AgentStatus.NORMAL, "invalid agent status");
        require(agent.availableAgentsForMintPos == 0, "agent already in queue");
        require(_mintingCollateralRatioBIPS >= agent.minCollateralRatioBIPS, "collateral ratio too small");
        require(agent.oldReservedLots == 0, "re-entering again too soon");
        // check that there is enough free collateral for at least one lot
        uint256 freeCollateral = _freeCollateral(agent, _context);
        require(freeCollateral >= _context.lotSizeWei.mulDiv(_mintingCollateralRatioBIPS, MAX_BIPS), 
            "not enough free collateral");
        // set parameters
        agent.feeBIPS = _feeBIPS; 
        agent.mintingCollateralRatioBIPS = _mintingCollateralRatioBIPS;
        // add to queue
        _state.availableAgentsForMint.push(AvailableAgentForMint({
            agentVault: _agentVault, 
            allowExitTimestamp: 0
        }));
        agent.availableAgentsForMintPos = uint64(_state.availableAgentsForMint.length);     // index+1 (0=not in list)
        agent.availabilityEnterCountMod2 = (agent.availabilityEnterCountMod2 + 1) % 2;      // always 0/1
        emit AgentEnteredMintQueue(_agentVault, _feeBIPS, _mintingCollateralRatioBIPS, freeCollateral);
    }

    function _anounceExitAvailableForMint(State storage _state, address _agentVault) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsForMintPos != 0, "not in mint queue");
        AvailableAgentForMint storage item = 
            _state.availableAgentsForMint[agent.availableAgentsForMintPos - 1];
        require(item.allowExitTimestamp == 0, "already exiting");
        item.allowExitTimestamp = uint64(block.timestamp.add(_state.minSecondsToExitAvailableForMint));
        emit AgentExitAnounced(_agentVault);
    }
    
    function _exitAvailableForMint(State storage _state, address _agentVault, bool _requireTwoStep) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsForMintPos != 0, "not in mint queue");
        uint256 ind = agent.availableAgentsForMintPos - 1;
        if (_requireTwoStep) {
            AvailableAgentForMint storage item = _state.availableAgentsForMint[ind];
            require(item.allowExitTimestamp != 0 && item.allowExitTimestamp <= block.timestamp,
                "required two-step exit");
        }
        if (ind + 1 < _state.availableAgentsForMint.length) {
            _state.availableAgentsForMint[ind] = 
                _state.availableAgentsForMint[_state.availableAgentsForMint.length - 1];
            _state.agents[_state.availableAgentsForMint[ind].agentVault].availableAgentsForMintPos = uint64(ind + 1);
        }
        agent.availableAgentsForMintPos = 0;
        _state.availableAgentsForMint.pop();
        emit AgentExitedMintQueue(_agentVault);
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
        require(_freeCollateralLots(agent, _context) >= _lots, "not enough free collateral");
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
        delete _state.crts[_crtId];
        emit MintingExecuted(agentVault, redemptionTicketId, lots);
    }
    
    function _verifyRequiredPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo,
        bytes32 _expectedSource,
        bytes32 _expectedTarget,
        uint256 _expectedValueUBA,
        uint256 _firstExpectedBlock,
        uint256 _lastExpectedBlock
    )
        internal
    {
        require(_state.verifiedPayments[_paymentInfo.paymentHash] == 0, "payment already verified");
        require(_paymentInfo.sourceAddress == _expectedSource, "invalid payment source");
        require(_paymentInfo.targetAddress == _expectedTarget, "invalid payment target");
        require(_paymentInfo.valueUBA == _expectedValueUBA, "invalid payment value");
        require(_paymentInfo.underlyingBlock >= _firstExpectedBlock, "payment too old");
        require(_paymentInfo.underlyingBlock <= _lastExpectedBlock, "payment too late");
        // TODO: remove pending challenge
        _markPaymentVerified(_state, _paymentInfo.paymentHash);
    }
    
    function _anounceAllowedPayment(
        State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.allowedUnderlyingPayments[_underlyingAddress] >= _valueUBA,
            "payment larger than allowed");
        agent.allowedUnderlyingPayments[_underlyingAddress] -= _valueUBA;   // guarded by require
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, 
            _state.underlyingBlocksForAllowedPayment);
        agent.announcedUnderlyingPayments.push(AllowedPaymentAnouncement({
            underlyingAddress: _underlyingAddress,
            valueUBA: _valueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock
        }));
        emit AllowedPaymentAnnounced(_underlyingAddress, _valueUBA, _currentUnderlyingBlock, lastUnderlyingBlock,
            SafeMath64.toUint64(agent.announcedUnderlyingPayments.length));
    }
    
    function _reportAllowedPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(_announcementId > 0, "invalid announcement id");
        AllowedPaymentAnouncement storage announcement = agent.announcedUnderlyingPayments[_announcementId - 1];
        require(announcement.valueUBA != 0, "invalid announcement id");
        require(_state.verifiedPayments[_paymentInfo.paymentHash] == 0, "payment already verified");
        require(_paymentInfo.sourceAddress == announcement.underlyingAddress, "invalid payment source");
        require(_paymentInfo.valueUBA == announcement.valueUBA, "invalid payment value");
        require(_paymentInfo.underlyingBlock >= announcement.firstUnderlyingBlock, "payment too old");
        require(_paymentInfo.underlyingBlock <= announcement.lastUnderlyingBlock, "payment too late");
        // TODO: remove pending challenge
        _markPaymentVerified(_state, _paymentInfo.paymentHash);
    }
    
    function _markPaymentVerified(State storage _state, bytes32 _paymentHash) internal {
        uint256 day = block.timestamp / 86400;
        bytes32 first = _state.verifiedPaymentsForDay[day];
        _state.verifiedPayments[_paymentHash] = first != 0 ? first : _paymentHash;  // last in list points to itself
        _state.verifiedPaymentsForDay[day] = _paymentHash;
        if (_state.verifiedPaymentsForDayStart == 0) {
            _state.verifiedPaymentsForDayStart = day;
        }
        // cleanup one old payment hash (> 5 days) for each new payment hash
        _cleanupPaymentVerification(_state);
    }
    
    function _cleanupPaymentVerification(State storage _state) internal {
        uint256 startDay = _state.verifiedPaymentsForDayStart;
        if (startDay == 0 || startDay > block.timestamp / 86400 - VERIFICATION_CLEANUP_DAYS) return;
        bytes32 first = _state.verifiedPaymentsForDay[startDay];
        if (first != 0) {
            bytes32 next = _state.verifiedPayments[first];
            _state.verifiedPayments[first] = 0;
            if (next == first) {    // last one in the list points to itself
                _state.verifiedPaymentsForDay[startDay] = 0;
                _state.verifiedPaymentsForDayStart = startDay + 1;
            } else {
                _state.verifiedPaymentsForDay[startDay] = next;
            }
        } else {
            _state.verifiedPaymentsForDayStart = startDay + 1;
        }
    }
    
    function _redeemAgainstTicket(
        State storage _state,
        uint64 _redemptionTicketId,
        uint64 _lots,
        bytes32 _redeemerUnderlyingAddress,
        uint64 _currentUnderlyingBlock
    ) 
        internal 
        returns (uint64 _redeemedLots)
    {
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
            underlyingFeeUBA: SafeMathX.toUint192(_state.redemptionFee),
            lastUnderlyingBlock: lastUnderlyingBlock,
            agentVault: ticket.agentVault,
            lots: ticket.lots
        });
        emit RedemptionRequested(ticket.underlyingAddress, 
            redeemedValueUBA, _currentUnderlyingBlock, lastUnderlyingBlock, requestId);
        if (_redeemedLots == ticket.lots) {
            _deleteRedemptionTicket(_state, _redemptionTicketId);
        } else {
            ticket.lots -= _redeemedLots;
        }
    }

    function _createRedemptionTicket(
        State storage _state, 
        address _agentVault,
        uint64 _lots,
        bytes32 _underlyingAddress
    ) 
        internal 
        returns (uint64)
    {
        Agent storage agent = _state.agents[_agentVault];
        uint64 ticketId = ++_state.newRedemptionTicketId;   // pre-increment - id can never be 0
        // insert new ticket to the last place in global and agent redemption queues
        _state.redemptionQueue[ticketId] = RedemptionTicket({
            agentVault: _agentVault,
            lots: _lots,
            underlyingAddress: _underlyingAddress,
            prev: _state.lastRedemptionTicketId,
            next: 0,
            prevForAgent: agent.lastRedemptionTicketId,
            nextForAgent: 0
        });
        // update links in global redemption queue
        if (_state.firstRedemptionTicketId == 0) {
            assert(_state.lastRedemptionTicketId == 0);    // empty queue - first and last must be 0
            _state.firstRedemptionTicketId = ticketId;
        } else {
            assert(_state.lastRedemptionTicketId != 0);    // non-empty queue - first and last must be non-zero
            _state.redemptionQueue[_state.lastRedemptionTicketId].next = ticketId;
        }
        _state.lastRedemptionTicketId = ticketId;
        // update links in agent redemption queue
        if (agent.firstRedemptionTicketId == 0) {
            assert(agent.lastRedemptionTicketId == 0);    // empty queue - first and last must be 0
            agent.firstRedemptionTicketId = ticketId;
        } else {
            assert(agent.lastRedemptionTicketId != 0);    // non-empty queue - first and last must be non-zero
            _state.redemptionQueue[agent.lastRedemptionTicketId].next = ticketId;
        }
        agent.lastRedemptionTicketId = ticketId;
        // return the new redemption ticket's id
        return ticketId;
    }
    
    function _deleteRedemptionTicket(
        State storage _state, 
        uint64 ticketId
    )
        internal
    {
        RedemptionTicket storage ticket = _state.redemptionQueue[ticketId];
        Agent storage agent = _state.agents[ticket.agentVault];
        // unlink from global queue
        if (ticket.prev == 0) {
            assert(ticketId == _state.firstRedemptionTicketId);     // ticket is first in queue
            _state.firstRedemptionTicketId = ticket.next;
        } else {
            assert(ticketId != _state.firstRedemptionTicketId);     // ticket is not first in queue
            _state.redemptionQueue[ticket.prev].next = ticket.next;
        }
        if (ticket.next == 0) {
            assert(ticketId == _state.lastRedemptionTicketId);     // ticket is last in queue
            _state.lastRedemptionTicketId = ticket.prev;
        } else {
            assert(ticketId != _state.lastRedemptionTicketId);     // ticket is not last in queue
            _state.redemptionQueue[ticket.next].prev = ticket.prev;
        }
        // unlink from agent queue
        if (ticket.prevForAgent == 0) {
            assert(ticketId == agent.firstRedemptionTicketId);     // ticket is first in agent queue
            agent.firstRedemptionTicketId = ticket.nextForAgent;
        } else {
            assert(ticketId != agent.firstRedemptionTicketId);     // ticket is not first in agent queue
            _state.redemptionQueue[ticket.prevForAgent].nextForAgent = ticket.nextForAgent;
        }
        if (ticket.nextForAgent == 0) {
            assert(ticketId == agent.lastRedemptionTicketId);     // ticket is last in agent queue
            agent.lastRedemptionTicketId = ticket.prevForAgent;
        } else {
            assert(ticketId != agent.lastRedemptionTicketId);     // ticket is not last in agent queue
            _state.redemptionQueue[ticket.nextForAgent].prevForAgent = ticket.prevForAgent;
        }
        // delete storage
        delete _state.redemptionQueue[ticketId];
    }
    
    function _getMintQueue(State storage _state, uint256 _start, uint256 _end) 
        internal view 
        returns (address[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.availableAgentsForMint.length;
        if (_start >= _totalLength) {
            return (new address[](0), _totalLength);
        }
        if (_end > _totalLength) {
            _end = _totalLength;
        }
        _agents = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _agents[i - _start] = _state.availableAgentsForMint[i].agentVault;
        }
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
    
    function _agentCollateral(WNat _wnat, address _agentVault) internal view returns (uint256) {
        return _wnat.balanceOf(_agentVault);
    }

    function _freeCollateralLots(Agent storage _agent, CallContext memory _context) private view returns (uint256) {
        uint256 freeCollateral = _freeCollateral(_agent, _context);
        uint256 lotCollateral = _context.lotSizeWei.mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
        return freeCollateral.div(lotCollateral);
    }

    function _freeCollateral(Agent storage _agent, CallContext memory _context) private view returns (uint256) {
        uint256 lockedCollateral = _lockedCollateral(_agent, _context);
        (, uint256 freeCollateral) = _context.fullAgentCollateralWei.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    function _lockedCollateral(Agent storage _agent, CallContext memory _context) private view returns (uint256) {
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = uint256(_agent.reservedLots).mul(_context.lotSizeWei)
            .mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
        // old reserved collateral (from before agent exited and re-entered minting queue), at old minting ratio
        uint256 oldReservedCollateral = uint256(_agent.oldReservedLots).mul(_context.lotSizeWei)
            .mulDiv(_agent.oldMintingCollateralRatioBIPS, MAX_BIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = uint256(_agent.mintedLots).mul(_context.lotSizeWei)
            .mulDiv(_agent.minCollateralRatioBIPS, MAX_BIPS);
        return reservedCollateral.add(oldReservedCollateral).add(mintedCollateral);
    }
}
