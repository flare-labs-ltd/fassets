// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


/**
 * @title Governed Base
 * @notice This abstract base class defines behaviors for a governed contract.
 * @dev This class is abstract so that specific behaviors can be defined for the constructor.
 *   Contracts should not be left ungoverned, but not all contract will have a constructor
 *   (for example those pre-defined in genesis).
 **/
abstract contract GovernedBase {
    address public governance;
    address public proposedGovernance;
    bool private initialised;

    event GovernanceProposed(address proposedGovernance);
    event GovernanceUpdated (address oldGovernance, address newGoveranance);

    modifier onlyGovernance () {
        _checkOnlyGovernance();
        _;
    }

    constructor(address _governance) {
        if (_governance != address(0)) {
            initialise(_governance);
        }
    }

    /**
     * @notice First of a two step process for turning over governance to another address.
     * @param _governance The address to propose to receive governance role.
     * @dev Must hold governance to propose another address.
     */
    function proposeGovernance(address _governance) external onlyGovernance {
        proposedGovernance = _governance;
        emit GovernanceProposed(_governance);
    }

    /**
     * @notice Once proposed, claimant can claim the governance role as the second of a two-step process.
     */
    function claimGovernance() external {
        require(msg.sender == proposedGovernance, "not claimaint");

        emit GovernanceUpdated(governance, proposedGovernance);
        governance = proposedGovernance;
        proposedGovernance = address(0);
    }

    /**
     * @notice In a one-step process, turn over governance to another address.
     * @dev Must hold governance to transfer.
     */
    function transferGovernance(address _governance) external onlyGovernance {
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        proposedGovernance = address(0);
    }

    /**
     * @notice Initialize the governance address if not first initialized.
     */
    function initialise(address _governance) public virtual {
        require(initialised == false, "initialised != false");

        initialised = true;
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        proposedGovernance = address(0);
    }

    function _checkOnlyGovernance() internal view {
        require(msg.sender == governance, "only governance");
    }
}
