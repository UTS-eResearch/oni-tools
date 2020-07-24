#!/bin/bash

# rsync to copy a "skeleton" ocfl + ro-crate repository

SRC=
DEST=

rsync -avz --include='*.json' --include='*.html'\
           --include='*.jsonld' --include='0=*' \
           --include='*.xlsx' --include='*.pdf' \
           --exclude='*.*' \
            $SRC/ $DEST
