import { time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralType } from "../../../lib/fasset/AssetManagerTypes";
import { findEvent } from "../../../lib/utils/events/truffle";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { AssetManagerControllerInstance, IIAssetManagerInstance, FAssetInstance, GovernanceSettingsInstance, AssetManagerInitInstance } from "../../../typechain-truffle";
import { GovernanceCallTimelocked } from "../../../typechain-truffle/AssetManagerController";
import { DiamondCut, FacetCutAction } from "../diamond";

const IIAssetManager = artifacts.require('IIAssetManager');
const AssetManager = artifacts.require('AssetManager');
const AssetManagerInit = artifacts.require('AssetManagerInit');
const FAsset = artifacts.require('FAsset');

export async function newAssetManager(
    governanceAddress: string,
    assetManagerController: string | AssetManagerControllerInstance,
    name: string,
    symbol: string,
    decimals: number,
    assetManagerSettings: AssetManagerSettings,
    collateralTokens: CollateralType[],
    encodedLiquidationStrategySettings: string,
    assetName = name,
    assetSymbol = symbol,
    options?: {
        governanceSettings?: string | GovernanceSettingsInstance,
        updateExecutor?: string,
    }
): Promise<[IIAssetManagerInstance, FAssetInstance]> {
    // 0x8... is not a contract, but it is valid non-zero address so it will work in tests where we don't switch to production mode
    const governanceSettings = options?.governanceSettings ?? "0x8000000000000000000000000000000000000000";
    const updateExecutor = options?.updateExecutor ?? governanceAddress;
    const diamondCuts = await deployAssetManagerFacets();
    const assetManagerInit = await AssetManagerInit.new();
    const fAsset = await FAsset.new(governanceAddress, name, symbol, assetName, assetSymbol, decimals);
    const assetManagerControllerAddress = typeof assetManagerController === 'string' ? assetManagerController : assetManagerController.address;
    assetManagerSettings = web3DeepNormalize({
        ...assetManagerSettings,
        assetManagerController: assetManagerControllerAddress,
        fAsset: fAsset.address
    });
    collateralTokens = web3DeepNormalize(collateralTokens);
    const assetManager = await newAssetManagerDiamond(diamondCuts, assetManagerInit, governanceSettings, governanceAddress, assetManagerSettings, collateralTokens, encodedLiquidationStrategySettings);
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

export async function newAssetManagerDiamond(diamondCuts: DiamondCut[], assetManagerInit: AssetManagerInitInstance, governanceSettings: string | GovernanceSettingsInstance,
    governanceAddress: string, assetManagerSettings: AssetManagerSettings, collateralTokens: CollateralType[], encodedLiquidationStrategySettings: string)
{
    const governanceSettingsAddress = typeof governanceSettings === 'string' ? governanceSettings : governanceSettings.address;
    const initParameters = abiEncodeCall(assetManagerInit,
        c => c.init(governanceSettingsAddress, governanceAddress, assetManagerSettings, collateralTokens, encodedLiquidationStrategySettings));
    const assetManagerDiamond = await AssetManager.new(diamondCuts, assetManagerInit.address, initParameters);
    return await IIAssetManager.at(assetManagerDiamond.address);
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

export async function deployAssetManagerFacets() {
    return [
        await deployFacet('DiamondCutFacet', ['IDiamondCut']),
        await deployFacet('DiamondLoupeFacet', ['IDiamondLoupe', '@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165']),
        await deployFacet('AgentInfoFacet', ['IAgentInfo']),
        await deployFacet('AvailableAgentsFacet', ['IAvailableAgents']),
        await deployFacet('MintingFacet', ['IMinting']),
        await deployFacet('RedemptionRequestsFacet', ['IRedemptionRequests', 'IPoolSelfCloseRedemption']),
        await deployFacet('RedemptionConfirmationsFacet', ['IRedemptionConfirmations']),
        await deployFacet('RedemptionDefaultsFacet', ['IRedemptionDefaults']),
        await deployFacet('LiquidationFacet', ['ILiquidation']),
        await deployFacet('ChallengesFacet', ['IChallenges']),
        await deployFacet('UnderlyingBalanceFacet', ['IUnderlyingBalance']),
        await deployFacet('UnderlyingTimekeepingFacet', ['IUnderlyingTimekeeping']),
        await deployFacet('AgentVaultManagementFacet', ['IAgentVaultManagement']),
        await deployFacet('AgentSettingsFacet', ['IAgentSettings']),
        await deployFacet('CollateralTypesFacet', ['ICollateralTypes', 'ICollateralTypesManagement']),
        await deployFacet('AgentCollateralFacet', ['IAgentCollateral', 'IAgentVaultCollateralHooks']),
        await deployFacet('SettingsReaderFacet', ['IAssetManagerSettings']),
        await deployFacet('SettingsManagementFacet', ['ISettingsManagement']),
        await deployFacet('AgentVaultAndPoolSupportFacet', ['IAgentVaultAndPoolSupport']),
        await deployFacet('SystemStateManagementFacet', ['ISystemStateManagement']),
    ];
}

export async function deployFacet(facetName: string, interfaceNames: string[]): Promise<DiamondCut> {
    const contract = artifacts.require(facetName as any) as Truffle.ContractNew<any>;
    const instance = await contract.new() as Truffle.ContractInstance;
    const instanceSelectors = new Set(instance.abi.map(it => web3.eth.abi.encodeFunctionSignature(it)));
    const exposedSelectors = new Set<string>();
    for (const interfaceName of interfaceNames) {
        const interfaceContract = artifacts.require(interfaceName as any) as Truffle.Contract<any>;
        const interfaceInstance = await interfaceContract.at(instance.address) as Truffle.ContractInstance;
        for (const item of interfaceInstance.abi) {
            const selector = web3.eth.abi.encodeFunctionSignature(item);
            if (!instanceSelectors.has(selector)) {
                throw new Error(`Undefined method ${interfaceName}.${item.name} in ${facetName}`);
            }
            exposedSelectors.add(selector);
        }
    }
    return {
        action: FacetCutAction.Add,
        facetAddress: instance.address,
        functionSelectors: [...exposedSelectors]
    };
}

export function abiEncodeCall<I extends Truffle.ContractInstance>(instance: I, call: (inst: I) => any) {
    return call(instance.contract.methods).encodeABI();
}
