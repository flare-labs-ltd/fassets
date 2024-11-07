// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";


interface IFAsset is IERC20, IERC20Metadata {
    ////////////////////////////////////////////////////////////////////////////////////
    // System information

    /**
     * The name of the underlying asset.
     */
    function assetName() external view returns (string memory);

    /**
     * The symbol of the underlying asset.
     */
    function assetSymbol() external view returns (string memory);

    /**
     * Get the asset manager, corresponding to this fAsset.
     * fAssets and asset managers are in 1:1 correspondence.
     */
    function assetManager() external view returns (address);

    /**
     * True if f-asset is terminated. Stopped f-asset can never be re-enabled.
     *
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used as an optional last phase of asset manager upgrade,
     * when the asset manager minting has already been paused for a long time but there still exist
     * unredeemable f-assets, which at this point are considered unrecoverable (lost wallet keys etc.).
     * In such case, the f-asset contract is terminated and then agents can buy back their collateral at market rate
     * (i.e. they burn market value of backed f-assets in collateral to release the rest of the collateral).
     */
    function terminated() external view returns (bool);

    ////////////////////////////////////////////////////////////////////////////////////
    // Transfer fee payment

    /**
     * Perform transfer (like ERC20.transfer) and pay fee by the `msg.sender`.
     * NOTE: more than `_amount` will be transfered from `msg.sender`.
     */
    function transferExactDest(address _to, uint256 _amount)
        external
        returns (bool);

    /**
     * Perform transfer (like ERC20.transfer) and pay fee by the `_from` account.
     * NOTE: more than `_amount` will be transfered from the `_from` account.
     * Preceeding call to `approve()` must account for this, otherwise the transfer will fail.
     */
    function transferExactDestFrom(address _from, address _to, uint256 _amount)
        external
        returns (bool);

    /**
     * Return the amount of fees that will be charged for the transfer of _transferAmount.
     */
    function transferFeeAmount(uint256 _transferAmount)
        external view
        returns (uint256);

    /**
     * Return the exact amount the `_to` will receive, if `_from` transfers `_sentAmount`.
     */
    function getReceivedAmount(address _from, address _to, uint256 _sentAmount)
        external view
        returns (uint256 _receivedAmount, uint256 _feeAmount);

    /**
     * Return the exact amount the `_from` must transfer for  `_to` to receive `_receivedAmount`.
     */
    function getSendAmount(address _from, address _to, uint256 _receivedAmount)
        external view
        returns (uint256 _sendAmount, uint256 _feeAmount);
}
