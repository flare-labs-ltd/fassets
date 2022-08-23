import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Artifact, HardhatRuntimeEnvironment } from 'hardhat/types';
import { AssetManagerParameters } from './asset-manager-parameters';

export async function deployAssetManager(hre: HardhatRuntimeEnvironment, parameters: AssetManagerParameters) {
    const web3 = hre.web3;

    const accounts = await web3.eth.getAccounts();
    
    
}
