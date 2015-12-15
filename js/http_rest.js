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

    function makeRequest(method, uri, pOptions, body) {
      return new Promise(function(resolve, reject) {
        var DEFAULT_TIMEOUT = 30000;
        var options = pOptions || {};

        var xhr = new XMLHttpRequest({
          // here is the reason why I don't use Fetch :-/
          // Google's cors implem is buggy: we need this.
          // Alternatively, we could use jsonp (it works with google)
          mozSystem: true
        });
        var outReq = new RestRequest(xhr);

        xhr.open(method, uri, true);
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
          resolve({ response: xhr[responseProperty], status: xhr.status });
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

        if (body) {
          xhr.send(body);
        } else {
          xhr.send();
        }
      }); // new Promise
    } // makeRequest

    function Rest() { }

    Rest.prototype = {

      get: makeRequest.bind(this, 'GET'),
      post: makeRequest.bind(this, 'POST'),
      put: makeRequest.bind(this, 'PUT')
    };

    return new Rest();
  })();
}
