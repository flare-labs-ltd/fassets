// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafePctX.sol";
import "./Agents.sol";


library AgentCollateral {
    using SafeMath for uint256;
    using SafePctX for uint256;

    event AgentFreeCollateralChanged(
        address vaultAddress, 
        uint256 freeCollateral);
        
    function freeCollateralLots(
        Agents.Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeCollateral = freeCollateralWei(_agent, _fullCollateral, _lotSizeWei);
        uint256 lotCollateral = _lotSizeWei.mulBips(_agent.mintingCollateralRatioBIPS);
        return freeCollateral.div(lotCollateral);
    }

    function freeCollateralWei(
        Agents.Agent storage _agent, 
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
        Agents.Agent storage _agent, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = uint256(_agent.reservedLots).mul(_lotSizeWei)
            .mulBips(_agent.mintingCollateralRatioBIPS);
        // old reserved collateral (from before agent exited and re-entered minting queue), at old minting ratio
        uint256 oldReservedCollateral = uint256(_agent.oldReservedLots).mul(_lotSizeWei)
            .mulBips(_agent.oldMintingCollateralRatioBIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = uint256(_agent.mintedLots).mul(_lotSizeWei)
            .mulBips(_agent.minCollateralRatioBIPS);
        return reservedCollateral.add(oldReservedCollateral).add(mintedCollateral);
    }
    
    function mintingLotCollateral(
        Agents.Agent storage _agent, 
        uint256 _lotSizeWei
    ) 
        internal view 
        returns (uint256) 
    {
        return _lotSizeWei.mulBips(_agent.mintingCollateralRatioBIPS);
    }
}
