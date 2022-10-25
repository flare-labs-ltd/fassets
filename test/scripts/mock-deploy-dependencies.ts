import { mockDeployDependencies } from "../utils/deploy/mock-deploy-dependencies";
import { getTestFile } from "../utils/test-helpers";
import hre from "hardhat";

contract(`mock-deploy-dependencies; ${getTestFile(__filename)}; Deploy mock dependencies before fasset deploy`, accounts => {
    it("deploy dependencies from flare-smart-contracts and create contract file", async () => {
        await mockDeployDependencies(hre, "deployment/deploys/hardhat.json");
    });
});
