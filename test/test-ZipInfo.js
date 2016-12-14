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

describe('ZipInfo.runGetEntriesOverHttp', function() {
  // The minimum file size in order to switch to range requests.
  var MIN_SIZE_FOR_RANGE_REQUESTS = 100000;

  // The following depends on the content from testdata/7z-utf8.zip.
  var TEST_CD_START = 34;

  function getTestZipAsUint8Array(desiredFileSize) {
    var data = readFileAsUint8Array('testdata/7z-utf8.zip');
    assert.ok(desiredFileSize >= data.length, 'Actual size (' + data.length +
      ' must fit in the desired size (' + desiredFileSize + ')');

    var result = new Uint8Array(desiredFileSize);
    // Our test zip file's EOCD record has no comment, so its size is 22.
    var eocdStart = data.length - 22;
    var zipStart = data.subarray(0, eocdStart);
    var zipEnd = data.subarray(eocdStart, data.length);

    // Sanity check:
    assert.strictEqual(
      new DataView(data.buffer).getUint32(eocdStart, true),
      0x06054b50);

    result.set(zipStart, 0);
    result.set(zipEnd, result.length - zipEnd.length);
    return result;
  }
  function getExpectedEntries() {
    // Expectation for testdata/7z-utf8.zip.
    // The actual entries are not interesting, we are merely testing whether the
    // HTTP protocol works as expected.
    return [{
      directory: true,
      filename: '/',
      uncompressedSize: 0,
      centralDirectoryStart: 34,
    }, {
      directory: false,
      filename: '\ud83d\udca9',
      uncompressedSize: 0,
    }];
  }
  function createFakeRequestHandler(handlers) {
    var abortCount = 0;
    var requestCount = 0;
    return {
      sendRequest: function(params) {
        process.nextTick(function() {
          var handler = handlers[requestCount++];
          assert.ok(handler, 'Did not expect request number ' + requestCount);
          handler(params);
        });
        return {
          abort: function() {
            ++abortCount;
          },
        };
      },
      get abortCount() {
        return abortCount;
      },
      get requestCount() {
        return requestCount;
      },
    };
  }

  it('should work if server does not support range requests', function(done) {
    var requestHandlers = createFakeRequestHandler([
      function firstRequest(params) {
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        assert.ok(!params.rangeHeader, 'No range header at first request');
        params.onHeadersReceived(function(headerName) {
          if (headerName === 'Content-Length') {
            return String(MIN_SIZE_FOR_RANGE_REQUESTS);
          }
          if (headerName === 'Accept-Ranges') {
            return null;
          }
          assert.ok(false, 'Unexpected header: ' + headerName);
        });
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        params.onCompleted(getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS));
      },
      function lastRequest() {
        assert.ok(false, 'No second request because the first response does ' + 
          'not reply with Accept-Ranges: bytes.');
      },
    ]);
    ZipInfo.runGetEntriesOverHttp(function(params) {
      return requestHandlers.sendRequest(params);
    }, function(entries) {
      assert.strictEqual(requestHandlers.abortCount, 0, 'abort count');
      assert.strictEqual(requestHandlers.requestCount, 1, 'request count');
      assertEntriesEq(entries, getExpectedEntries());
      done();
    });
  });

  it('should send 1 request if the file is small', function(done) {
    var requestHandlers = createFakeRequestHandler([
      function firstRequest(params) {
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        assert.ok(!params.rangeHeader, 'No range header at first request');
        params.onHeadersReceived(function(headerName) {
          if (headerName === 'Content-Length') {
            return String(MIN_SIZE_FOR_RANGE_REQUESTS - 1);
          }
          if (headerName === 'Accept-Ranges') {
            return 'bytes';
          }
          assert.ok(false, 'Unexpected header: ' + headerName);
        });
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        params.onCompleted(getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS - 1));
      },
      function lastRequest() {
        assert.ok(false, 'No second request because the first response does ' + 
          'not contain enough bytes (via Content-Length).');
      },
    ]);
    ZipInfo.runGetEntriesOverHttp(function(params) {
      return requestHandlers.sendRequest(params);
    }, function(entries) {
      assert.strictEqual(requestHandlers.abortCount, 0, 'abort count');
      assert.strictEqual(requestHandlers.requestCount, 1, 'request count');
      assertEntriesEq(entries, getExpectedEntries());
      done();
    });
  });

  it('should send 1 request if the size is unknown', function(done) {
    var requestHandlers = createFakeRequestHandler([
      function firstRequest(params) {
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        assert.ok(!params.rangeHeader, 'No range header at first request');
        params.onHeadersReceived(function(headerName) {
          if (headerName === 'Content-Length') {
            return null;
          }
          if (headerName === 'Accept-Ranges') {
            return 'bytes';
          }
          assert.ok(false, 'Unexpected header: ' + headerName);
        });
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        params.onCompleted(getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS));
      },
      function lastRequest() {
        assert.ok(false, 'No second request because of missing Content-Length'); 
      },
    ]);
    ZipInfo.runGetEntriesOverHttp(function(params) {
      return requestHandlers.sendRequest(params);
    }, function(entries) {
      assert.strictEqual(requestHandlers.abortCount, 0, 'abort count');
      assert.strictEqual(requestHandlers.requestCount, 1, 'request count');
      assertEntriesEq(entries, getExpectedEntries());
      done();
    });
  });

  it('should fetch entries with range requests', function(done) {
    var requestHandlers = createFakeRequestHandler([
      function firstRequest(params) {
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        assert.ok(!params.rangeHeader, 'No range header at first request');
        params.onHeadersReceived(function(headerName) {
          if (headerName === 'Content-Length') {
            return String(MIN_SIZE_FOR_RANGE_REQUESTS);
          }
          if (headerName === 'Accept-Ranges') {
            return 'bytes';
          }
          assert.ok(false, 'Unexpected header: ' + headerName);
        });
        assert.strictEqual(requestHandlers.abortCount, 1,
          'Request should be aborted');
      },
      function requestWithRange(params) {
        assert.equal(params.rangeHeader, 'bytes=34442-99999/100000',
          'Expected Range header');
        // This is not needed, but let's test for it in case the implementation
        // changes and we have to revisit the test to check if onHeadersReceived
        // should be called.
        assert.ok(!params.onHeadersReceived, 'Does not care about headers');
        params.onCompleted(getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS));
      },
      function lastRequest() {
        assert.ok(false, 'No third request because the second response ' + 
          'contained a full zip file.');
      },
    ]);
    ZipInfo.runGetEntriesOverHttp(function(params) {
      return requestHandlers.sendRequest(params);
    }, function(entries) {
      assert.strictEqual(requestHandlers.abortCount, 1, 'abort count');
      assert.strictEqual(requestHandlers.requestCount, 2, 'request count');
      assertEntriesEq(entries, getExpectedEntries());
      done();
    });
  });

  it('should fetch more data if content is missing', function(done) {
    var requestHandlers = createFakeRequestHandler([
      function firstRequest(params) {
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        assert.ok(!params.rangeHeader, 'No range header at first request');
        params.onHeadersReceived(function(headerName) {
          if (headerName === 'Content-Length') {
            return String(MIN_SIZE_FOR_RANGE_REQUESTS);
          }
          if (headerName === 'Accept-Ranges') {
            return 'bytes';
          }
          assert.ok(false, 'Unexpected header: ' + headerName);
        });
        assert.strictEqual(requestHandlers.abortCount, 1,
          'Request should be aborted');
      },
      function requestWithRange(params) {
        // Chosen by ZipInfo.getEntries.
        var rangeStart = 34442;
        assert.equal(params.rangeHeader, 'bytes=' + rangeStart + '-99999/100000',
          'Expected Range header');
        // This is not needed, but let's test for it in case the implementation
        // changes and we have to revisit the test to check if onHeadersReceived
        // should be called.
        assert.ok(!params.onHeadersReceived, 'Does not care about headers');
        // +1 = one position past the central directory.
        params.onCompleted(
          getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS).subarray(
            rangeStart + TEST_CD_START + 1));
      },
      function thirdRequest(params) {
        // Choosen by ZipInfo.getEntries, based on the zip file's content.
        var rangeStart = TEST_CD_START;
        assert.equal(params.rangeHeader,
          'bytes=' + rangeStart + '-99999/100000', 'Expected Range header');
        assert.ok(!params.onHeadersReceived, 'Does not care about headers');
        params.onCompleted(getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS));
      },
      function lastRequest() {
        assert.ok(false, 'No fourth request because the third response ' + 
          'contained a full zip file.');
      },
    ]);
    ZipInfo.runGetEntriesOverHttp(function(params) {
      return requestHandlers.sendRequest(params);
    }, function(entries) {
      assert.strictEqual(requestHandlers.abortCount, 1, 'abort count');
      assert.strictEqual(requestHandlers.requestCount, 3, 'request count');
      assertEntriesEq(entries, getExpectedEntries());
      done();
    });
  });

  it('should recover if range support is erroneously reported', function(done) {
    var requestHandlers = createFakeRequestHandler([
      function firstRequest(params) {
        assert.strictEqual(requestHandlers.abortCount, 0,
          'Request should not be aborted');
        assert.ok(!params.rangeHeader, 'No range header at first request');
        params.onHeadersReceived(function(headerName) {
          if (headerName === 'Content-Length') {
            return String(MIN_SIZE_FOR_RANGE_REQUESTS);
          }
          if (headerName === 'Accept-Ranges') {
            return 'bytes';
          }
          assert.ok(false, 'Unexpected header: ' + headerName);
        });
        assert.strictEqual(requestHandlers.abortCount, 1,
          'Request should be aborted');
      },
      function requestWithRange(params) {
        // Server misbehaves and does not have a valid reply.
        params.onCompleted(new Uint8Array(0));
      },
      function thirdRequest(params) {
        assert.ok(!params.rangeHeader, 'No range header after failed request');
        assert.ok(!params.onHeadersReceived, 'Does not care about headers');
        params.onCompleted(getTestZipAsUint8Array(MIN_SIZE_FOR_RANGE_REQUESTS));
      },
      function lastRequest() {
        assert.ok(false, 'No fourth request because the third response ' + 
          'contained a full zip file.');
      },
    ]);
    ZipInfo.runGetEntriesOverHttp(function(params) {
      return requestHandlers.sendRequest(params);
    }, function(entries) {
      assert.strictEqual(requestHandlers.abortCount, 1, 'abort count');
      assert.strictEqual(requestHandlers.requestCount, 3, 'request count');
      assertEntriesEq(entries, getExpectedEntries());
      done();
    });
  });
});
