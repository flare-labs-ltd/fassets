// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Redemptions.sol";

library RedemptionRequests {
    using SafePct for *;
    using SafeCast for uint256;
    using RedemptionQueue for RedemptionQueue.State;

    struct AgentRedemptionData {
        address agentVault;
        uint64 valueAMG;
    }

    struct AgentRedemptionList {
        AgentRedemptionData[] items;
        uint256 length;
    }

    function redeem(
        address _redeemer,
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        external
    {
        uint256 maxRedeemedTickets = AssetManagerState.getSettings().maxRedeemedTickets;
        AgentRedemptionList memory redemptionList = AgentRedemptionList({
            length: 0,
            items: new AgentRedemptionData[](maxRedeemedTickets)
        });
        uint64 redeemedLots = 0;
        for (uint256 i = 0; i < maxRedeemedTickets && redeemedLots < _lots; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 redeemedForTicket = _redeemFirstTicket(_lots - redeemedLots, redemptionList);
            if (redeemedForTicket == 0) {
                break;   // queue empty
            }
            redeemedLots += redeemedForTicket;
        }
        require(redeemedLots != 0, "redeem 0 lots");
        for (uint256 i = 0; i < redemptionList.length; i++) {
            _createRedemptionRequest(redemptionList.items[i], _redeemer, _redeemerUnderlyingAddress);
        }
        // notify redeemer of incomplete requests
        if (redeemedLots < _lots) {
            emit AMEvents.RedemptionRequestIncomplete(_redeemer, _lots - redeemedLots);
        }
        // burn the redeemed value of fassets
        uint256 redeemedUBA = Conversion.convertLotsToUBA(redeemedLots);
        Redemptions.burnFAssets(msg.sender, redeemedUBA);
    }

    function redeemFromAgent(
        address _agentVault,
        address _redeemer,
        uint256 _amountUBA,
        string memory _receiverUnderlyingAddress
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireOnlyCollateralPool(agent);
        require(_amountUBA != 0, "redemption of 0");
        // close redemption tickets
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        (uint64 closedAMG, uint256 closedUBA) = Redemptions.closeTickets(agent, amountAMG);
        // create redemption request
        AgentRedemptionData memory redemption = AgentRedemptionData(_agentVault, closedAMG);
        _createRedemptionRequest(redemption, _redeemer, _receiverUnderlyingAddress);
        // burn the closed assets
        Redemptions.burnFAssets(msg.sender, closedUBA);
    }

    function redeemFromAgentInCollateral(
        address _agentVault,
        address _redeemer,
        uint256 _amountUBA
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireOnlyCollateralPool(agent);
        require(_amountUBA != 0, "redemption of 0");
        // close redemption tickets
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        (uint64 closedAMG, uint256 closedUBA) = Redemptions.closeTickets(agent, amountAMG);
        // pay in collateral
        uint256 priceAmgToWei = Conversion.currentAmgPriceInTokenWei(agent.class1CollateralIndex);
        uint256 paymentWei = Conversion.convertAmgToTokenWei(closedAMG, priceAmgToWei)
            .mulBips(agent.buyFassetByAgentRatioBIPS);
        Agents.payoutClass1(agent, _redeemer, paymentWei);
        // burn the closed assets
        Redemptions.burnFAssets(msg.sender, closedUBA);
    }

    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        require(_amountUBA != 0, "self close of 0");
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        (, uint256 closedUBA) = Redemptions.closeTickets(agent, amountAMG);
        // burn the self-closed assets
        Redemptions.burnFAssets(msg.sender, closedUBA);
        // try to pull agent out of liquidation
        Liquidation.endLiquidationIfHealthy(agent);
        // send event
        emit AMEvents.SelfClose(_agentVault, closedUBA);
    }

    function _redeemFirstTicket(
        uint64 _lots,
        AgentRedemptionList memory _list
    )
        private
        returns (uint64 _redeemedLots)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint64 ticketId = state.redemptionQueue.firstTicketId;
        if (ticketId == 0) {
            return 0;    // empty redemption queue
        }
        RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
        uint64 maxRedeemLots = ticket.valueAMG / state.settings.lotSizeAMG;
        _redeemedLots = SafeMath64.min64(_lots, maxRedeemLots);
        uint64 redeemedAMG = _redeemedLots * state.settings.lotSizeAMG;
        address agentVault = ticket.agentVault;
        // find list index for ticket's agent
        uint256 index = 0;
        while (index < _list.length && _list.items[index].agentVault != agentVault) {
            ++index;
        }
        // add to list item or create new item
        if (index < _list.length) {
            _list.items[index].valueAMG = _list.items[index].valueAMG + redeemedAMG;
        } else {
            _list.items[_list.length++] = AgentRedemptionData({ agentVault: agentVault, valueAMG: redeemedAMG });
        }
        // _removeFromTicket may delete ticket data, so we call it at end
        Redemptions.removeFromTicket(ticketId, redeemedAMG);
    }

    function _createRedemptionRequest(
        AgentRedemptionData memory _data,
        address _redeemer,
        string memory _redeemerUnderlyingAddressString
    )
        private
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // validate redemption address
        (string memory normalizedUnderlyingAddress, bytes32 underlyingAddressHash) =
            Globals.validateAndNormalizeUnderlyingAddress(_redeemerUnderlyingAddressString);
        // create request
        uint128 redeemedValueUBA = Conversion.convertAmgToUBA(_data.valueAMG).toUint128();
        state.newRedemptionRequestId += PaymentReference.randomizedIdSkip();
        uint64 requestId = state.newRedemptionRequestId;
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock();
        uint128 redemptionFeeUBA = redeemedValueUBA.mulBips(state.settings.redemptionFeeBIPS).toUint128();
        state.redemptionRequests[requestId] = Redemption.Request({
            redeemerUnderlyingAddressHash: underlyingAddressHash,
            underlyingValueUBA: redeemedValueUBA,
            firstUnderlyingBlock: state.currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            lastUnderlyingTimestamp: lastUnderlyingTimestamp,
            timestamp: block.timestamp.toUint64(),
            underlyingFeeUBA: redemptionFeeUBA,
            redeemer: _redeemer,
            agentVault: _data.agentVault,
            valueAMG: _data.valueAMG,
            status: Redemption.Status.ACTIVE
        });
        // decrease mintedAMG and mark it to redeemingAMG
        // do not add it to freeBalance yet (only after failed redemption payment)
        Agents.startRedeemingAssets(Agent.get(_data.agentVault), _data.valueAMG);
        // emit event to remind agent to pay
        emit AMEvents.RedemptionRequested(_data.agentVault,
            requestId,
            normalizedUnderlyingAddress,
            redeemedValueUBA,
            redemptionFeeUBA,
            lastUnderlyingBlock,
            lastUnderlyingTimestamp,
            PaymentReference.redemption(requestId));
    }

    function _lastPaymentBlock()
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = block.timestamp.toUint64() - state.currentUnderlyingBlockUpdatedAt;
        _lastUnderlyingBlock =
            state.currentUnderlyingBlock + state.settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp =
            state.currentUnderlyingBlockTimestamp + timeshift + state.settings.underlyingSecondsForPayment;
    }
}
