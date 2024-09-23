// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "./AssetManagerBase.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../../utils/lib/SafePct.sol";
import "../library/data/TransferFeeTracking.sol";


contract TransferFeeFacet is AssetManagerBase, IAssetManagerEvents {
    modifier onlyFAsset {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        require(msg.sender == settings.fAsset, "only FAsset");
        _;
    }

    function claimTransferFees()
        external
        returns (uint256 _claimedAmount, uint256 _remainingUnclaimedEpochs)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        (_claimedAmount, _remainingUnclaimedEpochs) =
            TransferFeeTracking.claimFees(state.transferFeeTracking, msg.sender);
        emit TransferFeesClaimed(msg.sender, _claimedAmount, _remainingUnclaimedEpochs);
    }

    function fassetTransferFeePaid(uint256 _fee)
        external
        onlyFAsset
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        TransferFeeTracking.addFees(state.transferFeeTracking, _fee);
    }

    function fassetTransferFeeAmount(uint256 _transferAmount)
        external view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return SafePct.mulDiv(_transferAmount, settings.transferFeeMillionths, 1000000);
    }
}
