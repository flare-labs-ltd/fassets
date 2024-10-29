// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/IFAsset.sol";


contract TokenHolderMock {
    function transferTo(IERC20 _token, address _target, uint256 _amount) external {
        _token.transfer(_target, _amount);
    }

    function transferToAndPayFee(IFAsset _fAsset, address _target, uint256 _amount) external {
        _fAsset.transferAndPayFee(_target, _amount);
    }

    function transferToSubtractingFee(IFAsset _fAsset, address _target, uint256 _amount) external {
        _fAsset.transferSubtractingFee(_target, _amount);
    }
}
