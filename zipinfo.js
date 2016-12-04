/* globals DataView, TextDecoder, Buffer, module, Uint8Array, XMLHttpRequest */
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
ZipInfo.getEntries = function(data, dataStartOffset) {
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
    var uncompressedSize = view.getUint32(offset + 24, true);
    var fileNameLength = view.getUint16(offset + 28, true);
    var extraFieldLength = view.getUint16(offset + 30, true);
    var fileCommentLength = view.getUint16(offset + 32, true);
    var filename = data.subarray(offset + 46, offset + 46 + fileNameLength);
    var utfLabel = (bitFlag & 0x800) ? 'utf-8' : 'ascii';
    filename = ZipInfo._decodeFilename(filename, utfLabel);

    entries.push({
      directory: filename.endsWith('/'),
      filename: filename,
      uncompressedSize: uncompressedSize,
    });
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

ZipInfo.getRemoteEntries = function(url, onGotEntries) {
  var start = 0;  // Set when range requests are supported and desired.
  var length = 0;
  function requestRange(callback) {
    // Using XHR because fetch doesn't support abort.
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    if (start) {
      x.setRequestHeader('Range',
        'bytes=' + start + '-' + (length - 1) + '/' + length);
    }
    x.onloadend = function() {
      var res = this.response;
      if (start && res && res.byteLength === length) {
        start = 0;  // Server does not seem to support byte range requests.
      }
      callback(ZipInfo.getEntries(new Uint8Array(res || 0), start));
    };
    x.send();
    return x;
  }

  var x = requestRange(onGotEntries);
  x.onreadystatechange = function() {
    if (this.readyState === 2) {
      length = parseInt(this.getResponseHeader('Content-Length'), 10) || 0;
      // 100k is an arbitrary threshold above the maximum EOCD record size.
      if (length > 1e5 && this.getResponseHeader('Accept-Ranges') === 'bytes') {
        this.onreadystatechange = this.onloadend = null;
        this.abort();
        // The EOCD record size is at most 0xFFFF + 22. -1 for range request.
        start = length - 0xFFFF - 23;
        requestRange(function(entries) {
          if (entries[0].centralDirectoryStart >= start) {
            onGotEntries(entries);
            return;
          }
          start = entries[0].centralDirectoryStart;
          requestRange(onGotEntries);
        });
      }
    }
  };
};
