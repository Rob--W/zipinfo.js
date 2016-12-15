# zipinfo.js

Minimalistic JavaScript library to retrieve a full list of file names and sizes
for a given zip file. I wrote this because I needed such functionality, and did
not want to import a full-blown zip extractor (e.g. zip.js).

The list of files in a zip file is described in the so-called central directory,
which is located at the end of a zip file, and only followed by an
"end of central directory record" (EOCD). The maximum size of the EOCD is 65557
(=22 fixed size bytes, and an optional comment with a size of at most 0xFFFF).

So it is not necessary to read the full zip file. This observation is especially
useful in contexts where reading data is expensive (e.g. network), or where the
zip files themselves can be large. The `ZipInfo.getEntries` method was designed
to enable taking advantage of this potential optimization.

## Supported environments

The library requires support for
[typed arrays](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Typed_arrays#Browser_compatibility)
,
[DataView](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView#Browser_compatibility)
, and
[TextDecoder](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder#Browser_compatibility)
(or Node.js's [Buffer](https://nodejs.org/api/buffer.html)).

The library works in Node.js, Firefox 19+, Chrome 38+, Opera 25+.
IE10+ and Safari require a polyfill for TextDecoder (or Node.js's Buffer).


## API

### ZipInfo.getEntries
The first parameter (data) is required and should be a `Uint8Array` that
represents the zip data. The second parameter (`dataStartOffset`) is optional
and can be a positive integer that describes the number of bytes that are
skipped from the start (and thus missing from the data).

The return value is an array of plain objects. It has at least one element: the
first element specifies the "/" directory and also contains extra information
about the structure of the zip file. If the `dataStartOffset` parameter is
specified, you should check whether the value of "centralDirectoryStart" is at
least as large as the `dataStartOffset`. If not, then the returned list of files
may be incomplete and you should read additional data from the zip file and call
`ZipInfo.getEntries` again, starting at the offset of "centralDirectoryStart".

All ites in the list have the following properties:

- directory - boolean - whether the entry is a directory.
- filename - string - the name of the entry (e.g. "dir/file.txt").
- uncompressedSize - number - the size of the entry in the zip file.

The list has exactly one element if the data is not a zip archive.

### ZipInfo.runGetEntriesOverHttp
Querying the list of files in a zip file requires only a small part of the zip
file. This method implements the logic as described by the section
 "Optimization: minimize fetch" (below). See the JSDoc comment in the source
code for documentation.

There are three examples that uses `ZipInfo.runGetEntriesOverHttp` to fetch the
actual file in an optimized way:

- `zipinfo_browser.js` - exports `ZipInfo.getRemoteEntries` (see below) for
  browser environments.
- `zipinfo_greasemonkey.js` - exports `ZipInfo.getRemoteEntries` (see below)
  for GreaseMonkey scripts.
- `test-ZipInfo.js`, the whole test containing `ZipInfo.runGetEntriesOverHttp`.
  This unit test shows the expected behavior of `ZipInfo.runGetEntriesOverHttp`.

Typically you do not want to use this method directly, but use
`ZipInfo.getRemoteEntries`.

### ZipInfo.getRemoteEntries
This method is only available after loading `zipinfo_browser.js` (for browsers)
or `zipinfo_greasemonkey.js` (for cross-origin access in GreaseMonkey scripts).
This functionality is included in the minified library at
`build/zipinfo_browser.min.js` and `build/zipinfo_greasemonkey.min.js`.

The method takes two parameters: The URL (string) that provides the zip file,
and a callback that will be called with the result of `ZipInfo.getEntries`
(even if the response is invalid).

Note: The GreaseMonkey version does not appear to support cookies cross-origin,
and [headers are not available until the request fully completes]
(https://github.com/greasemonkey/greasemonkey/issues/2460), so in GreaseMonkey
the library is not as efficient as it could be. It will probably work fine in
TamperMonkey though.


## Example

See `test/test-ZipInfo.js` for some examples in Node.js.
The example below works in browsers and uses the
[fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
to fetch the whole zip file and list its contents.

```html
<script src="zipinfo.js"></script>
<script>
fetch('test/testdata/zip-all.zip').then(function(response) {
  return response.arrayBuffer();
}).then((function(data) {
  data = new Uint8Array(data);
  var entries = ZipInfo.getEntries(data);
  console.log(entries); // List of file names, sizes, ... in the zip file.
});
</script>
```

## Optimization: minimize fetch

If your zip files are often large, and the server supports byte range requests,
then you can use the following method to list the contents of the zip file:

1. Request zip data.
2. As soon as the response headers are available:
   - Retrieve the "Content-Length" header.
   - Check if the "Accept-Range: bytes" header is present.
3. If either header does not exist, or "Content-Length" is relatively low (e.g.
   at most 100k), let the request finish as usual and pass the response to
   `ZipInfo.getEntries`.
4. Otherwise, abort the request and start a new request with the request header
   for the last 0xFFFF - 22 bytes. E.g. if the file size is 100000, send
   "Range: 34442-99999/100000" to request all bytes starting at offset 34442.
5. Wait until the response was received and call `ZipInfo.getEntries` with the
   response as first parameter and the start offset as second parameter.
6. Check whether the return value's first element has a "centralDirectoryStart"
   that is lower than the start offset. If not, then we have enough data and the
   list of entries is complete (or the offset was too high and the zip file is
   malformed). Return the entries and stop now.
7. Otherwise, too little data was requested and you should repeat step 4 and 5
   with the start offset set to the value of the "centralDirectoryStart" key,
   and unconditionally return the entries.

This logic is implemented as `ZipInfo.runGetEntriesOverHttp` in an
environment-independent way. See the documentation of this method for more info.


## License
Copyright (c) 2016 Rob Wu <rob@robwu.nl> (https://robwu.nl)
Published under a MIT license.
https://github.com/Rob--W/zipinfo.js
