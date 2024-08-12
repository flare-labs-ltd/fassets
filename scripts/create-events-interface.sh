#!/bin/bash

INFILE="contracts/assetManager/library/AMEvents.sol"
OUTFILE="contracts/userInterfaces/IAssetManagerEvents.sol"

TMPFILE=$(mktemp)

sed 's/library AMEvents/interface IAssetManagerEvents/' $INFILE > $TMPFILE
if ! diff $TMPFILE $OUTFILE > /dev/null; then
    cp $TMPFILE $OUTFILE
fi
rm $TMPFILE
