#!/bin/bash

set -e

rm -rf artifacts/flattened
mkdir -p artifacts/flattened
cp artifacts/cache/flattened/**/*.json artifacts/flattened

# remove interfaces
rm artifacts/flattened/I[A-Z]*.json
# remove some contracts
rm artifacts/flattened/Governed*.json
rm artifacts/flattened/ERC20*.json
