import { existsSync } from 'fs';
import { Artifact, HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract, loadContractsList, saveContractsList } from './contracts';
import { readDeployedCode } from './deploy-utils';

export async function linkContracts(hre: HardhatRuntimeEnvironment, contracts: string[], mapfile: string | null) {
    const web3 = hre.web3;

    const accounts = await web3.eth.getAccounts();

    const deployedLibs: Map<string, string> = new Map();
    const existingDeployedLibs: Map<string, string> = new Map();

    if (mapfile && existsSync(mapfile)) {
        const contractsList = loadContractsList(mapfile);
        contractsList.forEach(c => existingDeployedLibs.set(`${c.contractName}:${c.name}`, c.address));
    }

    function getDependencies(contract: Artifact): Set<string> {
        const dependencies = new Set<string>();
        for (const libraryFileName of Object.keys(contract.linkReferences)) {
            for (const libraryName of Object.keys(contract.linkReferences[libraryFileName])) {
                dependencies.add(`${libraryFileName}:${libraryName}`);
            }
        }
        return dependencies;
    }

    function overrideTemplate() {
        const defaults = hre.config.solidity.compilers[0];
        return {
            version: defaults.version,
            settings: { ...defaults.settings, libraries: {} }
        };
    };

    console.log(`Initial clean recompilation...`);
    await hre.run("compile", { force: true });

    for (let loop = 1; ; loop++) {
        const contractInfos = new Map<string, { artifact: Artifact, dependencies: Set<string>, toplevel: boolean }>();

        function addAllDependencies(name: string, toplevel: boolean) {
            if (contractInfos.has(name)) return;
            const artifact = hre.artifacts.readArtifactSync(name);
            const dependencies = getDependencies(artifact);
            contractInfos.set(name, { artifact, dependencies, toplevel });
            for (const lib of dependencies) {
                addAllDependencies(lib, false);
            }
        }

        // add dependencies for all top level contracts
        for (const contractName of contracts) {
            addAllDependencies(contractName, true);
        }

        // deploy all undeployed libs without dependencies
        for (const [name, info] of contractInfos) {
            if (info.toplevel) continue;                // not a dependency - no need to deploy
            if (info.dependencies.size > 0) continue;   // has undeployed dependencies itself
            const existingAddress = deployedLibs.get(name) ?? existingDeployedLibs.get(name);
            const existingDeployedCode = await readDeployedCode(existingAddress);
            if (existingAddress && existingDeployedCode && existingDeployedCode === info.artifact.deployedBytecode) {
                console.log(`  using ${info.artifact.contractName} at ${existingAddress}`);
                deployedLibs.set(name, existingAddress);
            } else {
                const contract = new web3.eth.Contract(info.artifact.abi);
                const instance = await contract.deploy({ data: info.artifact.bytecode }).send({ from: accounts[0] });
                console.log(`  deployed ${info.artifact.contractName} at ${instance.options.address}`);
                deployedLibs.set(name, instance.options.address);
            }
        }

        // add config for all libraries/contracts with only deployed dependencies
        let contractsWithUndeployedDependencies = 0;
        let contractsToRecompile = 0;
        for (const info of contractInfos.values()) {
            if (info.dependencies.size === 0) continue;   // no dependencies, don't need recompilation
            const allDependenciesDeployed = Array.from(info.dependencies).every(lib => deployedLibs.has(lib));
            if (!allDependenciesDeployed) { // has undeployed dependencies
                contractsWithUndeployedDependencies++;
                continue;
            }
            const overrides = overrideTemplate();
            for (const lib of info.dependencies) {
                const libInfo = contractInfos.get(lib)!;
                overrides.settings.libraries[libInfo.artifact.sourceName] = {
                    [libInfo.artifact.contractName]: deployedLibs.get(lib)!
                };
            }
            hre.config.solidity.overrides[info.artifact.sourceName] = overrides;
            contractsToRecompile++;
        }

        if (contractsToRecompile > 0) {
            console.log(`Recompilation run ${loop}...`);
            await hre.run("compile", { force: true });
        }

        // loop until there are no new undelplyed libraries
        if (contractsWithUndeployedDependencies === 0) break;
    }

    if (mapfile) {
        const contractsList: Contract[] = Array.from(deployedLibs.entries()).map(([key, address]) => {
            const [contractName, name] = key.split(':');
            return { name, contractName, address };
        });
        saveContractsList(mapfile, contractsList);
    }
}
