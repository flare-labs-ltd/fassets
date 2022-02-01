// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IVPToken.sol";


interface IWNat is IVPToken {
    function deposit() external payable;
    function depositTo(address recipient) external;
    function withdraw(uint256 amount) external;    
    function withdrawFrom(address owner, uint256 amount) external;
}
