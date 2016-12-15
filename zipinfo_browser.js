/* globals ZipInfo, XMLHttpRequest, Uint8Array */
'use strict';

ZipInfo.getRemoteEntries = function(url, onGotEntries) {
  function sendHttpRequest(params) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    if (params.rangeHeader) {
      params.setRequestHeader('Range', params.rangeHeader);
    }
    x.onreadystatechange = params.onHeadersReceived && function() {
      if (x.readyState === 2) {
        params.onHeadersReceived(x.getResponseHeader.bind(x));
      }
    };
    x.onloadend = function() {
      params.onCompleted(new Uint8Array(x.response || 0));
    };
    x.send();
    return {
      abort: function() {
        x.onreadystatechange = x.onloadend = null;
        x.abort();
      }
    };
  }
  ZipInfo.runGetEntriesOverHttp(sendHttpRequest, onGotEntries);
};
