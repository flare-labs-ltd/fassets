// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "flare-smart-contracts/contracts/userInterfaces/IGovernanceSettings.sol";


/**
 * @title Governed Base
 * @notice This abstract base class defines behaviors for a governed contract.
 * @dev This class is abstract so that specific behaviors can be defined for the constructor.
 *   Contracts should not be left ungoverned, but not all contract will have a constructor
 *   (for example those pre-defined in genesis).
 * @dev This version is compatible with both Flare (where governance settings is in genesis at the address
 *   0x1000000000000000000000000000000000000007) and Songbird (where governance settings is a deployed contract).
 **/
abstract contract GovernedBase {
    struct TimelockedCall {
        uint256 allowedAfterTimestamp;
        bytes encodedCall;
    }

    IGovernanceSettings public governanceSettings;

    bool private initialised;

    bool public productionMode;

    bool private executing;

    address private initialGovernance;

    mapping(bytes4 => TimelockedCall) public timelockedCalls;

    event GovernanceCallTimelocked(bytes4 selector, uint256 allowedAfterTimestamp, bytes encodedCall);
    event TimelockedGovernanceCallExecuted(bytes4 selector, uint256 timestamp);
    event TimelockedGovernanceCallCanceled(bytes4 selector, uint256 timestamp);

    event GovernanceInitialised(address initialGovernance);
    event GovernedProductionModeEntered(address governanceSettings);

    modifier onlyGovernance {
        if (executing || !productionMode) {
            _beforeExecute();
            _;
        } else {
            _recordTimelockedCall(msg.data);
        }
    }

    modifier onlyImmediateGovernance () {
        _checkOnlyGovernance();
        _;
    }

    constructor() {
    }

    /**
     * @notice Execute the timelocked governance calls once the timelock period expires.
     * @dev Only executor can call this method.
     * @param _selector The method selector (only one timelocked call per method is stored).
     */
    function executeGovernanceCall(bytes4 _selector) external {
        require(isExecutor(msg.sender), "only executor");
        TimelockedCall storage call = timelockedCalls[_selector];
        require(call.allowedAfterTimestamp != 0, "timelock: invalid selector");
        require(block.timestamp >= call.allowedAfterTimestamp, "timelock: not allowed yet");
        bytes memory encodedCall = call.encodedCall;
        delete timelockedCalls[_selector];
        executing = true;
        //solhint-disable-next-line avoid-low-level-calls
        (bool success,) = address(this).call(encodedCall);
        executing = false;
        emit TimelockedGovernanceCallExecuted(_selector, block.timestamp);
        _passReturnOrRevert(success);
    }

    /**
     * Cancel a timelocked governance call before it has been executed.
     * @dev Only governance can call this method.
     * @param _selector The method selector.
     */
    function cancelGovernanceCall(bytes4 _selector) external onlyImmediateGovernance {
        require(timelockedCalls[_selector].allowedAfterTimestamp != 0, "timelock: invalid selector");
        emit TimelockedGovernanceCallCanceled(_selector, block.timestamp);
        delete timelockedCalls[_selector];
    }

    /**
     * Enter the production mode after all the initial governance settings have been set.
     * This enables timelocks and the governance is afterwards obtained by calling
     * governanceSettings.getGovernanceAddress().
     */
    function switchToProductionMode() external {
        _checkOnlyGovernance();
        require(!productionMode, "already in production mode");
        initialGovernance = address(0);
        productionMode = true;
        emit GovernedProductionModeEntered(address(governanceSettings));
    }

    /**
     * @notice Initialize the governance address if not first initialized.
     */
    function initialise(IGovernanceSettings _governanceSettings, address _initialGovernance) public virtual {
        require(initialised == false, "initialised != false");
        require(address(_governanceSettings) != address(0), "governance settings zero");
        require(_initialGovernance != address(0), "_governance zero");
        initialised = true;
        governanceSettings = _governanceSettings;
        initialGovernance = _initialGovernance;
        emit GovernanceInitialised(_initialGovernance);
    }

    /**
     * Returns the current effective governance address.
     */
    function governance() public view returns (address) {
        return productionMode ? governanceSettings.getGovernanceAddress() : initialGovernance;
    }

    /**
     * Internal function to check if an address is executor.
     */
    function isExecutor(address _address) public view returns (bool) {
        return initialised && governanceSettings.isExecutor(_address);
    }

    function _beforeExecute() private {
        if (executing) {
            // can only be run from executeGovernanceCall(), where we check that only executor can call
            // make sure nothing else gets executed, even in case of reentrancy
            assert(msg.sender == address(this));
            executing = false;
        } else {
            // must be called with: productionMode=false
            // must check governance in this case
            _checkOnlyGovernance();
        }
    }

    function _recordTimelockedCall(bytes calldata _data) private {
        _checkOnlyGovernance();
        bytes4 selector;
        //solhint-disable-next-line no-inline-assembly
        assembly {
            selector := calldataload(_data.offset)
        }
        uint256 timelock = governanceSettings.getTimelock();
        uint256 allowedAt = block.timestamp + timelock;
        timelockedCalls[selector] = TimelockedCall({
            allowedAfterTimestamp: allowedAt,
            encodedCall: _data
        });
        emit GovernanceCallTimelocked(selector, allowedAt, _data);
    }

    function _checkOnlyGovernance() private view {
        require(msg.sender == governance(), "only governance");
    }

    function _passReturnOrRevert(bool _success) private pure {
        // pass exact return or revert data - needs to be done in assembly
        //solhint-disable-next-line no-inline-assembly
        assembly {
            let size := returndatasize()
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, size))
            returndatacopy(ptr, 0, size)
            if _success {
                return(ptr, size)
            }
            revert(ptr, size)
        }
    }
}
