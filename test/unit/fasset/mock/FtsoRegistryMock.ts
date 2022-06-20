import { expectRevert } from "@openzeppelin/test-helpers";
import { FtsoMockInstance, FtsoRegistryMockInstance } from "../../../../typechain-truffle";
import { toBNExp } from "../../../../lib/utils/helpers";
import { getTestFile } from "../../../utils/test-helpers";

const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`FtsoRegistryMock.sol; ${getTestFile(__filename)}; Ftso registry mock basic tests`, async accounts => {
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let ftsoRegistry: FtsoRegistryMockInstance;

    beforeEach(async () => {
        // create FTSOs for nat and asset and set some price
        natFtso = await FtsoMock.new("NAT");
        await natFtso.setCurrentPrice(toBNExp(1.12, 5), 0);
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
    });

    describe("create and set", () => {
        it("should create", async () => {
            ftsoRegistry = await FtsoRegistryMock.new();
        });
        it("should add ftsos", async () => {
            ftsoRegistry = await FtsoRegistryMock.new();
            await ftsoRegistry.addFtso(natFtso.address);
            await ftsoRegistry.addFtso(assetFtso.address);
            let res = await ftsoRegistry.getFtsos([0, 1])

            assert.equal(natFtso.address, res[0]);
            assert.equal(assetFtso.address, res[1]);
        });
        it("should fail getting ftsos by index", async () => {
            ftsoRegistry = await FtsoRegistryMock.new();
            await ftsoRegistry.addFtso(natFtso.address);
            await ftsoRegistry.addFtso(assetFtso.address);

            let res = ftsoRegistry.getFtsos([2]);
            await expectRevert.unspecified(res);
            let resOne = ftsoRegistry.getFtso(2);
            await expectRevert.unspecified(resOne);
        });
        it("should fail getting ftsos by symbol", async () => {
            ftsoRegistry = await FtsoRegistryMock.new();
            await ftsoRegistry.addFtso(natFtso.address);
            await ftsoRegistry.addFtso(assetFtso.address);
            
            let res = ftsoRegistry.getFtsoIndex("BTC");
            await expectRevert(res, "unknown ftso symbol");
    
        });
    });
});
