import { expectRevert } from '@openzeppelin/test-helpers';
import { DiamondCutFacetInstance, DiamondLoupeFacetInstance } from '../../../typechain-truffle';
import { DiamondCut, DiamondSelectors, FacetCutAction } from '../../../lib/utils/diamond';
import { TestSettingsContracts, createTestContracts } from '../../utils/test-settings';
import { deployDiamond } from './deploy';
import { loadFixtureCopyVars } from '../../utils/test-helpers';
import { ZERO_ADDRESS, requireNotNull } from '../../../lib/utils/helpers';

const DiamondCutFacet = artifacts.require('DiamondCutFacet');
const MockDiamond = artifacts.require('MockDiamond');
const DiamondLoupeFacet = artifacts.require('DiamondLoupeFacet');
const Test1Facet = artifacts.require('Test1Facet');
const Test2Facet = artifacts.require('Test2Facet');

contract('DiamondTest', async function (accounts) {
    let governance = accounts[0];
    let contracts: TestSettingsContracts;
    let diamondAddress: string;
    let diamondCutFacet: DiamondCutFacetInstance;
    let diamondLoupeFacet: DiamondLoupeFacetInstance;
    let diamondCutAddr: string;
    let diamondLoupeAddr: string;

    async function initialize() {
        contracts = await createTestContracts(governance);
        [diamondAddress, [diamondCutAddr, diamondLoupeAddr]] = await deployDiamond(contracts.governanceSettings.address, governance);
        diamondCutFacet = await DiamondCutFacet.at(diamondAddress);
        diamondLoupeFacet = await DiamondLoupeFacet.at(diamondAddress);
        return { contracts, diamondAddress, diamondCutAddr, diamondLoupeAddr, diamondCutFacet, diamondLoupeFacet };
    }

    beforeEach(async function () {
        ({ contracts, diamondAddress, diamondCutAddr, diamondLoupeAddr, diamondCutFacet, diamondLoupeFacet } = await loadFixtureCopyVars(initialize));
    });

    it('should have two facets -- call to facetAddresses function', async () => {
        const addresses: string[] = [];
        for (const address of await diamondLoupeFacet.facetAddresses()) {
            addresses.push(address);
        }
        assert.equal(addresses.length, 2);
    });

    it('facets should have the right function selectors.selectors -- call to facetFunctionSelectors function', async () => {
        let selectors = DiamondSelectors.fromABI(diamondCutFacet);
        let result = await diamondLoupeFacet.facetFunctionSelectors(diamondCutAddr);
        assert.sameMembers(result, selectors.selectors);
        selectors = DiamondSelectors.fromABI(diamondLoupeFacet);
        result = await diamondLoupeFacet.facetFunctionSelectors(diamondLoupeAddr);
        assert.sameMembers(result, selectors.selectors);
        // selectors = DiamondSelectors.getSelectors(ownershipFacet)
        // result = await diamondLoupeFacet.facetFunctionSelectors(test1FacetCode.address)
        // assert.sameMembers(result, selectors.selectors.selectors)
    });

    it('selectors.selectors should be associated to facets correctly -- multiple calls to facetAddress function', async () => {
        assert.equal(
            diamondCutAddr,
            await diamondLoupeFacet.facetAddress('0x1f931c1c')
        );
        assert.equal(
            diamondLoupeAddr,
            await diamondLoupeFacet.facetAddress('0xcdffacc6')
        );
        assert.equal(
            diamondLoupeAddr,
            await diamondLoupeFacet.facetAddress('0x01ffc9a7')
        );
    });

    async function createTest1Facet() {
        const test1FacetCode = await Test1Facet.new();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(['supportsInterface(bytes4)']);
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: test1FacetCode.address,
                action: FacetCutAction.Add,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        return test1FacetCode;
    }

    it('should add test1 functions', async () => {
        const test1FacetCode = await createTest1Facet();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(['supportsInterface(bytes4)']);
        let result = await diamondLoupeFacet.facetFunctionSelectors(test1FacetCode.address);
        assert.sameMembers(result, selectors.selectors);
    });

    it('should test function call', async () => {
        await createTest1Facet();
        const test1Facet = await Test1Facet.at(diamondAddress);
        await test1Facet.test1Func10();
    });

    it('should replace supportsInterface function', async () => {
        const test1FacetCode = await createTest1Facet();
        const test1Facet = await Test1Facet.at(diamondCutAddr);
        const selectors = DiamondSelectors.fromABI(test1Facet).restrict(['supportsInterface(bytes4)']);
        const testFacetAddress = test1FacetCode.address;
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: testFacetAddress,
                action: FacetCutAction.Replace,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        let result = await diamondLoupeFacet.facetFunctionSelectors(testFacetAddress);
        assert.sameMembers(result, DiamondSelectors.fromABI(test1Facet).selectors);
    });

    async function createTest2Facet() {
        const test2FacetCode = await Test2Facet.new();
        const selectors = DiamondSelectors.fromABI(test2FacetCode).remove(['supportsInterface(bytes4)']);
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: test2FacetCode.address,
                action: FacetCutAction.Add,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        return test2FacetCode;
    }

    it('should add test2 functions', async () => {
        const test2FacetCode = await createTest2Facet();
        const selectors = DiamondSelectors.fromABI(test2FacetCode);
        let result = await diamondLoupeFacet.facetFunctionSelectors(test2FacetCode.address);
        assert.sameMembers(result, selectors.selectors);
    });

    it('should remove some test2 functions', async () => {
        const test1FacetCode = await createTest1Facet();
        const test2FacetCode = await createTest2Facet();
        const test2Facet = await Test2Facet.at(diamondAddress);
        const functionsToKeep = ['test2Func1()', 'test2Func5()', 'test2Func6()', 'test2Func19()', 'test2Func20()'];
        const selectors = DiamondSelectors.fromABI(test2Facet).remove(functionsToKeep);
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        let result = await diamondLoupeFacet.facetFunctionSelectors(test2FacetCode.address);
        assert.sameMembers(result, DiamondSelectors.fromABI(test2Facet).restrict(functionsToKeep).selectors);
    });

    it('should remove some test1 functions', async () => {
        const test1FacetCode = await createTest1Facet();
        const test2FacetCode = await createTest2Facet();
        const test1Facet = await Test1Facet.at(diamondAddress);
        const functionsToKeep = ['test1Func2()', 'test1Func11()', 'test1Func12()'];
        const selectors = DiamondSelectors.fromABI(test1Facet).remove(functionsToKeep);
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        let result = await diamondLoupeFacet.facetFunctionSelectors(test1FacetCode.address);
        assert.sameMembers(result, DiamondSelectors.fromABI(test1Facet).restrict(functionsToKeep).selectors);
    });

    async function removeMostFunctionsAndFacets() {
        let selectors = await DiamondSelectors.fromLoupe(diamondLoupeFacet);
        selectors = selectors.remove(['facets()', 'diamondCut((address,uint8,bytes4[])[],address,bytes)']);
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
    }

    it('remove all functions and facets except \'diamondCut\' and \'facets\'', async () => {
        const test1FacetCode = await createTest1Facet();
        const test2FacetCode = await createTest2Facet();
        await removeMostFunctionsAndFacets();
        // check
        let facets = await diamondLoupeFacet.facets();
        assert.equal(facets.length, 2);
        const cutFacet = facets.find(f => f.facetAddress === diamondCutAddr);
        assert.isDefined(cutFacet);
        const loupeFacet = facets.find(f => f.facetAddress === diamondLoupeAddr);
        assert.isDefined(loupeFacet);
        assert.equal(cutFacet!.facetAddress, diamondCutAddr);
        assert.sameMembers(cutFacet!.functionSelectors, ['0x1f931c1c']);
        assert.equal(loupeFacet!.facetAddress, diamondLoupeAddr);
        assert.sameMembers(loupeFacet!.functionSelectors, ['0x7a0ed627']);
    });

    it('re-add most functions and facets', async () => {
        // prepare
        const test1FacetCode = await createTest1Facet();
        const test2FacetCode = await createTest2Facet();
        // remove
        await removeMostFunctionsAndFacets();
        const facets1 = await diamondLoupeFacet.facets();
        assert.equal(facets1.length, 2);
        assert.equal(facets1[0].functionSelectors.length, 1);
        assert.equal(facets1[1].functionSelectors.length, 1);
        // add
        const diamondLoupeFacetSelectors = DiamondSelectors.fromABI(diamondLoupeFacet).remove(['supportsInterface(bytes4)']);
        const test1FacetInt = await Test1Facet.at(diamondCutAddr);
        const test2FacetInt = await Test2Facet.at(diamondCutAddr);
        // Any number of functions from any number of facets can be added/replaced/removed in a
        // single transaction
        const cut: DiamondCut[] = [
            {
                facetAddress: diamondLoupeAddr,
                action: FacetCutAction.Add,
                functionSelectors: diamondLoupeFacetSelectors.remove(['facets()']).selectors
            },
            {
                facetAddress: test1FacetCode.address,
                action: FacetCutAction.Add,
                functionSelectors: DiamondSelectors.fromABI(test1FacetInt).selectors
            },
            {
                facetAddress: test2FacetCode.address,
                action: FacetCutAction.Add,
                functionSelectors: DiamondSelectors.fromABI(test2FacetInt).selectors
            }
        ];
        await diamondCutFacet.diamondCut(cut, ZERO_ADDRESS, '0x', { gas: 8000000 });
        const facets = await diamondLoupeFacet.facets();
        const facetAddresses = await diamondLoupeFacet.facetAddresses();
        assert.equal(facetAddresses.length, 4);
        assert.equal(facets.length, 4);
        assert.sameMembers(facetAddresses, [diamondCutAddr, diamondLoupeAddr, test1FacetCode.address, test2FacetCode.address]);
        assert.equal(facets[0].facetAddress, facetAddresses[0], 'first facet');
        assert.equal(facets[1].facetAddress, facetAddresses[1], 'second facet');
        assert.equal(facets[2].facetAddress, facetAddresses[2], 'third facet');
        assert.equal(facets[3].facetAddress, facetAddresses[3], 'fourth facet');
        const findFacet = (address: string) => requireNotNull(facets.find(f => f.facetAddress === address));
        // the ones that were re-added
        assert.sameMembers(findFacet(diamondLoupeAddr).functionSelectors, diamondLoupeFacetSelectors.selectors);
        assert.sameMembers(findFacet(test1FacetCode.address).functionSelectors, DiamondSelectors.fromABI(test1FacetInt).selectors);
        assert.sameMembers(findFacet(test2FacetCode.address).functionSelectors, DiamondSelectors.fromABI(test2FacetInt).selectors);
        // this one remains mostly removed
        assert.sameMembers(findFacet(diamondCutAddr).functionSelectors, [web3.eth.abi.encodeFunctionSignature('diamondCut((address,uint8,bytes4[])[],address,bytes)')]);
    });

    it('should not exhibit the cache bug', async () => {
        const test1Facet = await Test1Facet.new();

        // add functions
        const selFacets = '0x7a0ed627';
        const sel0 = '0x19e3b533'; // fills up slot 1
        const sel1 = '0x0716c2ae'; // fills up slot 1
        const sel2 = '0x11046047'; // fills up slot 1
        const sel3 = '0xcf3bbe18'; // fills up slot 1
        const sel4 = '0x24c1d5a7'; // fills up slot 1
        const sel5 = '0xcbb835f6'; // fills up slot 1
        const sel6 = '0xcbb835f7'; // fills up slot 1
        const sel7 = '0xcbb835f8'; // fills up slot 2
        const sel8 = '0xcbb835f9'; // fills up slot 2
        const sel9 = '0xcbb835fa'; // fills up slot 2
        const sel10 = '0xcbb835fb'; // fills up slot 2
        let selectors = [sel0, sel1, sel2, sel3, sel4, sel5, sel6, sel7, sel8, sel9, sel10];
        await diamondCutFacet.diamondCut([
            {
                facetAddress: test1Facet.address,
                action: FacetCutAction.Add,
                functionSelectors: selectors
            }
        ], ZERO_ADDRESS, '0x', { gas: 800000 });
        // Remove function selectors
        // Function selector for the owner function in slot 0
        selectors = [selFacets, sel5, sel10];
        await diamondCutFacet.diamondCut([
            {
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: selectors
            }
        ], ZERO_ADDRESS, '0x', { gas: 800000 });

        // check

        // Get the test1Facet's registered functions
        selectors = await diamondLoupeFacet.facetFunctionSelectors(test1Facet.address);
        // Check individual correctness
        assert.isTrue(selectors.includes(sel0), 'Does not contain sel0');
        assert.isTrue(selectors.includes(sel1), 'Does not contain sel1');
        assert.isTrue(selectors.includes(sel2), 'Does not contain sel2');
        assert.isTrue(selectors.includes(sel3), 'Does not contain sel3');
        assert.isTrue(selectors.includes(sel4), 'Does not contain sel4');
        assert.isTrue(selectors.includes(sel6), 'Does not contain sel6');
        assert.isTrue(selectors.includes(sel7), 'Does not contain sel7');
        assert.isTrue(selectors.includes(sel8), 'Does not contain sel8');
        assert.isTrue(selectors.includes(sel9), 'Does not contain sel9');

        assert.isFalse(selectors.includes(selFacets), 'Contains selFacets');
        assert.isFalse(selectors.includes(sel10), 'Contains sel10');
        assert.isFalse(selectors.includes(sel5), 'Contains sel5');
    });

    it('should revert if no function selectors are passed to diamondCut', async () => {
        let res = diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: []
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(res, "NoSelectorsProvidedForFacetForCut");
    });

    it('should revert if functions are to be added to address zero', async () => {
        const test1FacetCode = await Test1Facet.new();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(['supportsInterface(bytes4)']);
        let res = diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Add,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(res, "CannotAddSelectorsToZeroAddress");
    });

    it('should revert if functions that already exist are added to diamond', async () => {
        const test1FacetCode = await createTest1Facet();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(['supportsInterface(bytes4)']);
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: test1FacetCode.address,
                action: FacetCutAction.Add,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotAddFunctionToDiamondThatAlreadyExists");
    });

    it('should revert if facet address is zero', async () => {
        const test1FacetCode = await createTest1Facet();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).restrict(['supportsInterface(bytes4)']);
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Replace,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotReplaceFunctionsFromFacetWithZeroAddress");
    });

    it('should revert if facet function is to be replaced with the same function from the same facet', async () => {
        const test1FacetCode = await createTest1Facet();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(['supportsInterface(bytes4)']);
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: test1FacetCode.address,
                action: FacetCutAction.Replace,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotReplaceFunctionWithTheSameFunctionFromTheSameFacet");
    });

    it('should revert if function to be replaced does not exist', async () => {
        const test1FacetCode = await createTest1Facet();
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(['supportsInterface(bytes4)']);
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: test1FacetCode.address,
                action: FacetCutAction.Replace,
                // Random selector that does not exist
                functionSelectors: ['0x28f3b533']
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotReplaceFunctionThatDoesNotExists");
    });

    it('should revert if facet address is not zero when removing functions', async () => {
        const test1FacetCode = await createTest1Facet();
        const functionsToKeep = ['test1Func1()', 'test1Func5()', 'test1Func6()', 'test1Func19()', 'test1Func20()'];
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(functionsToKeep);
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: test1FacetCode.address,
                action: FacetCutAction.Remove,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "RemoveFacetAddressMustBeZeroAddress");
    });

    it('should revert if function to be removed does not exist', async () => {
        const test1FacetCode = await createTest1Facet();
        const functionsToKeep = ['test1Func1()', 'test1Func5()', 'test1Func6()', 'test1Func19()', 'test1Func20()'];
        const selectors = DiamondSelectors.fromABI(test1FacetCode).remove(functionsToKeep);
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: [selectors.selectors[0],'0x28f3e533']
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotRemoveFunctionThatDoesNotExist");
    });

    it('should revert if address to have functions replaced has no code', async () => {
        let result = diamondCutFacet.diamondCut(
            [{
                // Address with no code
                facetAddress: accounts[0],
                action: FacetCutAction.Replace,
                functionSelectors: ['0x28f3b533']
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "NoBytecodeAtAddress");
    });

    it('should revert if diamond cut initialization fails', async () => {
        const test1FacetCode = await createTest1Facet();
        const test1Facet = await Test1Facet.at(diamondCutAddr);
        const selectors = DiamondSelectors.fromABI(test1Facet).restrict(['supportsInterface(bytes4)']);
        const testFacetAddress = test1FacetCode.address;
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: selectors.selectors
            }],
            testFacetAddress, ZERO_ADDRESS, { gas: 800000 });
        await expectRevert(result, "InitializationFunctionReverted");
    });

    it('should revert if functions to be removed are immutable (defined directly in the diamond)', async () => {
        const Diamond = artifacts.require("MockDiamond");
        const diamond = await Diamond.at(diamondAddress);
        const selectors = DiamondSelectors.fromABI(diamond);
        // Add functions defined directly in the diamond
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: diamondAddress,
                action: FacetCutAction.Add,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        // Try to remove functions defined directly in the diamond
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: ZERO_ADDRESS,
                action: FacetCutAction.Remove,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotRemoveImmutableFunction");
    });

    it('should revert if functions to be replaced are immutable (defined directly in the diamond)', async () => {
        const Diamond = artifacts.require("MockDiamond");
        const diamond = await Diamond.at(diamondAddress);
        const selectors = DiamondSelectors.fromABI(diamond);
        // Add functions defined directly in the diamond
        await diamondCutFacet.diamondCut(
            [{
                facetAddress: diamondAddress,
                action: FacetCutAction.Add,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        // Try to replace functions defined directly in the diamond
        let result = diamondCutFacet.diamondCut(
            [{
                facetAddress: diamondAddress,
                action: FacetCutAction.Replace,
                functionSelectors: selectors.selectors
            }],
            ZERO_ADDRESS, '0x', { gas: 800000 });
        await expectRevert(result, "CannotReplaceImmutableFunction");
    });

});
