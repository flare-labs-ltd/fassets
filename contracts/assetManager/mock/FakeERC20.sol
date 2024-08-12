// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../governance/implementation/Governed.sol";


contract FakeERC20 is ERC20, Governed, IERC165 {
    uint8 private immutable decimals_;

    constructor(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    )
        ERC20(_name, _symbol)
        Governed(_governanceSettings, _initialGovernance)
    {
        decimals_ = _decimals;
    }

    function mintAmount(address _target, uint256 amount) public onlyGovernance {
        _mint(_target, amount);
    }

    function burnAmount(uint256 _amount) public {
        _burn(msg.sender, _amount);
    }

    function decimals() public view override returns (uint8) {
        return decimals_;
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
            || _interfaceId == type(IERC20Metadata).interfaceId;
    }
}
