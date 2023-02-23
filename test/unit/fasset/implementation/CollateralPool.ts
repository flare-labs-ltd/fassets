import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { CollateralPoolInstance, FAssetInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";

const CollateralPool = artifacts.require('CollateralPool');

contract(`CollateralPool.sol; ${getTestFile(__filename)}; Collateral pool basic tests`, async accounts => {
    let fAsset: FAssetInstance;
    let collateralPool: CollateralPoolInstance
    const assetManager = accounts[11];
    const agentVault = accounts[12]

    beforeEach(async () => {
        collateralPool = await CollateralPool.new(agentVault)
    });

    describe("basic tests", () => {

    });
});
