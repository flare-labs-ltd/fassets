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
    function transferAndPayFee(address _to, uint256 _amount)
        external;

    /**
     * Perform transfer (like ERC20.transfer) and pay fee by subtracting it from the transfered amount.
     * NOTE: less than `_amount` will be delivered to `_to`.
     */
    function transferSubtractingFee(address _to, uint256 _amount)
        external;

    /**
     * Transfer fees are normally paid by the account that ran the transaction (tx.origin).
     * But it is possible to assign some other account to pay transfer fees.
     * Of course, that other account must set the allowance high enough.
     * @param _payingAccount the account that pays fees for fasset transactions
     *  where tx.origin is the caller of this method; if it is `address(0)` the caller pays fees for itself
     */
    function setTransferFeesPaidBy(address _payingAccount)
        external;

    /**
     * The account that will take over paying the transfer fees for another account (`_origin`).
     * @param _origin the account for which the fee paying account is queried
     * @return _payingAccount the account that pays fees for fasset transactions originated by `_account`;
     *  if it is `address(0)` the `_origin` pays fees for itself
     */
    function transferFeesPaidBy(address _origin)
        external view
        returns (address _payingAccount);
}
