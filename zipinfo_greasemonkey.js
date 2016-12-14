/* globals ZipInfo, GM_xmlhttpRequest, Uint8Array */
/* jshint esversion: 6 */
'use strict';

ZipInfo.getRemoteEntries = function(url, onGotEntries) {
  let sendHttpRequest = ({
    rangeHeader,
    onHeadersReceived,
    onCompleted,
  }) => {
    let onreadystatechange;
    if (onHeadersReceived) {
      onreadystatechange = ({responseHeaders, readyState}) => {
        if (readyState === 2 && onHeadersReceived) {
          onHeadersReceived((headerName) => {
            headerName = headerName.toLowerCase() + ': ';
            let i = responseHeaders.toLowerCase().indexOf(headerName);
            if (i >= 0) {
              let end = responseHeaders.indexOf(
                '\r\n', i + headerName.length);
              end = end === -1 ? responseHeaders.length : end;
              return responseHeaders.slice(i, end);
            }
            return '';
          });
        }
      };
    }
    let {abort} = GM_xmlhttpRequest({
      responseType: 'arraybuffer',
      headers: rangeHeader ? {Range: rangeHeader} : {},
      onreadystatechange,
      onload: ({response}) => onCompleted(new Uint8Array(response)),
      onerror: () => onCompleted(new Uint8Array()),
      url,
    });
    return {
      abort() {
        onCompleted = () => {};
        abort();
      }
    };
  };
  ZipInfo.runGetEntriesOverHttp(sendHttpRequest, onGotEntries);
};
