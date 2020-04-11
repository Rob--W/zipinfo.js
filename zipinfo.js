/**
 * Copyright (c) 2016 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 * Published under a MIT license.
 * https://github.com/Rob--W/zipinfo.js
 **/
/* globals DataView, TextDecoder, Buffer, module */
'use strict';
var ZipInfo = typeof module === 'object' && module.exports || {};

/**
 * Reports the metadata of a zip file. This method itself is resilient against
 * malformed zip files, but you should take any result with a pinch of salt
 * since it is trivial to spoof the metadata (which often breaks unzipping).
 *
 * The file must match the format as specified by:
 * https://en.wikipedia.org/wiki/Zip_(file_format)
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 *
 * The following zip features are not supported:
 * - ZIP64
 * - Encrypted zip files
 * - Data description headers (=all file sizes will be reported as 0).
 *
 * @param {Uint8Array} data - Valid zip data. This may start anywhere in the zip
 *    file, as long as the end of the data is also the end of the zip file.
 * @param {number} [dataStartOffset=0] - The position in the zip file where the
 *    data starts. The list of files if a zip file is usually stored at the end,
 *    so usually it suffices to first try to find the EOCD record that specifies
 *    the start of the central directory (which lists all files), and then fetch
 *    the data if needed.
 * @returns {object} A list of objects describing each entry:
 * - directory (boolean) - whether the entry is a directory.
 * - filename (string) - name of entry.
 * - uncompressedSize (number) - the size of the entry when uncompressed.
 * The first entry is always an artificial '/' directory, and includes the
 * following property:
 * - centralDirectoryStart (number) - The start of the central directory as
 *   claimed by the zip file. If `data` is only a part of the zip file, you
 *   should check whether `centralDirectoryStart < dataStartOffset`, and if so
 *   fetch more data starting from `dataStartOffset` and call this method
 *   again. Otherwise the returned list of files may be incomplete.
 */
ZipInfo.getEntries = function(data, dataStartOffset, includeOffset) {
  var view = new DataView(data.buffer, data.byteOffset, data.length);
  var entriesLeft = 0;
  var offset = 0;
  var endoffset = data.length;
  // Find EOCD (0xFFFF is the maximum size of an optional trailing comment).
  for (var i = data.length - 22, ii = Math.max(0, i - 0xFFFF); i >= ii; --i) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 && data[i + 3] === 0x06) {
        endoffset = i;
        offset = view.getUint32(i + 16, true);
        entriesLeft = view.getUint16(i + 8, true);
        break;
      }
  }

  // Zip64 support: if these are set, then parse as Zip64
  if (offset === 0xFFFFFFFF || entriesLeft === 0xFFFF) {
    if (view.getUint32(endoffset - 20, true) !== 0x07064b50) {
      console.error('invalid zip64 EOCD locator');
      return;
    }

    var zip64Offset = ZipInfo.getUint64(view, endoffset - 12, true);

    var viewOffset = zip64Offset - dataStartOffset;

    if (view.getUint32(viewOffset, true) !== 0x06064b50) {
      console.error('invalid zip64 EOCD record');
      return;
    }

    entriesLeft = ZipInfo.getUint64(view, viewOffset + 32, true);
    offset = this.getUint64(view, viewOffset + 48, true);
  }

  var entries = [{
    directory: true,
    filename: '/',
    uncompressedSize: 0,
    centralDirectoryStart: offset,
  }];
  if (dataStartOffset) {
    offset -= dataStartOffset;
  }
  if (offset >= data.length || offset <= 0) {
    // EOCD not found or malformed. Try to recover if possible (the result is
    // most likely going to be incomplete or bogus, but we can try...).
    offset = -1;
    entriesLeft = 0xFFFF;
    while (++offset < data.length && data[offset] !== 0x50 &&
      data[offset + 1] !== 0x4b && data[offset + 2] !== 0x01 &&
        data[offset + 3] !== 0x02);
  }
  endoffset -= 46;  // 46 = minimum size of an entry in the central directory.
  while (--entriesLeft >= 0 && offset < endoffset) {
    if (view.getUint32(offset) != 0x504b0102) {
      break;
    }
    var bitFlag = view.getUint16(offset + 8, true);
    var compressedSize = view.getUint32(offset + 20, true);
    var uncompressedSize = view.getUint32(offset + 24, true);
    var fileNameLength = view.getUint16(offset + 28, true);
    var extraFieldLength = view.getUint16(offset + 30, true);
    var fileCommentLength = view.getUint16(offset + 32, true);
    var filename = data.subarray(offset + 46, offset + 46 + fileNameLength);
    var utfLabel = (bitFlag & 0x800) ? 'utf-8' : 'ascii';
    filename = ZipInfo._decodeFilename(filename, utfLabel);

    var localEntryOffset = view.getUint32(offset + 42, true);

    // ZIP64 support
    if (compressedSize === 0xFFFFFFFF ||
        uncompressedSize === 0xFFFFFFFF ||
        localEntryOffset === 0xFFFFFFFF) {

      var extraFieldOffset = offset + 46 + fileNameLength;
      var efEnd = extraFieldOffset + extraFieldLength - 3;

      while (extraFieldOffset < efEnd) {
        var type = view.getUint16(extraFieldOffset, true);
        var size = view.getUint16(extraFieldOffset + 2, true);
        extraFieldOffset += 4;

        // zip64 extra info field
        if (type === 1) {
          if (uncompressedSize === 0xFFFFFFFF && size >= 8) {
            uncompressedSize = this.getUint64(view, extraFieldOffset, true);
            extraFieldOffset += 8;
            size -= 8;
          }
          if (compressedSize === 0xFFFFFFFF && size >= 8) {
            compressedSize = this.getUint64(view, extraFieldOffset, true);
            extraFieldOffset += 8;
            size -= 8;
          }
          if (localEntryOffset === 0xFFFFFFFF && size >= 8) {
            localEntryOffset = this.getUint64(view, extraFieldOffset, true);
            extraFieldOffset += 8;
            size -= 8;
          }
        }

        extraFieldOffset += size
      }
    }

    entries.push({
      directory: filename.endsWith('/'),
      filename: filename,
      uncompressedSize: uncompressedSize,
    });

    // add offset + compressedSize
    if (includeOffset) {
      entries[entries.length - 1].compressedSize = compressedSize;
      entries[entries.length - 1].localEntryOffset = localEntryOffset;
    }

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
};

