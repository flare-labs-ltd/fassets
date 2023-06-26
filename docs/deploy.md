# Deploy

## Hardhat with mock dependencies
- Start hardhat node.
- Run `yarn mock-deploy-hardhat`

## Hardhat with real dependencies
- Make sure that deployer account (DEPLOYER_PRIVATE_KEY) is set in `.env` and has enough funds for gas.
- Start hardhat node in `flare-smart-contracts` project
- In `flare-smart-contracts` project run `yarn deploy_local_hardhat_commands`
- In `fasset` project run `flare-sc-deploy-hardhat`

## Coston
- Make sure that deployer account (DEPLOYER_PRIVATE_KEY) is set in `.env` and has enough funds for gas.
- If not deployed already, deploy mock stablecoins by running ``
- Run `yarn full-deploy-coston`
