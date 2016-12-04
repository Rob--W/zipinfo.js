/* jshint node:true,mocha:true */
'use strict';

var ZipInfo = require('../zipinfo.js');

var assert = require('assert');
var fs = require('fs');
var path = require('path');

function readFileAsUint8Array(filepath) {
  filepath = path.resolve(__dirname, filepath);
  var nodeBuffer = fs.readFileSync(filepath);
  return new Uint8Array(nodeBuffer);
}

function assertEntriesEq(actualEntries, expectedEntries) {
  /* // Uncomment to easily generate a list of test expectations
  console.log(
    JSON.stringify(actualEntries, null, 2)
      .replace(/^([^"]+)"([^"]+)"/gm, '$1$2')
      .replace(/"/g, '\'')
      .replace(/(\s+)\}/g, ',$1}')
      .replace(/\},\s*\{/g, '}, {'));
  //*/
  assert.deepEqual(actualEntries, expectedEntries, 'entries should match');
}

function simulateTextDecoder(callback) {
  var callCount = 0;
  global.TextDecoder = function TextDecoder(utfLabel) {
    assert(utfLabel === 'utf-8' || utfLabel === 'ascii');
    assert(this instanceof TextDecoder);
    return {
      decode: function(uint8Array) {
        assert(uint8Array instanceof Uint8Array);
        ++callCount;
        return new Buffer(uint8Array).toString(utfLabel);
      },
    };
  };
  try {
    callback();
  } finally {
    delete global.TextDecoder;
  }
  return callCount;
}

describe('ZipInfo.getEntries', function() {
  it('should return an empty list for invalid data', function() {
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 0,
    }];
    assertEntriesEq(ZipInfo.getEntries(new Uint8Array()), expected);
    // Boundaries for EOCD record.
    assertEntriesEq(ZipInfo.getEntries(new Uint8Array(0xFFFF + 21)), expected);
    assertEntriesEq(ZipInfo.getEntries(new Uint8Array(0xFFFF + 22)), expected);
    assertEntriesEq(ZipInfo.getEntries(new Uint8Array(0xFFFF + 23)), expected);
  });

  it('entries for zips (from 7z)', function() {
    var data = readFileAsUint8Array('testdata/7z-all.zip');
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 371,
    }, {
      directory: false,
      filename: '100.dat',
      uncompressedSize: 100,
    }, {
      directory: false,
      filename: 'empty file with spaces',
      uncompressedSize: 0,
    }, {
      directory: true,
      filename: 'emptydir/',
      uncompressedSize: 0,
    }, {
      directory: false,
      filename: 'more.than.FFFF',
      uncompressedSize: 70000,
    }, {
      directory: true,
      filename: 'otherdir/',
      uncompressedSize: 0,
    }, {
      directory: false,
      filename: 'otherdir/empty.dat',
      uncompressedSize: 0,
    }];
    assertEntriesEq(ZipInfo.getEntries(data), expected);
  });

  it('entries for zips (from zip)', function() {
    var data = readFileAsUint8Array('testdata/zip-all.zip');
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 518,
    }, {
      directory: false,
      filename: 'empty file with spaces',
      uncompressedSize: 0,
    }, {
      directory: false,
      filename: '100.dat',
      uncompressedSize: 100,
    }, {
      directory: false,
      filename: 'more.than.FFFF',
      uncompressedSize: 70000,
    }, {
      directory: true,
      filename: 'emptydir/',
      uncompressedSize: 0,
    }, {
      directory: true,
      filename: 'otherdir/',
      uncompressedSize: 0,
    }, {
      directory: false,
      filename: 'otherdir/empty.dat',
      uncompressedSize: 0,
    }];
    assertEntriesEq(ZipInfo.getEntries(data), expected);
  });

  it('entries for zips with utf8 names (from zip)', function() {
    var data = readFileAsUint8Array('testdata/zip-utf8.zip');
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 62,
    }, {
      directory: false,
      // TODO: This should be the unicode character, but the zip tool on OS X
      // does not set the 11th general purpose bit, so strictly speaking the
      // file is not UTF-8.
      // For now I blindly rely on this bit to detect unicode. For alternatives,
      // see https://github.com/gildas-lormeau/zip.js/issues/131
      filename: 'p\u001f\u0012)',
      // filename: '\ud83d\udca9',
      uncompressedSize: 0,
    }];
    assertEntriesEq(ZipInfo.getEntries(data), expected);

    // This shows what happens if we unconditionally use utf-8 for file names:
    var _decodeFilename = ZipInfo._decodeFilename;
    ZipInfo._decodeFilename = function(filename) {
      return new Buffer(filename).toString('utf-8');
    };
    try {
      expected[1].filename = '\ud83d\udca9';
      assertEntriesEq(ZipInfo.getEntries(data), expected);
    } finally {
      ZipInfo._decodeFilename = _decodeFilename;
    }
  });

  it('entries for zips with utf8 names (from 7z)', function() {
    var data = readFileAsUint8Array('testdata/7z-utf8.zip');
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 34,
    }, {
      directory: false,
      filename: '\ud83d\udca9',
      uncompressedSize: 0,
    }];
    assertEntriesEq(ZipInfo.getEntries(data), expected);
  });

  it('starting at a later offset', function() {
    var data = readFileAsUint8Array('testdata/7z-utf8.zip');
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 34,
    }, {
      directory: false,
      filename: '\ud83d\udca9',
      uncompressedSize: 0,
    }];

    var dataStartOffset = 34; // Same as centralDirectoryStart
    data = new Uint8Array(data.buffer, dataStartOffset);
    assertEntriesEq(ZipInfo.getEntries(data, dataStartOffset), expected);
  });

  it('starting at a too late offset', function() {
    var data = readFileAsUint8Array('testdata/7z-utf8.zip');
    data = new Uint8Array(data.buffer, 35);
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 34,
    }];
    var dataStartOffset = 35; // = centralDirectoryStart + 1
    data = new Uint8Array(data.buffer, dataStartOffset);
    assertEntriesEq(ZipInfo.getEntries(data, dataStartOffset), expected);
  });

  it('broken central directory', function() {
    var data = readFileAsUint8Array('testdata/7z-utf8.zip');
    data = new Uint8Array(data.buffer, 35);
    var expected = [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 34,
    }];
    // We cut the buffer after the start of the central directory. So the data
    // does have a EOCD record, but no recognizable central directory.
    data = new Uint8Array(data.buffer, 35);
    assertEntriesEq(ZipInfo.getEntries(data), expected);
  });

  it('TextDecoder should be used if available', function() {
    var callCount = simulateTextDecoder(function() {
      var data = readFileAsUint8Array('testdata/7z-utf8.zip');
      var expected = [{
        directory: true,
        filename: '/',
        uncompressedSize: 0,
        centralDirectoryStart: 34,
      }, {
        directory: false,
        filename: '\ud83d\udca9',
        uncompressedSize: 0,
      }];
      assertEntriesEq(ZipInfo.getEntries(data), expected);
    });
    assert.equal(callCount, 1, 'Expected TextDecoder.decode to be called once');
  });
});
