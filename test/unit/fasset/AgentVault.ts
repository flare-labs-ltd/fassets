import { constants } from "@openzeppelin/test-helpers";
import { WNatInstance } from "../../../typechain-truffle";
import { getTestFile } from "../../utils/helpers";

const WNat = artifacts.require("WNat");
const AgentVault = artifacts.require("AgentVault");

contract(`AgentVault.sol; ${getTestFile(__filename)}; AgentVault unit tests`, async accounts => {
    let wnat: WNatInstance;
    
    beforeEach(async() => {
        wnat = await WNat.new(accounts[0], "WNat", "WNAT");
    });
    
    it("can create", async () => {
        const agentVault = await AgentVault.new(constants.ZERO_ADDRESS, accounts[1]);
    });
});
