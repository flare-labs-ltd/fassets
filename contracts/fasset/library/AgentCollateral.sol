// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "./AssetManagerState.sol";


library AgentCollateral {
    using SafeMath for uint256;
    using SafePct for uint256;

    event AgentFreeCollateralChanged(
        address vaultAddress, 
        uint256 freeCollateral);

    function freeCollateralLots(
        Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeCollateral = freeCollateralWei(_agent, _fullCollateral, _lotSizeWei);
        uint256 lotCollateral = _lotSizeWei.mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
        return freeCollateral.div(lotCollateral);
    }

    function freeCollateralWei(
        Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedCollateralWei(_agent, _lotSizeWei);
        (, uint256 freeCollateral) = _fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    function lockedCollateralWei(
        Agent storage _agent, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = uint256(_agent.reservedLots).mul(_lotSizeWei)
            .mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
        // old reserved collateral (from before agent exited and re-entered minting queue), at old minting ratio
        uint256 oldReservedCollateral = uint256(_agent.oldReservedLots).mul(_lotSizeWei)
            .mulDiv(_agent.oldMintingCollateralRatioBIPS, MAX_BIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = uint256(_agent.mintedLots).mul(_lotSizeWei)
            .mulDiv(_agent.minCollateralRatioBIPS, MAX_BIPS);
        return reservedCollateral.add(oldReservedCollateral).add(mintedCollateral);
    }
    
    function mintingLotCollateral(Agent storage _agent, uint256 _lotSizeWei) internal view returns (uint256) {
        return _lotSizeWei.mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
    }
}
