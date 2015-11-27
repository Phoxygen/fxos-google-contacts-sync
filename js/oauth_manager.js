/**
 * OauthManager - handle the oauth process.
 *
 * This object exposess these methods:
 * - startOauth: to start the oauth process (regardless of our current
 *   state)
 * - getAccessToken: get the access token if we have one
 *
 * Moreover, it fires a 'tokenExpired' even you can listen to react on
 * expiration of token (to make UI change for example)
 */
window.addEventListener('DOMContentLoaded', () => {
  'use strict';

  var ACCESS_TOKEN_KEY = 'access_token';
  var TOKEN_VALIDITY_KEY = 'token_validity';

  // clientId from the Google Developer Console.
  // We might want to change this with a Phoxygen one.
  var clientId =
    '265634177893-rejd6a9m1d2q1g5a4pu1tive751g4akm.apps.googleusercontent.com';

  // url encoded scope of google contacts API.
  var scopes = 'https%3A%2F%2Fwww.google.com%2Fm8%2Ffeeds';

  var oauthWindow;
  var tokenDeferred;
  var accessToken;
  var tokenValidity;

  // listener for oauth redirect
  // See oauth_frame/handle_response.js and the redirect in the manifest.
  window.addEventListener('message', tokenDataReady);

  function persistState(parameters) {
    accessToken = parameters.access_token;
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    tokenValidity = new Date(Date.now() + parameters.expires_in * 1000);
    localStorage.setItem(TOKEN_VALIDITY_KEY, tokenValidity);
  }

  function loadState() {
    accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    tokenValidity = new Date(localStorage.getItem(TOKEN_VALIDITY_KEY));
  }

  function startOauth() {
    var url = `https://accounts.google.com/o/oauth2/auth?scope=${scopes}` +
      `&redirect_uri=https%3A%2F%2Fphoxygen.eu%2Foauth_result` +
      `&response_type=token&client_id=${clientId}&approval_prompt=force` +
      `&state=friends`;
    oauthWindow = window.open(url, '', 'dialog');
    tokenDeferred = {};
    tokenDeferred.promise = new Promise(function(resolve, reject) {
      tokenDeferred.resolve = resolve;
      tokenDeferred.reject = reject;
    });
    // this promise will be resolved in tokenDataReady with the accessToken.
    return tokenDeferred.promise;
  }

  function getAccessToken() {
    return new Promise(function(resolve, reject) {
      var timeEnable;
      if (!accessToken || !tokenValidity) {
        timeEnable = -1
      } else {
        timeEnable = tokenValidity - Date.now();
      }

      if (timeEnable > 0) {
        resolve(accessToken);
      } else {
        reject(new Error('Expired'));
      }
    });
  }

  // This function receives the post message from the iframe that get opened by
  // the google oauth process. This message contains the accessToken
  function tokenDataReady(e) {
    var parameters = e.data;
    if (e.origin !== location.origin) {
      return;
    }
    if (!parameters || !parameters.access_token) {
      return;
    }

    persistState(parameters);

    // notify listener when token expires.
    setTimeout(
      () => window.dispatchEvent(new CustomEvent('tokenExpired')),
        parameters.expires_in * 1000
    );
    tokenDeferred.resolve(parameters.access_token);
  }

  loadState();

  window.OauthManager = {
    start: startOauth,
    getAccessToken: getAccessToken
  };

});
