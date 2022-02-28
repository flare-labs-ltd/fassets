#!/bin/bash

set -e

if [ -z "$3" ]; then 
    echo "$0 <subproject_dir> <listfile> <outfile>"
    echo "    where <listfile> is a file containing list of input files (relative to <subproject_dir>)"
    exit 1
fi

SUBPROJECT_DIR=$1
LISTFILE=$2
OUTFILE=$3

FILES=$(cat $LISTFILE)
FIRSTFILE=$(head -n 1 $LISTFILE)

TMPFILE="/tmp/$(basename $OUTFILE)"

if [[ "$SUBPROJECT_DIR" =~ flare-smart-contracts ]]; then
    HHCONFIG="--config hardhatSetup.config.ts"
fi

mkdir -p "$(dirname $OUTFILE)"
pushd "$SUBPROJECT_DIR" > /dev/null
PRAGMA_SOLIDITY=$(grep '^pragma solidity' "$FIRSTFILE")
yarn hardhat $HHCONFIG flatten $FILES > "$TMPFILE"
popd > /dev/null

echo "// SPDX-License-Identifier: MIT" > "$OUTFILE"
echo "$PRAGMA_SOLIDITY" >> "$OUTFILE"
echo "" >> "$OUTFILE"
cat "$TMPFILE" | grep -v '^\$' | grep -v '^// SPDX-License-Identifier: MIT' | grep -v '^pragma solidity' >> "$OUTFILE"
rm "$TMPFILE"
