import { time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../lib/fasset/AssetManagerTypes";
import { findEvent } from "../../../lib/utils/events/truffle";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance } from "../../../typechain-truffle";
import { GovernanceCallTimelocked } from "../../../typechain-truffle/AssetManagerController";

export async function newAssetManager(
    governanceAddress: string,
    assetManagerController: string | AssetManagerControllerInstance,
    name: string,
    symbol: string,
    decimals: number,
    assetManagerSettings: AssetManagerSettings,
    collateralTokens: CollateralToken[],
    encodedLiquidationStrategySettings: string,
    updateExecutor: string = governanceAddress
): Promise<[AssetManagerInstance, FAssetInstance]> {
    const AssetManager = await linkAssetManager();
    const FAsset = artifacts.require('FAsset');
    const fAsset = await FAsset.new(governanceAddress, name, symbol, decimals);
    const assetManagerControllerAddress = typeof assetManagerController === 'string' ? assetManagerController : assetManagerController.address;
    assetManagerSettings = web3DeepNormalize({
        ...assetManagerSettings,
        assetManagerController: assetManagerControllerAddress,
        fAsset: fAsset.address
    });
    collateralTokens = web3DeepNormalize(collateralTokens);
    const assetManager = await AssetManager.new(assetManagerSettings, collateralTokens, encodedLiquidationStrategySettings);
    if (typeof assetManagerController !== 'string') {
        const res = await assetManagerController.addAssetManager(assetManager.address, { from: governanceAddress });
        await waitForTimelock(res, assetManagerController, updateExecutor);
    } else {
        // simulate attaching to asset manager controller (for unit tests, where controller is an eoa address)
        await assetManager.attachController(true, { from: assetManagerController });
    }
    await fAsset.setAssetManager(assetManager.address, { from: governanceAddress });
    return [assetManager, fAsset];
}

// simulate waiting for governance timelock
export async function waitForTimelock<C extends Truffle.ContractInstance>(response: Truffle.TransactionResponse<any> | Promise<Truffle.TransactionResponse<any>>, contract: C, executorAddress: string) {
    const res = await response as Truffle.TransactionResponse<GovernanceCallTimelocked>;
    const timelockEvent = findEvent(res, 'GovernanceCallTimelocked');
    if (timelockEvent) {
        const timelock = timelockEvent.args;
        await time.increaseTo(Number(timelock.allowedAfterTimestamp) + 1);
        return await (contract as any).executeGovernanceCall(timelock.selector, { from: executorAddress });
    }
}

export async function linkAssetManager() {
    // deploy all libraries
    const SettingsUpdater = await deployLibrary('SettingsUpdater');
    const StateUpdater = await deployLibrary('StateUpdater');
    const CollateralTokens = await deployLibrary('CollateralTokens');
    const AgentsExternal = await deployLibrary('AgentsExternal');
    const AgentsCreateDestroy = await deployLibrary('AgentsCreateDestroy');
    const AgentSettingsUpdater = await deployLibrary('AgentSettingsUpdater');
    const AvailableAgents = await deployLibrary('AvailableAgents');
    const CollateralReservations = await deployLibrary('CollateralReservations');
    const Liquidation = await deployLibrary('Liquidation');
    const Minting = await deployLibrary('Minting');
    const UnderlyingBalance = await deployLibrary('UnderlyingBalance');
    const RedemptionRequests = await deployLibrary('RedemptionRequests');
    const RedemptionConfirmations = await deployLibrary('RedemptionConfirmations');
    const RedemptionFailures = await deployLibrary('RedemptionFailures');
    const UnderlyingWithdrawalAnnouncements = await deployLibrary('UnderlyingWithdrawalAnnouncements');
    const Challenges = await deployLibrary('Challenges');
    const FullAgentInfo = await deployLibrary('FullAgentInfo');
    // link AssetManagerContract
    return linkDependencies(artifacts.require('AssetManager'), {
        SettingsUpdater, StateUpdater, CollateralTokens, AgentsExternal, AgentsCreateDestroy, AgentSettingsUpdater, AvailableAgents, CollateralReservations, Liquidation, Minting,
        UnderlyingBalance, RedemptionRequests, RedemptionConfirmations, RedemptionFailures, UnderlyingWithdrawalAnnouncements, Challenges, FullAgentInfo
    });
}

export function deployLibrary(name: string, dependencies: { [key: string]: Truffle.ContractInstance } = {}): Promise<Truffle.ContractInstance> {
    // libraries don't have typechain info generated, so we have to import as 'any' (but it's no problem, since we only use them for linking)
    return linkDependencies(artifacts.require(name as any), dependencies).new();
}

export function linkDependencies<T extends Truffle.Contract<any>>(contract: T, dependencies: { [key: string]: Truffle.ContractInstance } = {}): T {
    // for some strange reason, the only way to call `link` that is supported by Hardhat, doesn't have type info by typechain
    // so the interface of this method assumes that maybe we will need linking by name in the future (that's why it accepts dictionary)
    for (const dependencyName of Object.keys(dependencies)) {
        contract.link(dependencies[dependencyName] as any);
    }
    return contract;
}
