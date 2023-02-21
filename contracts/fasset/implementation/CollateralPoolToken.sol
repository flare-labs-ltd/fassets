// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./CollateralPool.sol";

contract CollateralPoolToken is ERC20 {
    address payable public immutable collateralPool;

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

    function destroy() external onlyCollateralPool {
        selfdestruct(collateralPool);
    }

    function freeBalanceOf(address _account) public view returns (uint256) {
        return CollateralPool(collateralPool).liquidTokensOf(_account);
    }

    // override balanceOf to account for locked collateral
    function _beforeTokenTransfer(
        address from, address /* to */, uint256 amount
    ) internal view override {
        require(amount <= freeBalanceOf(from), "liquid balance too low");
    }
}
