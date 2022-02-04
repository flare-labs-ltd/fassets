#!/bin/bash

set -e

if [ -z "$3" ]; then echo "$0 <subproject_dir> <file> <output_file>"; exit 1; fi

SUBPROJECT_DIR=$1
FILE=$2
OUTFILE=$3
TMPFILE="/tmp/$(basename $2)"

if [[ "$SUBPROJECT_DIR" =~ flare-smart-contracts ]]; then
    HHCONFIG="--config hardhatSetup.config.ts"
fi

mkdir -p "$(dirname $OUTFILE)"
pushd "$SUBPROJECT_DIR" > /dev/null
PRAGMA_SOLIDITY=$(grep '^pragma solidity' "$FILE")
yarn hardhat $HHCONFIG flatten "$FILE" > "$TMPFILE"
popd > /dev/null

echo "// SPDX-License-Identifier: MIT" > "$OUTFILE"
echo "$PRAGMA_SOLIDITY" >> "$OUTFILE"
echo "" >> "$OUTFILE"
cat "$TMPFILE" | grep -v '^\$' | grep -v '^// SPDX-License-Identifier: MIT' | grep -v '^pragma solidity' >> "$OUTFILE"
rm "$TMPFILE"
