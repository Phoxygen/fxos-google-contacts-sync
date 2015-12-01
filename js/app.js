// DOMContentLoaded is fired once the document has been loaded and parsed,
// but without waiting for other external resources to load (css/images/etc)
// That makes the app more responsive and perceived as faster.
// https://developer.mozilla.org/Web/Reference/Events/DOMContentLoaded
window.addEventListener('DOMContentLoaded', function() {

  'use strict';

  var authorizeButton = document.getElementById('authorize-button');
  authorizeButton.onclick = () => {
    OAuthManager.start().then(enableImport).catch(disableImport);
  };
  window.addEventListener('tokenExpired', disableImport);

  var importButton = document.getElementById('import-contacts');
  importButton.onclick = startImport;

  var spinner = document.getElementById('spinner');
  var messageArea = document.getElementById('message-container');

  function enableImport() {
    importButton.style.display = '';
    authorizeButton.querySelector('div[data-l10n-id]').dataset.l10nId =
      'reauthorize';
    navigator.mozL10n.ready(() => {
      navigator.mozL10n.translate(authorizeButton);
    });
  }

  function disableImport() {
    importButton.style.display = 'none';
    authorizeButton.querySelector('div[data-l10n-id]').dataset.l10nId =
      'authorize';
    navigator.mozL10n.ready(() => {
      navigator.mozL10n.translate(authorizeButton);
    });
  }

  function showElement(elm, doTransition) {
    if (doTransition) {
      elm.classList.add('showing');
      setTimeout(() => {
        elm.classList.remove('showing');
        elm.classList.add('visible');
      }, 200);
    } else {
      elm.classList.add('visible');
    }
  }

  function hideElement(elm, doTransition) {
    elm.classList.remove('visible');
    if (doTransition) {
      elm.classList.add('hidding');
      setTimeout(() => {
        elm.classList.remove('hidding');
      }, 200);
    }
  }

  function showMessage(mess) {
    messageArea.querySelector('.message').innerHTML = mess;
    showElement(messageArea, false);
  }

  function displayResult(result) {
    console.log('Sync successfully finished!', result);
    var nbDeleted = 0;
    var nbUpdated = 0;
    var nbAdded = 0;
    for (var op of result) {
      switch (op.action) {
        case 'created':
          nbAdded++;
          break;
        case 'updated':
          nbUpdated++;
          break;
        case 'deleted':
          nbDeleted++;
          break;
      }
    }
    var message =
    showMessage(
      '<h2>Sync successfully finished:</h2>'+
      'Summary:<br>' +
      `<ul>
        <li>${nbAdded} contact(s) added</li>
        <li>${nbUpdated} contact(s) updated</li>
        <li>${nbDeleted} contact(s) deleted</li>
      </ul>`
    );
  }

  function startImport() {
    console.log('starting sync');

    var startSync = GmailConnector.startSync.bind(GmailConnector);
    var hideSpinner = hideElement.bind(this, spinner, false);

    showElement(spinner, true);
    OAuthManager.getAccessToken()
    .catch(OAuthManager.startOAuth)
    .then(startSync)
    .then(displayResult)
    .catch((e) => console.error(e))
    .then(hideSpinner);
  }

  // listener for ok button in message area
  messageArea.querySelector('.ok').addEventListener('click', (e) => {
    hideElement(messageArea, true);
  });

  // do we have a valid token?
  OAuthManager.getAccessToken().then(enableImport).catch(disableImport);

});
