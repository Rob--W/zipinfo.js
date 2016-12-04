#!/bin/bash

set -e
export LANG=en_US.UTF-8

OUTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)/testdata"
TMPDIR="$(mktemp -d -t "testdata.XXXX" )"

[ -d "$OUTDIR" ] || mkdir "$OUTDIR"

UTF8NAME=$'\xf0\x9f\x92\xa9'

# Create some dummy files (filled with zero bytes).
> "$TMPDIR/empty file with spaces"
dd if=/dev/zero bs=100 count=1 > "$TMPDIR/100.dat"
dd if=/dev/zero bs=1000 count=70 > "$TMPDIR/more.than.FFFF"
mkdir "$TMPDIR/emptydir"
mkdir "$TMPDIR/otherdir"
> "$TMPDIR/otherdir/empty.dat"
> "$TMPDIR/$UTF8NAME"

# All normal file names
ALLTMPFILES=('empty file with spaces' \
    100.dat \
    more.than.FFFF \
    emptydir \
    otherdir)

# Create some archives
( cd "$TMPDIR" && 7z a "$OUTDIR/7z-all.zip" "${ALLTMPFILES[@]}" )
( cd "$TMPDIR" && zip -r "$OUTDIR/zip-all.zip" "${ALLTMPFILES[@]}" )

( cd "$TMPDIR" && 7z a "$OUTDIR/7z-utf8.zip" "$UTF8NAME" -mcu=on )
( cd "$TMPDIR" && zip "$OUTDIR/zip-utf8.zip" "$UTF8NAME" )

# Clean up.
rm -f "${ALLTMPFILES[@]}" "$UTF8NAME"
