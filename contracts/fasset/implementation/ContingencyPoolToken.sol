// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../userInterfaces/IContingencyPoolToken.sol";
import "../interface/IIContingencyPool.sol";


contract ContingencyPoolToken is IContingencyPoolToken, ERC20, IERC165 {
    address public immutable contingencyPool;

    modifier onlyContingencyPool {
        require(msg.sender == contingencyPool, "only contingency pool");
        _;
    }

    constructor(address payable _contingencyPool)
        ERC20("FAsset Contingency Pool Token", "FCPT")
    {
        contingencyPool = _contingencyPool;
    }

    function mint(address _account, uint256 _amount) external onlyContingencyPool {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external onlyContingencyPool {
        _burn(_account, _amount);
    }

    function destroy(address payable _recipient) external onlyContingencyPool {
        // do nothing since selfdestruct is deprecated
    }

    function transferableBalanceOf(address _account) public view returns (uint256) {
        return IIContingencyPool(contingencyPool).transferableTokensOf(_account);
    }

    function lockedBalanceOf(address _account) public view returns (uint256) {
        return IIContingencyPool(contingencyPool).lockedTokensOf(_account);
    }

    function _beforeTokenTransfer(
        address from, address /* to */, uint256 amount
    ) internal view override {
        if (msg.sender != contingencyPool) { // contingency pool can mint and burn locked tokens
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
            || _interfaceId == type(IContingencyPoolToken).interfaceId;
    }
}
