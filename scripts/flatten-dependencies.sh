#!/bin/bash

set -e

if [ -z "$3" ]; then
    echo "$0 <subproject_dir> <listfile> <outfile> [<extra-imports>]"
    echo "    where <listfile> is a file containing list of input files"
    exit 1
fi

SUBPROJECT_DIR=$1
LISTFILE=$2
OUTFILE=$3
EXTRA_IMPORTS=$4

FILES=$(cat $LISTFILE)
FIRSTFILE=$(head -n 1 $LISTFILE)

TMPFILE="/tmp/$(basename $OUTFILE)"

cd "$SUBPROJECT_DIR"
yarn
cd - > /dev/null

if [[ "$SUBPROJECT_DIR" =~ flare-smart-contracts ]]; then
    HHCONFIG="--config hardhatSetup.config.ts"
fi

if [ -n "$EXTRA_IMPORTS" ]; then
    cp $EXTRA_IMPORTS $SUBPROJECT_DIR/contracts/extra-imports.sol
    FILES="contracts/extra-imports.sol $FILES"
fi

echo "Flattening to $OUTFILE..."
cd "$SUBPROJECT_DIR"
PRAGMA_SOLIDITY=$(grep '^pragma solidity' "$FIRSTFILE")
yarn hardhat $HHCONFIG flatten ${FILES//$'\n'/ } > "$TMPFILE"
cd - > /dev/null

rm -f $SUBPROJECT_DIR/contracts/extra-imports.sol

mkdir -p "$(dirname $OUTFILE)"
echo "// SPDX-License-Identifier: MIT" > "$OUTFILE"
echo "$PRAGMA_SOLIDITY" >> "$OUTFILE"
if grep '^pragma abicoder v2' "$TMPFILE" > /dev/null; then
    echo 'pragma abicoder v2;' >> "$OUTFILE"
fi
echo "" >> "$OUTFILE"
cat "$TMPFILE" | grep -v '^\$' | grep -v '^// SPDX-License-Identifier: MIT' | grep -v '^pragma solidity' | grep -v '^pragma abicoder v2' >> "$OUTFILE"
rm "$TMPFILE"
