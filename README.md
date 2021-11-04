# Flare network f-asset smart contracts repository

Contracts cover *Flare network* f-asset functionality. It depends on the contract in the `flare-smart-contracts` repository.

## Getting started

1. Clone this repo.
2. Run `yarn`.
3. Compile the solidity code: `yarn c`.
4. Run basic tests `yarn testHH`.

Currently, `flare-smart-contracts` dependency is obtained directly from git repository without any branch/tag selection, so it always obtains the current `master` branch and then puts commit hash in the lockfile. In future we will tag the correct flare-smart-contracts version or publish it to npm repository.

For development, it might be beneficial to directly use checked-out code of `flare-smart-contracts`. This can be done with `yarn link`:

1. In `flare-smart-contracts` project folder run `yarn link`
2. In `fasset` project folder run `yarn link flare-smart-contracts`

This creates softlink from `node_modules/flare-smart-contracts` to the flare-smart-contracts project folder.

For development in *VSCode* you might also find VSCode *Workspace* feature useful - it allows you to have multiple projects open in the same window (e.g. both fasset and flare-smart-contracts).

## Testing

Note: be sure to compile (`yarn c`) after any solidity code changes or if starting a clean project as Typescript stubs need to be generated as part of the compilation. 

Then one can run different types of tests.

- `yarn testHH` - all tests in hardhat environment (includes next three types of tests).
- `yarn test_unit_hh` - only unit tests in hardhat environment.
- `yarn test_performance_hh` - only performance tests in hardhat environment.
- `test_integration_hh` - only integration tests in hardhat environment.

Each of these calls can have additional parameters, namely paths to specific files with tests. Glob expressions can be used, but note that glob expressions are expanded in `bash` to a sequence of space separated paths. Keep in mind that glob expressions in bash containing `/**/` do not by default expand to all files, so one can switch on full expansion by setting `shopt -s globstar`, and if needed, later switch it off with `shopt -u globstar`.

Some parts of the code can only be tested against a "real" Flare block chain which adds some special features on top of the regular EVM. Any test below that has `HH` in the script name will run against an auto-launched hardhat chain. Some tests can only run against a Flare chain.
A few options exist for running a Flare chain, with the simplest one described above.

To check test coverage run `yarn cov`.
