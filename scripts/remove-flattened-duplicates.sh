#!/bin/bash

set -e

rm -rf artifacts/flare-sc
mkdir -p artifacts/flare-sc
cp artifacts/flattened/**/*.json artifacts/flare-sc

# duplicated files in flare-smart-contracts
duplicates=$(find artifacts/ -name '*.json' -not -path 'artifacts/flattened/*/*' -not -path 'artifacts/flare-sc/*' -printf '%f ')

# remove duplicates
cd artifacts/flare-sc
rm -f $duplicates
cd - > /dev/null
