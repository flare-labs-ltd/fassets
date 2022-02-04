#!/bin/bash

set -e

if [ -z "$3" ]; then echo "$0 <subproject_dir> <file> <output_file>"; exit 1; fi

SUBPROJECT_DIR=$1
FILE=$2
OUTFILE=$3
TMPFILE="/tmp/$(basename $2)"

mkdir -p "$(dirname $OUTFILE)"
pushd "$SUBPROJECT_DIR" > /dev/null
PRAGMA_SOLIDITY=$(grep '^pragma solidity' "$FILE")
yarn hardhat flatten "$FILE" > "$TMPFILE"
popd > /dev/null

echo "// SPDX-License-Identifier: MIT" > "$OUTFILE"
echo "$PRAGMA_SOLIDITY" >> "$OUTFILE"
echo "" >> "$OUTFILE"
cat "$TMPFILE" | grep -v '^\$' | grep -v '^// SPDX-License-Identifier: MIT' | grep -v '^pragma solidity' >> "$OUTFILE"
rm "$TMPFILE"
