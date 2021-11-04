import "hardhat/types/runtime";

declare module "hardhat/types/runtime" {
  // This is an example of an extension to the Hardhat Runtime Environment.
  // This new field will be available in tasks' actions, scripts, and tests.
  export interface HardhatRuntimeEnvironment {
    getChainConfigParameters(chainConfig: string | undefined): any;
  }
}