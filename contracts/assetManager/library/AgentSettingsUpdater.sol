// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";


library AgentSettingsUpdater {
    using SafeCast for uint256;

    bytes32 internal constant FEE_BIPS = keccak256("feeBIPS");
    bytes32 internal constant POOL_FEE_SHARE_BIPS = keccak256("poolFeeShareBIPS");
    bytes32 internal constant MINTING_VAULT_COLLATERAL_RATIO_BIPS = keccak256("mintingVaultCollateralRatioBIPS");
    bytes32 internal constant MINTING_POOL_COLLATERAL_RATIO_BIPS = keccak256("mintingPoolCollateralRatioBIPS");
    bytes32 internal constant BUY_FASSET_BY_AGENT_FACTOR_BIPS = keccak256("buyFAssetByAgentFactorBIPS");
    bytes32 internal constant POOL_EXIT_COLLATERAL_RATIO_BIPS = keccak256("poolExitCollateralRatioBIPS");
    bytes32 internal constant POOL_TOPUP_COLLATERAL_RATIO_BIPS = keccak256("poolTopupCollateralRatioBIPS");
    bytes32 internal constant POOL_TOPUP_TOKEN_PRICE_FACTOR_BIPS = keccak256("poolTopupTokenPriceFactorBIPS");
    bytes32 internal constant HAND_SHAKE_TYPE = keccak256("handShakeType");

    function announceUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    )
        internal
        returns (uint256)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        bytes32 hash = _getAndCheckHash(_name);
        uint256 validAt = block.timestamp + _getTimelock(hash);
        agent.settingUpdates[hash] = Agent.SettingUpdate({
            value: _value.toUint128(),
            validAt: validAt.toUint64()
        });
        emit AMEvents.AgentSettingChangeAnnounced(_agentVault, _name, _value, validAt);
        return validAt;
    }

    function executeUpdate(
        address _agentVault,
        string memory _name
    )
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        bytes32 hash = _getAndCheckHash(_name);
        Agent.SettingUpdate storage update = agent.settingUpdates[hash];
        require(update.validAt != 0, "no pending update");
        require(update.validAt <= block.timestamp, "update not valid yet");
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        require(update.validAt + settings.agentTimelockedOperationWindowSeconds >= block.timestamp,
            "update not valid anymore");
        _executeUpdate(agent, hash, update.value);
        emit AMEvents.AgentSettingChanged(_agentVault, _name, update.value);
        delete agent.settingUpdates[hash];
    }

    function clearPendingUpdates(
        Agent.State storage _agent
    )
        internal
    {
        delete _agent.settingUpdates[FEE_BIPS];
        delete _agent.settingUpdates[POOL_FEE_SHARE_BIPS];
        delete _agent.settingUpdates[MINTING_VAULT_COLLATERAL_RATIO_BIPS];
        delete _agent.settingUpdates[MINTING_POOL_COLLATERAL_RATIO_BIPS];
        delete _agent.settingUpdates[BUY_FASSET_BY_AGENT_FACTOR_BIPS];
        delete _agent.settingUpdates[POOL_EXIT_COLLATERAL_RATIO_BIPS];
        delete _agent.settingUpdates[POOL_TOPUP_COLLATERAL_RATIO_BIPS];
        delete _agent.settingUpdates[POOL_TOPUP_TOKEN_PRICE_FACTOR_BIPS];
        delete _agent.settingUpdates[HAND_SHAKE_TYPE];
    }

    function _executeUpdate(
        Agent.State storage _agent,
        bytes32 _hash,
        uint256 _value
    )
        private
    {
        if (_hash == FEE_BIPS) {
            Agents.setFeeBIPS(_agent, _value);
        } else if (_hash == POOL_FEE_SHARE_BIPS) {
            Agents.setPoolFeeShareBIPS(_agent, _value);
        } else if (_hash == MINTING_VAULT_COLLATERAL_RATIO_BIPS) {
            Agents.setMintingVaultCollateralRatioBIPS(_agent, _value);
        } else if (_hash == MINTING_POOL_COLLATERAL_RATIO_BIPS) {
            Agents.setMintingPoolCollateralRatioBIPS(_agent, _value);
        } else if (_hash == BUY_FASSET_BY_AGENT_FACTOR_BIPS) {
            Agents.setBuyFAssetByAgentFactorBIPS(_agent, _value);
        } else if (_hash == POOL_EXIT_COLLATERAL_RATIO_BIPS) {
            Agents.setPoolExitCollateralRatioBIPS(_agent, _value);
        } else if (_hash == POOL_TOPUP_COLLATERAL_RATIO_BIPS) {
            Agents.setPoolTopupCollateralRatioBIPS(_agent, _value);
        } else if (_hash == POOL_TOPUP_TOKEN_PRICE_FACTOR_BIPS) {
            Agents.setPoolTopupTokenPriceFactorBIPS(_agent, _value);
        } else if (_hash == HAND_SHAKE_TYPE) {
            Agents.setHandShakeType(_agent, _value);
        } else {
            assert(false);
        }
    }

    function _getTimelock(bytes32 _hash) private view returns (uint64) {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        if (_hash == FEE_BIPS || _hash == POOL_FEE_SHARE_BIPS ||
            _hash == BUY_FASSET_BY_AGENT_FACTOR_BIPS || _hash == HAND_SHAKE_TYPE) {
            return settings.agentFeeChangeTimelockSeconds;
        } else if (_hash == MINTING_VAULT_COLLATERAL_RATIO_BIPS || _hash == MINTING_POOL_COLLATERAL_RATIO_BIPS) {
            return settings.agentMintingCRChangeTimelockSeconds;
        } else {
            return settings.poolExitAndTopupChangeTimelockSeconds;
        }
    }

    function _getAndCheckHash(string memory _name) private pure returns (bytes32) {
        bytes32 hash = keccak256(bytes(_name));
        bool settingNameValid =
            hash == FEE_BIPS ||
            hash == POOL_FEE_SHARE_BIPS ||
            hash == MINTING_VAULT_COLLATERAL_RATIO_BIPS ||
            hash == MINTING_POOL_COLLATERAL_RATIO_BIPS ||
            hash == BUY_FASSET_BY_AGENT_FACTOR_BIPS ||
            hash == POOL_EXIT_COLLATERAL_RATIO_BIPS ||
            hash == POOL_TOPUP_COLLATERAL_RATIO_BIPS ||
            hash == POOL_TOPUP_TOKEN_PRICE_FACTOR_BIPS ||
            hash == HAND_SHAKE_TYPE;
        require(settingNameValid, "invalid setting name");
        return hash;
    }
}
