'use strict';

if (!window.Rest) {
  window.Rest = (function() {

    function RestRequest(xhr) {
      var cancelled = false;
      this.cancel = function oncancel() {
        cancelled = true;
        window.setTimeout(xhr.abort.bind(xhr), 0);
      };
      this.isCancelled = function isCancelled() {
        return cancelled;
      };
    }

    function Rest() { }

    Rest.prototype = {
      get: function(uri, pOptions) {
        return new Promise(function(resolve, reject) {
          var DEFAULT_TIMEOUT = 30000;
          var options = pOptions || {};

          var xhr = new XMLHttpRequest({
            mozSystem: true
          });
          var outReq = new RestRequest(xhr);

          xhr.open('GET', uri, true);
          var responseType = options.responseType || 'json';
          xhr.responseType = responseType;
          var responseProperty = responseType === 'xml' ?
            'responseXML' : 'response';

          xhr.timeout = options.operationsTimeout || DEFAULT_TIMEOUT;
          if (!xhr.timeout || xhr.timeout === DEFAULT_TIMEOUT &&
             (parent && parent.config && parent.config.operationsTimeout)) {
            xhr.timeout = parent.config.operationsTimeout;
          }

          if (options.requestHeaders) {
            for (var header in options.requestHeaders) {
              xhr.setRequestHeader(header, options.requestHeaders[header]);
            }
          }

          xhr.onload = function(e) {
            if (xhr.status === 200 || xhr.status === 400 || xhr.status === 0) {
              resolve(xhr[responseProperty]);
            } else {
              console.error('HTTP error executing GET. ',
                                 uri, ' Status: ', xhr.status);

              var error = new Error('HTTP error');
              error.cause = { status: xhr.status };
              reject(error);
            }
          }; // onload

          xhr.ontimeout = function(e) {
            console.error('Timeout!!! while HTTP GET: ', uri);
            var error = new Error('timeout');
            reject(error);
          }; // ontimeout

          xhr.onerror = function(e) {
            console.error('Error while executing HTTP GET: ', uri,
                                     ': ', e);
            reject(e);
          }; // onerror

          xhr.send();
        }); // new Promise
      } // get
    };  // prototype

    return new Rest();
  })();
}
