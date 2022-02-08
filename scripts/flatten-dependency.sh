#!/bin/bash

set -e

if [ -z "$2" ]; then 
    echo "$0 <subproject_dir> <file_list>"
    echo "    where <file_list> is a file containing list of lines of format <inputfile> <outputfile>"
    exit 1
fi

SUBPROJECT_DIR=$1
LISTFILE=$2

cat $LISTFILE | while true; do
    read -r FILE OUTFILE || true
    if [ -z "$OUTFILE" ]; then break; fi
    
    echo "Flattening $SUBPROJECT_DIR/$FILE to $OUTFILE"
    
    TMPFILE="/tmp/$(basename $FILE)"

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
done
