#!/bin/bash

set -e

cd ../mcc
yarn
yarn build
cd - > /dev/null

cd ../attester-client
yarn
yarn codegen
cd - > /dev/null

mkdir -p test/utils/verification
cp -R ../attester-client/contracts/generated contracts
cp -R ../attester-client/lib/verification/{generated,sources,attestation-types} test/utils/verification
