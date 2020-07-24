README
======

This repository is a toolkit for checking and repairing the OCFL / RO-Crate repositories used by Oni.

## portal-check.json

Checks the integrity of RO-Crates stored in an OCFL repository by iterating over all the OCFL objects, trying to load an ro-crate-metadata.json(ld)? file from each of them, and then trying to find all the files referenced by the metadata file in the OCFL inventory of the head version.

If it can't find a file in the head, it tries to find it in previous versions and reports on it.

What it doesn't do (yet)

* check that the files actually exist
* check the fixity of the files
* pay attention to anything which is not reference by the RO-crate metadata
* test that it can get the files from Oni's web endpoint

Usage:

    ./portal-check.js --repo ./path/to/your/ocfl --namespace public_ocfl

TODO: allow log level adjustment