/**
 * @param {Uint8Array} filename
 * @param {string} utfLabel
 */
ZipInfo._decodeFilename = function(filename, utfLabel) {
  if (typeof TextDecoder == 'function') {
    return new TextDecoder(utfLabel).decode(filename);
  }
  return new Buffer(filename).toString(utfLabel);  // Node.js
};

/**
 * Fetches the list of files in a zip file using the HTTP protocol (http/https).
 *
 * @param {function} sendHttpRequest - The method to fetch the initial data.
 *  This callback is passed an object with the following properties:
 *  - rangeHeader - An optional string. If not falsey, the "Range" request
 *    header must be set on the request with this value.
 *  - onHeadersReceived - This method should be called when the headers become
 *    available. Calling this is recommended but not required. The callback
 *    should be passed a function that returns a header for a given header name,
 *    or a falsey value if the header is unavailable.
 *  - onCompleted - This method must be called when the request finishes, UNLESS
 *    the request is explicitly aborted. The callback should be called with a
 *    Uint8Array of the response (which may be empty if an error has occurred).
 *  The method must return an object with the "abort" method, which cancels the
 *  initial request.
 * @param {function} onGotEntries - Called when all request finish. The method
 *  is called with a single argument, the return value of ZipInfo.getEntries.
 */
ZipInfo.runGetEntriesOverHttp = function(sendHttpRequest, onGotEntries) {
  function getRange(start, length) {
    // We are expecting a response at the end of a zip file. Do not set the
    // range header if the start is 0 in case the server has a buggy range
    // request implementation.
    if (start) {
      return 'bytes=' + start + '-' + (length - 1) + '/' + length;
    }
  }

  var x = sendHttpRequest({
    onHeadersReceived: function(getResponseHeader) {
      var length = parseInt(getResponseHeader('Content-Length'), 10) || 0;
      // 100k is an arbitrary threshold above the maximum EOCD record size.
      if (length < 1e5 || getResponseHeader('Accept-Ranges') !== 'bytes') {
        return;
      }
      // Switch to range requests.
      x.abort();
      // The EOCD record size is at most 0xFFFF + 22. -1 for range request.
      var start = length - 0xFFFF - 23;
      sendHttpRequest({
        rangeHeader: getRange(start, length),
        onCompleted: function(response) {
          if (start && response.byteLength === length) {
            start = 0;  // Server does not seem to support range requests.
          }
          var entries = ZipInfo.getEntries(response, start);
          if (entries[0].centralDirectoryStart >= start) {
            onGotEntries(entries);
          } else {
            start = entries[0].centralDirectoryStart;
            sendHttpRequest({
              rangeHeader: getRange(start, length),
              onCompleted: function(response) {
                onGotEntries(ZipInfo.getEntries(response, start));
              },
            });
          }
        },
      });
    },
    onCompleted: function(response) {
      onGotEntries(ZipInfo.getEntries(response));
    },
  });
};

  // from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView
ZipInfo.getUint64 = function(dataview, byteOffset, littleEndian) {
  // split 64-bit number into two 32-bit (4-byte) parts
  const left =  dataview.getUint32(byteOffset, littleEndian);
  const right = dataview.getUint32(byteOffset+4, littleEndian);

  // combine the two 32-bit values
  const combined = littleEndian? left + 2**32*right : 2**32*left + right;

  if (!Number.isSafeInteger(combined))
    console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost');

  return combined;
}

