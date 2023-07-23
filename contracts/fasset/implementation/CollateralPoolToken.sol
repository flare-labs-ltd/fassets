// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../userInterfaces/ICollateralPoolToken.sol";
import "./CollateralPool.sol";


contract CollateralPoolToken is ICollateralPoolToken, ERC20, IERC165 {
    address public immutable collateralPool;

    modifier onlyCollateralPool {
        require(msg.sender == collateralPool, "only collateral pool");
        _;
    }

    constructor(address payable _collateralPool)
        ERC20("FAsset Collateral Pool Token", "FCPT")
    {
        collateralPool = _collateralPool;
    }

    function mint(address _account, uint256 _amount) external onlyCollateralPool {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external onlyCollateralPool {
        _burn(_account, _amount);
    }

    function destroy(address payable _recipient) external onlyCollateralPool {
        // do nothing since selfdestruct is deprecated
    }

    function transferableBalanceOf(address _account) public view returns (uint256) {
        return CollateralPool(payable(collateralPool)).transferableTokensOf(_account);
    }

    function lockedBalanceOf(address _account) public view returns (uint256) {
        return CollateralPool(payable(collateralPool)).lockedTokensOf(_account);
    }

    function _beforeTokenTransfer(
        address from, address /* to */, uint256 amount
    ) internal view override {
        if (msg.sender != collateralPool) { // collateral pool can mint and burn locked tokens
            require(amount <= transferableBalanceOf(from), "free balance too low");
        }
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IERC20).interfaceId
            || _interfaceId == type(ICollateralPoolToken).interfaceId;
    }
}
