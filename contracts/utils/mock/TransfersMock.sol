// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../openzeppelin/security/ReentrancyGuard.sol";
import { Transfers } from "../../utils/lib/Transfers.sol";


contract TransfersMock is ReentrancyGuard {
    receive() external payable {
    }

    function transferNAT(address payable _recipient, uint256 _amount)
        external
        nonReentrant
    {
        Transfers.transferNAT(_recipient, _amount);
    }

    function transferNATAllowFailure(address payable _recipient, uint256 _amount)
        external
        nonReentrant
        returns (bool)
    {
        return Transfers.transferNATAllowFailure(_recipient, _amount);
    }

    function transferNATNoGuard(address payable _recipient, uint256 _amount)
        external
    {
        Transfers.transferNAT(_recipient, _amount);
    }

    function transferNATAllowFailureNoGuard(address payable _recipient, uint256 _amount)
        external
        returns (bool)
    {
        return Transfers.transferNATAllowFailure(_recipient, _amount);
    }
}
