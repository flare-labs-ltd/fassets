import { DiamondCut, DiamondSelectors, FacetCutAction } from '../../../lib/utils/diamond';

export async function deployDiamond(governanceSettingsAddress: string, initialGovernance: string) {
    // Deploy DiamondInit
    // DiamondInit provides a function that is called when the diamond is upgraded or deployed to initialize state variables
    // Read about how the diamondCut function works in the EIP2535 Diamonds standard
    const DiamondInit = artifacts.require("DiamondInit");
    const diamondInit = await DiamondInit.new();
    console.log('DiamondInit deployed:', diamondInit.address);

    // Deploy facets and set the `facetCuts` variable
    console.log('');
    console.log('Deploying facets');
    const facetTypes = [
        artifacts.require('DiamondCutFacet'),
        artifacts.require('DiamondLoupeFacet'),
    ] as const;

    // The `facetCuts` variable is the FacetCut[] that contains the functions to add during diamond deployment
    const facetCuts: DiamondCut[] = [];
    for (const facetType of facetTypes) {
        const facet = await facetType.new();
        console.log(`${facetType.contractName} deployed: ${facet.address}`);
        facetCuts.push({
            facetAddress: facet.address,
            action: FacetCutAction.Add,
            functionSelectors: DiamondSelectors.fromABI(facet).selectors
        });
    }

    // Creating a function call
    // This call gets executed during deployment and can also be executed in upgrades
    // It is executed with delegatecall on the DiamondInit address.
    let initFunctionCall = diamondInit.contract.methods.init(governanceSettingsAddress, initialGovernance).encodeABI();

    // deploy Diamond
    const Diamond = artifacts.require("MockDiamond");
    const diamond = await Diamond.new(facetCuts, diamondInit.address, initFunctionCall);
    console.log();
    console.log('Diamond deployed:', diamond.address);

    // returning the address of the diamond
    return [diamond.address, facetCuts.map(fc => fc.facetAddress)] as const;
}
