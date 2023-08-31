// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../userInterfaces/data/AvailableAgentInfo.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./AgentCollateral.sol";

library AvailableAgents {
    using SafeCast for uint256;
    using AgentCollateral for Collateral.CombinedData;

    // only used in memory - no packing

    modifier onlyAgentVaultOwner(address _agentVault) {
        Agents.requireAgentVaultOwner(_agentVault);
        _;
    }

    function makeAvailable(
        address _agentVault
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        require(agent.status == Agent.Status.NORMAL, "invalid agent status");
        require(agent.availableAgentsPos == 0, "agent already available");
        // check that there is enough free collateral for at least one lot
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        uint256 freeCollateralLots = collateralData.freeCollateralLots(agent);
        require(freeCollateralLots >= 1, "not enough free collateral");
        // add to queue
        state.availableAgents.push(_agentVault);
        agent.availableAgentsPos = state.availableAgents.length.toUint32();     // index+1 (0=not in list)
        emit AMEvents.AgentAvailable(_agentVault, agent.feeBIPS,
            agent.mintingVaultCollateralRatioBIPS, agent.mintingPoolCollateralRatioBIPS, freeCollateralLots);
    }

    function announceExit(
        address _agentVault
    )
        external
        onlyAgentVaultOwner(_agentVault)
        returns (uint256)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        require(agent.availableAgentsPos != 0, "agent not available");
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 exitAfterTs = agent.exitAvailableAfterTs;
        if (exitAfterTs == 0) {
            exitAfterTs = block.timestamp + settings.agentExitAvailableTimelockSeconds;
            agent.exitAvailableAfterTs = exitAfterTs.toUint64();
            emit AMEvents.AvailableAgentExitAnnounced(_agentVault, exitAfterTs);
        }
        return exitAfterTs;
    }

    function exit(
        address _agentVault
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        require(agent.availableAgentsPos != 0, "agent not available");
        require(agent.exitAvailableAfterTs != 0, "exit not announced");
        require(block.timestamp >= agent.exitAvailableAfterTs, "exit too soon");
        require(block.timestamp <= agent.exitAvailableAfterTs + state.settings.agentTimelockedOperationWindowSeconds,
            "exit too late");
        uint256 ind = agent.availableAgentsPos - 1;
        if (ind + 1 < state.availableAgents.length) {
            state.availableAgents[ind] = state.availableAgents[state.availableAgents.length - 1];
            Agent.State storage movedAgent = Agent.get(state.availableAgents[ind]);
            movedAgent.availableAgentsPos = uint32(ind + 1);
        }
        agent.availableAgentsPos = 0;
        state.availableAgents.pop();
        agent.exitAvailableAfterTs = 0;
        emit AMEvents.AvailableAgentExited(_agentVault);
    }

    function getList(
        uint256 _start,
        uint256 _end
    )
        external view
        returns (address[] memory _agents, uint256 _totalLength)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _totalLength = state.availableAgents.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _agents = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _agents[i - _start] = state.availableAgents[i];
        }
    }

    function getListWithInfo(
        uint256 _start,
        uint256 _end
    )
        external view
        returns (AvailableAgentInfo.Data[] memory _agents, uint256 _totalLength)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _totalLength = state.availableAgents.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _agents = new AvailableAgentInfo.Data[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            address agentVault = state.availableAgents[i];
            Agent.State storage agent = Agent.getWithoutCheck(agentVault);
            Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
            (uint256 agentCR,) = AgentCollateral.mintingMinCollateralRatio(agent, Collateral.Kind.VAULT);
            (uint256 poolCR,) = AgentCollateral.mintingMinCollateralRatio(agent, Collateral.Kind.POOL);
            _agents[i - _start] = AvailableAgentInfo.Data({
                agentVault: agentVault,
                feeBIPS: agent.feeBIPS,
                mintingVaultCollateralRatioBIPS: agentCR,
                mintingPoolCollateralRatioBIPS: poolCR,
                freeCollateralLots: collateralData.freeCollateralLots(agent)
            });
        }
    }
}
