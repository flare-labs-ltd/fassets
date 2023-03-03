// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./CollateralPool.sol";

contract CollateralPoolToken is ERC20 {
    address public immutable collateralPool;

    modifier onlyCollateralPool {
        require(msg.sender == collateralPool, "only collateral pool");
        _;
    }

    constructor(address _collateralPool)
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
        // only used at pool destruct so the balance will be moved anyway
        selfdestruct(_recipient);
    }

    function freeBalanceOf(address _account) public view returns (uint256) {
        return CollateralPool(collateralPool).freeTokensOf(_account);
    }

    // override balanceOf to account for locked/debt collateral
    function _beforeTokenTransfer(
        address from, address /* to */, uint256 amount
    ) internal view override {
        if (from != address(0)) { // collateral pool can burn locked tokens
            require(amount <= freeBalanceOf(from), "liquid balance too low");
        }
    }
}
