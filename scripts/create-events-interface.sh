#!/bin/bash

INFILE="contracts/fasset/library/AMEvents.sol"
OUTFILE="contracts/userInterfaces/assetManager/IAssetManagerEvents.sol"

TMPFILE=$(mktemp)

sed 's/library AMEvents/interface IAssetManagerEvents/' $INFILE > $TMPFILE
if ! diff $TMPFILE $OUTFILE > /dev/null; then
    cp $TMPFILE $OUTFILE
fi
rm $TMPFILE
