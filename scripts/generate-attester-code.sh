#!/bin/bash

set -e

cd ../multi-chain-client
yarn
yarn build
cd - > /dev/null

cd ../attestation-client
yarn
yarn codegen
cd - > /dev/null

mkdir -p test/utils/verification
cp -R ../attestation-client/contracts/generated contracts
cp -R ../attestation-client/lib/verification/{generated,sources,attestation-types} test/utils/verification
