#!/bin/bash

solfile=$1
barename=$(basename $1 .sol)
targetdir=docs
cachedir=cache/docs

mkdir -p $cachedir
solc --userdoc --devdoc --base-path . --include-path node_modules --pretty-json -o $cachedir --overwrite $solfile
yarn ts-node scripts/parsedoc.ts $solfile $cachedir/$barename.docuser $targetdir/$barename.md
sed -i $targetdir/$barename.md -e 's/\s*NOTE/\nNOTE/'
