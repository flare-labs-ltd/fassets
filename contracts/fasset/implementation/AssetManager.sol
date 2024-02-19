// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../interfaces/IIAgentVault.sol";
import "../interfaces/IIAssetManager.sol";
import "../../stateConnector/interfaces/ISCProofVerifier.sol";
import "../interfaces/IFAsset.sol";
import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
import "../library/LiquidationStrategy.sol";
// external
import "../library/SettingsUpdater.sol";
import "../library/StateUpdater.sol";
import "../library/AvailableAgents.sol";
import "../library/AgentsExternal.sol";
import "../library/AgentsCreateDestroy.sol";
import "../library/CollateralReservations.sol";
import "../library/Minting.sol";
import "../library/RedemptionRequests.sol";
import "../library/RedemptionConfirmations.sol";
import "../library/RedemptionFailures.sol";
import "../library/Challenges.sol";
import "../library/Liquidation.sol";
import "../library/UnderlyingWithdrawalAnnouncements.sol";
import "../library/UnderlyingBalance.sol";
import "../library/FullAgentInfo.sol";
import "../library/CollateralTypes.sol";
import "../library/AgentSettingsUpdater.sol";


/**
 * The contract that can mint and burn f-assets while managing collateral and backing funds.
 * There is one instance of AssetManager per f-asset type.
 */
contract AssetManager {
    using SafeCast for uint256;


    ////////////////////////////////////////////////////////////////////////////////////
    // Data update







    ////////////////////////////////////////////////////////////////////////////////////
    // Agent handling


    ////////////////////////////////////////////////////////////////////////////////////
    // Manage list of agents, publicly available for minting


    ////////////////////////////////////////////////////////////////////////////////////
    // Timekeeping


    ////////////////////////////////////////////////////////////////////////////////////
    // Minting


    ////////////////////////////////////////////////////////////////////////////////////
    // Redemption


    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying withdrawal announcements


    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup


    ////////////////////////////////////////////////////////////////////////////////////
    // Illegal payment and wrong payment report challenges


    ////////////////////////////////////////////////////////////////////////////////////
    // Liquidation


    ////////////////////////////////////////////////////////////////////////////////////
    // Upgrade (second phase)




    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral type management






    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral pool redemptions


    ////////////////////////////////////////////////////////////////////////////////////
    // Other




    ////////////////////////////////////////////////////////////////////////////////////
    // ERC 165

    // /**
    //  * Implementation of ERC-165 interface.
    //  */
    // function supportsInterface(bytes4 _interfaceId)
    //     external pure override
    //     returns (bool)
    // {
    //     return _interfaceId == type(IERC165).interfaceId
    //         || _interfaceId == type(IAssetManager).interfaceId
    //         || _interfaceId == type(IIAssetManager).interfaceId;
    // }

}
