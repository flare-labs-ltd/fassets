# FAsset contracts

## Repository Transferred

The development of FAsset protocol was commissioned for and on behalf of the Flare Foundation, accordingly all completed repos for the protocol have been moved to [Flare Foundation Github](https://github.com/flare-foundation), the protocol's ultimate owner.
[New repository](https://github.com/flare-foundation/fassets)

# FAssets

Solidity contracts for *Flare Labs* FAsset system.

## Overview

The FAsset contracts are used to mint assets on top of Flare (or Songbird). The system is designed to handle chains which don’t have (full) smart contract capabilities, although it can also work for smart contract chains. Initially, FAsset system will support assets XRP, BTC, DOGE, and LTC. Later we might add other blockchains.

The minted FAssets are secured by collateral, which is in the form of ERC20 tokens on Flare/Songbird chain and native tokens (FLR/SGB). The collateral is locked in contracts that guarantee that minted tokens can always be redeemed for underlying assets or compensated by collateral.

Two novel protocols, available on Flare and Songbird blockchains, enable the FAsset system to operate:

- **FTSO** contracts which provide decentralised price feeds for multiple tokens.
- Flare’s **FDC**, which bridges payment data from any connected chain.

## Development

### Getting started

1. Clone this repository.
2. Run `yarn`.
3. Compile the solidity code: `yarn c`.
4. Run basic tests `yarn testHH`.

#### Flare-smart-contracts dependency

Currently, `flare-smart-contracts` dependency is obtained directly from git repository from a tag that supports the required functionality.

For development, it might be beneficial to directly use checked-out code of `flare-smart-contracts`. This can be done with `yarn link`:

1. In `flare-smart-contracts` project folder run `yarn link`
2. In `fasset` project folder run `yarn link flare-smart-contracts`

This creates softlink from `node_modules/flare-smart-contracts` to the flare-smart-contracts project folder.

For development in *VSCode* you might also find VSCode *Workspace* feature useful - it allows you to have multiple projects open in the same window (e.g. both fasset and flare-smart-contracts).

### Testing

Note: be sure to compile (`yarn c`) after any solidity code changes or if starting a clean project as Typescript stubs need to be generated as part of the compilation.

Then one can run different types of tests.

- `yarn testHH` - all tests in hardhat environment (includes following two types of tests).
- `yarn test_unit_hh` - only unit tests in hardhat environment.
- `test_integration_hh` - only integration tests in hardhat environment.

To check test coverage run `yarn cov`.
