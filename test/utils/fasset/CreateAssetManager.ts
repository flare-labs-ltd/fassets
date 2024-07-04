import { time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralType } from "../../../lib/fasset/AssetManagerTypes";
import { findEvent } from "../../../lib/utils/events/truffle";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { AssetManagerControllerInstance, IIAssetManagerInstance, FAssetInstance, GovernanceSettingsInstance, AssetManagerInitInstance } from "../../../typechain-truffle";
import { GovernanceCallTimelocked } from "../../../typechain-truffle/AssetManagerController";
import { DiamondCut, FacetCutAction } from "../../../lib/utils/diamond";
import { abiEncodeCall } from "../../../lib/utils/helpers";

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
    const [diamondCuts, assetManagerInit] = await deployAssetManagerFacets();
    const fAsset = await FAsset.new(governanceAddress, name, symbol, assetName, assetSymbol, decimals);
    const assetManagerControllerAddress = typeof assetManagerController === 'string' ? assetManagerController : assetManagerController.address;
    assetManagerSettings = web3DeepNormalize({
        ...assetManagerSettings,
        assetManagerController: assetManagerControllerAddress,
        fAsset: fAsset.address
    });
    collateralTokens = web3DeepNormalize(collateralTokens);
    const assetManager = await newAssetManagerDiamond(diamondCuts, assetManagerInit, governanceSettings, governanceAddress, assetManagerSettings, collateralTokens);
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
    governanceAddress: string, assetManagerSettings: AssetManagerSettings, collateralTokens: CollateralType[])
{
    const governanceSettingsAddress = typeof governanceSettings === 'string' ? governanceSettings : governanceSettings.address;
    const initParameters = abiEncodeCall(assetManagerInit,
        c => c.init(governanceSettingsAddress, governanceAddress, assetManagerSettings, collateralTokens));
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
        return await (contract as any).executeGovernanceCall(timelock.encodedCall, { from: executorAddress });
    }
}

export async function deployAssetManagerFacets(): Promise<[DiamondCut[], AssetManagerInitInstance]> {
    const assetManagerInit = await AssetManagerInit.new();
    // create filters
    const iiAssetManager = await IIAssetManager.at(assetManagerInit.address);
    const interfaceSelectorMap = new Map(iiAssetManager.abi
        .filter(it => it.type === 'function')
        .map(it => [web3.eth.abi.encodeFunctionSignature(it), it]));
    const interfaceSelectors = new Set(interfaceSelectorMap.keys());
    // create cuts
    const diamondCuts = [
        await deployFacet('AssetManagerDiamondCutFacet', interfaceSelectors),
        await deployFacet('DiamondLoupeFacet', interfaceSelectors),
        await deployFacet('AgentInfoFacet', interfaceSelectors),
        await deployFacet('AvailableAgentsFacet', interfaceSelectors),
        await deployFacet('MintingFacet', interfaceSelectors),
        await deployFacet('RedemptionRequestsFacet', interfaceSelectors),
        await deployFacet('RedemptionConfirmationsFacet', interfaceSelectors),
        await deployFacet('RedemptionDefaultsFacet', interfaceSelectors),
        await deployFacet('LiquidationFacet', interfaceSelectors),
        await deployFacet('ChallengesFacet', interfaceSelectors),
        await deployFacet('UnderlyingBalanceFacet', interfaceSelectors),
        await deployFacet('UnderlyingTimekeepingFacet', interfaceSelectors),
        await deployFacet('AgentVaultManagementFacet', interfaceSelectors),
        await deployFacet('AgentSettingsFacet', interfaceSelectors),
        await deployFacet('CollateralTypesFacet', interfaceSelectors),
        await deployFacet('AgentCollateralFacet', interfaceSelectors),
        await deployFacet('SettingsReaderFacet', interfaceSelectors),
        await deployFacet('SettingsManagementFacet', interfaceSelectors),
        await deployFacet('AgentVaultAndPoolSupportFacet', interfaceSelectors),
        await deployFacet('SystemStateManagementFacet', interfaceSelectors),
        await deployFacet('AgentPingFacet', interfaceSelectors),
    ];
    // verify every required selector is included in some cut
    for (const cut of diamondCuts) {
        for (const selector of cut.functionSelectors) {
            interfaceSelectors.delete(selector);
        }
    }
    if (interfaceSelectors.size > 0) {
        const missing = Array.from(interfaceSelectors).map(sel => interfaceSelectorMap.get(sel)?.name);
        throw new Error(`Deployed facets are missing methods ${missing.join(", ")}`);
    }
    return [diamondCuts, assetManagerInit];
}

export async function deployFacet(facetName: string, filterSelectors: Set<string>): Promise<DiamondCut> {
    const contract = artifacts.require(facetName as any) as Truffle.ContractNew<any>;
    const instance = await contract.new() as Truffle.ContractInstance;
    const instanceSelectors = instance.abi.map(it => web3.eth.abi.encodeFunctionSignature(it));
    const exposedSelectors = instanceSelectors.filter(sel => filterSelectors.has(sel));
    if (exposedSelectors.length === 0) {
        throw new Error(`No exposed methods in ${facetName}`);
    }
    return {
        action: FacetCutAction.Add,
        facetAddress: instance.address,
        functionSelectors: [...exposedSelectors]
    };
}
