// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract CollateralPoolToken is ERC20 {
    uint256 private constant MAX_DELAYED_MINTINGS = 10;
    
    address payable public immutable collateralPool;
    
    struct DelayedMinting {
        uint128 amount;
        uint64 timestamp;
    }
    
    mapping(address => DelayedMinting[]) private delayedMintings;
    
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
    
    function mintDelayed(address _account, uint256 _amount, uint256 _mintAt) external onlyCollateralPool {
        DelayedMinting[] storage accountMintings = delayedMintings[_account];
        require(accountMintings.length < MAX_DELAYED_MINTINGS, "too many delayed mintings");
        accountMintings.push(DelayedMinting({
            amount: SafeCast.toUint128(_amount),
            timestamp: SafeCast.toUint64(_mintAt)
        }));
    }
    
    /**
     * Claim ONE delayed minting.
     */
    function claimDelayedMinting() external {
        DelayedMinting[] storage senderMintings = delayedMintings[msg.sender];
        uint256 length = senderMintings.length;
        for (uint256 i = 0; i < length; i++) {
            DelayedMinting storage minting = senderMintings[i];
            if (minting.timestamp <= block.timestamp) {
                _mint(msg.sender, minting.amount);
                if (i < length - 1) {
                    senderMintings[i] = senderMintings[length - 1];
                }
                senderMintings.pop();
                break;
            }
        }
    }
    
    function burn(address _account, uint256 _amount) external onlyCollateralPool {
        _burn(_account, _amount);
    }
    
    function destroy() external onlyCollateralPool {
        selfdestruct(collateralPool);
    }
}
