// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {Agents} from "../library/Agents.sol";
import {AssetManagerState} from "../library/AssetManagerState.sol";
import {AssetManagerSettings} from "../library/AssetManagerSettings.sol";
import {CollateralReservations} from "../library/CollateralReservations.sol";
import {Conversion} from "../library/Conversion.sol";
import {Minting} from "../library/Minting.sol";
import {PaymentVerification} from "../library/PaymentVerification.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/SafeCast.sol";
import {SafeBips} from "../../utils/lib/SafeBips.sol";
import {SafeMath64} from "../../utils/lib/SafeMath64.sol";

// One asset manager per fAsset type
contract AssetManager {
    using AssetManagerState for AssetManagerState.State;

    AssetManagerState.State private state;

    constructor(AssetManagerSettings.Settings memory _state) {
        state.settings = _state;
    }

    function reserveCollateral(
        bytes32 _minterUnderlyingAddress, address _selectedAgent, uint64 _lotsToMintWei
    ) public payable 
        returns (bytes32 agentsUnderlyingAddress, uint256 crtId)
    {
        // Check fee paid
        require(msg.value >= AssetManagerSettings.getCollateralReservationFee(state.settings), "Insufficient fee");

        CollateralReservations.reserveCollateral(
            state,
            msg.sender, 
            _minterUnderlyingAddress,
            _selectedAgent, 
            Agents.fullAgentCollateral(state, _selectedAgent),
            Conversion.calculateAmgToNATWeiPrice(state.settings),
            _lotsToMintWei,
            0 // TODO: Check lates block of transaction on state connector
        );

        return (Agents.getAgent(state, _selectedAgent).underlyingAddress, state.newCrtId);
    }

    function mintfAsset(
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _crtId
    ) public 
    {
        Minting.mintingExecuted(state, _paymentInfo, _crtId);
    }

    function calculateLots(
        uint256 _underlyingValueUBA, address _selectedAgent
    ) 
        public view returns (uint64 lots, uint256 baseValueUBA, uint256 fullBaseValueUBA) 
    {
        uint256 coef = state.settings.assetMintingGranularityUBA * state.settings.lotSizeAMG;
        uint256 target = _underlyingValueUBA / coef; 
        uint256 agentFeeBips = Agents.getAgent(state, _selectedAgent).feeBIPS;
        return (SafeCast.toUint64(target), target * coef, SafeBips.mulBips(target * coef, agentFeeBips));
    }

}
