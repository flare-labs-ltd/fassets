#!/bin/bash

set -e

cd ../attestation-client
yarn
yarn codegen
cd - > /dev/null

rm -rf lib/verification contracts/generated

mkdir -p lib/verification
cp -R ../attestation-client/contracts/generated contracts
cp -R ../attestation-client/src/verification/{generated,sources,attestation-types} lib/verification

sed -E -i 's/pragma solidity [0-9\.]+;/pragma solidity 0.8.20;/g' contracts/generated/contracts/*.sol
