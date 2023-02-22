#!/bin/bash

set -e

rm -rf artifacts/flare-sc
mkdir -p artifacts/flare-sc
cp artifacts/flattened/**/*.json artifacts/flare-sc

# remove interfaces
rm artifacts/flare-sc/I[A-Z]*.json
# remove some contracts
rm artifacts/flare-sc/Governed*.json
rm artifacts/flare-sc/ERC20*.json
