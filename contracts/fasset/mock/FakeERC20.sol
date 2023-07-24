// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract FakeERC20 is ERC20, IERC165 {
    address public minter;

    modifier onlyMinter {
        require(msg.sender == minter, "only minter");
        _;
    }

    constructor(address _minter, string memory _name, string memory _symbol)
        ERC20(_name, _symbol)
    {
        minter = _minter;
    }

    function mintAmount(address _target, uint256 amount) public onlyMinter {
        _mint(_target, amount);
    }

    function burnAmount(address _target, uint256 _amount) public onlyMinter {
        _burn(_target, _amount);
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
