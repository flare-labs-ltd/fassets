import hre from "hardhat";
import { runAsyncMain } from "../../../lib/utils/helpers";
import { mockDeployDependencies } from "../utils/mock-deploy-dependencies";

runAsyncMain(async () => {
    await mockDeployDependencies(hre, "deployment/deploys/hardhat.json");
});
