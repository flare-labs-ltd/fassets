// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../userInterfaces/ICollateralPoolToken.sol";


interface IICollateralPoolToken is ICollateralPoolToken, IERC165 {

    function mint(address _account, uint256 _amount) external;
    function burn(address _account, uint256 _amount) external;
    function destroy(address payable _recipient) external;
}
