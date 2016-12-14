/* globals ZipInfo, GM_xmlhttpRequest, Uint8Array */
'use strict';

ZipInfo.getRemoteEntries = function(url, onGotEntries) {
  function sendHttpRequest(params) {
    var onCompleted = params.onCompleted;
    var x = GM_xmlhttpRequest({
      responseType: 'arraybuffer',
      headers: params.rangeHeader ? {Range: params.rangeHeader} : {},
      onreadystatechange: function(response) {
        if (response.readyState === 2 && params.onHeadersReceived) {
          var headers = response.responseHeaders;
          params.onHeadersReceived(function(headerName) {
            headerName = headerName.toLowerCase() + ': ';
            var i = headers.toLowerCase().indexOf(headerName);
            if (i >= 0) {
              var end = headers.indexOf('\r\n', i + headerName.length);
              end = end === -1 ? headers.length : end;
              return headers.slice(i, end);
            }
          });
        }
        if (response.readyState === 4) {
          onCompleted(new Uint8Array(response.response || 0));
        }
      },
      url: url,
    });
    return {
      abort: function() {
        onCompleted = function() {};
        x.abort();
      },
    };
  }
  ZipInfo.runGetEntriesOverHttp(sendHttpRequest, onGotEntries);
};
