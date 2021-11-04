# Test folder organization

Test folder is divided into several folders due to code organization and also packing tests that do not run too long for the purpose of assembling CI/CD jobs on Gitlab. 

## Top level folders
The meaning of top level folders is as follows:

- `finalized` - experimental tests with finalization (to be deleted at some point).
- `fuzzing` - test using fuzzing approach
- `hardhat` - tests on local hardhat chain, in particular end to end tests.
- `integration` - integration tests.
- `performance` - performance tests.
- `scdev` - tests adapted to local Flare chain, in particular end to end tests.
- `test-cases` - files with test cases configurations.
- `unit` - unit tests.
- `utils` - utilities and helper functions for other tests in other folders.

## Structure of folders for unit tests

The structure tries to resemble the structure in `contracts` folder, while there may be some exceptions (e.g. currently we have the folder `adversary` with some specific flash loan tests - subject to move somewhere else during further reorganizations).

## Creating CI/CD jobs for running tests

The jobs for running tests in CI/CD are defined in the file `.gitlab-ci.yml`. The goal is to keep jobs small enough to be run in about 5 mins. All relevant tests run in parallel. Jobs may include running tests from folders. The syntax to run all test in folder and subfolders recursively is like this:

```
    ...
    script:
        ...
        - env TEST_PATH=./test/unit/ftso/lib yarn hardhat test --network hardhat
```

The folder to be run is definde as relative path in variable `TEST_PATH`.

Sometimes single files run long. Such files should be either broken into several files and distributed to different folders or could be run separately. An example of a syntax to run such a file directly in a job is:

```
    ...
    script:
        ...
        - yarn hardhat test --network hardhat test/unit/ftso/implementation/FtsoManager.ts
```

IMPORTANT: If you add a test file in some new folder not covered by jobs, please update jobs. If necessary, create new jobs (copy existing one, rename it and use the above syntax to configure runs).