'use strict';

(function() {
  var CHUNK_SIZE = 5;
  var LAST_SYNC_DATE_KEY = 'last_sync_date';

  window.ContactsImporter = function() {
    /* jshint validthis:true */

    var self = this;
    var serviceConnector = GmailConnector;

    this.startSync = function() {

      // FIXME store the result of getTime instead.
      var lastSyncDateStr = localStorage.getItem(LAST_SYNC_DATE_KEY);
      var lastSyncDate = lastSyncDateStr ? new Date(lastSyncDateStr) : null;
      if (lastSyncDate && isNaN(lastSyncDate.getTime())) {
        lastSyncDate = null;
      }

      var currentMozContacts = new Map();
      var currentGoogleContacts = new Map();

      var doStartSyncRun = startSyncRun.bind(this);

      var results = new Map();

      var to;
      return asyncWhileController(function *() {
         /*A sync can be not completable if a contact we try to update has been
         updated remotely in the meantime.
         In this case, we have to re-try a sync run.
         TODO as we now store etags for each contacts and test for its
         modification at each sync, it is actually useless to do a full sync
         pass. We can just requery and update one contact. This can simplify
          the algorithm a lot.*/
        var completableSync;
        // results for a run.
        var runResults;
        var from = lastSyncDate;
        do {
          to = new Date();
          ({
            completableSync,
            nextMozContacts: currentMozContacts,
            nextGoogleContacts: currentGoogleContacts,
            runResults
          } = yield doStartSyncRun(from,
                                   to,
                                   currentMozContacts,
                                   currentGoogleContacts)
          );
          // save the runResult, overriding previous results for the same
          // contact
          for (var [key, value] of runResults) {
            results.set(key, value);
          }
          from = to;
        } while (!completableSync);
      }).then(() => {
        localStorage.setItem(LAST_SYNC_DATE_KEY, to);
        var finalResults = [];
        for (var result of results.values()) {
          finalResults.push(result);
        }
        return finalResults;
      });
    };

    function getChangedMozContactsMap(previousMap, from, to) {
      return MozContactConnector.getChangedMozContacts(from, to)
      .then(contacts => {
        for (var mozContact of contacts) {
          previousMap.set(mozContact.id, mozContact);
        }
        return previousMap;
      });
    }

    function getChangedGoogleContactsMap(previousMap, from, to) {
      return OAuthManager.getAccessToken().then(accessToken => {
        return serviceConnector.listUpdatedContacts(accessToken, from, to)
        .then((contacts) => {
          for (var googleContact of contacts.data) {
            previousMap.set(googleContact.uid, googleContact);
          }
          return previousMap;
        });

      });
    }

    function startSyncRun(from, to, currentMozContacts, currentGoogleContacts) {
      console.log('Starting sync run', from, to, currentMozContacts,
                  currentGoogleContacts);
      var nextMozContacts = new Map();
      var nextGoogleContacts = new Map();
      var runResults = new Map();
      var completableSync = true;
      // get google contacts modification feed
      var googlePromise = getChangedGoogleContactsMap(currentGoogleContacts,
                                                      from,
                                                      to);
      // get mozcontacts modification feed
      var mozPromise = getChangedMozContactsMap(currentMozContacts,
                                                from,
                                                to);
      return Promise.all([googlePromise, mozPromise]).then(() => {

        // loop through the mozContact and deal with changes that can have
        // been made on both side for these contacts
        var updatePromises = [];
        for (var mozContact of currentMozContacts.values()) {
          updatePromises.push(handleModifiedMozContact(mozContact,
                                                      currentGoogleContacts,
                                                      nextMozContacts,
                                                      nextGoogleContacts)
          .catch(e => {
            if (e == 'changed') {
              completableSync = false;
            } else {
              // other error, propagate
              return Promise.reject(e);
            }
          }));
        }

        return Promise.all(updatePromises);
      }).then(currentResults => {
        currentResults.forEach(result => {
          // When the contact has changed remotely, the catch above will return
          // a promise that resolves with undefined. Exclude those, are they are
          // not really "results" yet
          if (result) {
            runResults.set(result.id, result);
          }
        });
      }).then(() => {
        // loop through the remaining google contacts
        var updatePromises = [];
        for (var googleContact of currentGoogleContacts.values()) {
          // deal with modified google contacts that haven't been modified
          // locally too (if so, we have already dealt with them)
          updatePromises.push(handleModifiedGoogleContact(googleContact,
                                                          nextGoogleContacts)
          .catch(e => {
            if (e.message == 'changed') {
              completableSync = false;
            } else {
              return Promise.reject(e);
            }
          }));
        }
        return Promise.all(updatePromises);
      }).then(currentResults => {
        currentResults.forEach(result => {
          // When the contact has changed remotely, the catch above will return
          // a promise that resolves with undefined.
          if (result) {
            runResults.set(result.id, result);
          }
        });
      }).then(() => {
        return {
          completableSync,
          nextMozContacts,
          nextGoogleContacts,
          runResults
        };
      });
    };

    function handleModifiedGoogleContact(googleContact, nextGoogleContacts) {
      var currentPromise;
      var mozId = localStorage.getItem(googleContact.uid);
      if (mozId != null) {
        currentPromise = MozContactConnector.updateContact(
          mozId,
          googleContact
        ).catch((e) => {
          if (e.message === 'changed') {
            nextGoogleContacts.set(googleContact.uid, googleContact);
          }
          return Promise.reject(e);
        });
      } else {
        // it does not exist in local DB. add it.
        currentPromise = MozContactConnector.importContact(googleContact);
      }
      return currentPromise;
    }

    function handleModifiedMozContact(mozContact,
                                      currentGoogleContacts,
                                      nextMozContacts,
                                      nextGoogleContacts) {
      var currentPromise;
      var googleID = MozContactConnector.getGoogleId(mozContact.id);
      if (googleID) {
        if (currentGoogleContacts.has(googleID)) {
          // this contact have been modified both in the mozContact DB and
          // in the google server. We therefore have a conflict.
          var googleContact = currentGoogleContacts.get(googleID);

          // simple heuristic: the most recently updated win.
          // FIXME we should implement a full conflict resolution system.
          if (googleContact.updated <  mozContact.updated) {
            // mozcontact wins
            currentPromise = OAuthManager.getAccessToken().then( accessToken => {
              return serviceConnector.updateContact(googleID,
                                                    mozContact,
                                                    accessToken);
            }).catch((e) => {
              if (e.message == 'changed') {
                nextMozContacts.set(mozContact.id, mozContact);
              }
              return Promise.reject(e);
            });
          } else {
            // google contact wins
            currentPromise = MozContactConnector.updateContact(
              mozContact.id,
              googleContact
            ).catch((e) => {
              if (e.message == 'changed') {
                nextGoogleContacts.set(googleID, googleContact);
              }
              return Promise.reject(e);
            });
          }
          currentGoogleContacts.delete(googleID);
        } else {
          // it hasn't been modified on google side, send update.
          currentPromise = OAuthManager.getAccessToken().then( accessToken => {
            return serviceConnector.updateContact(googleID,
                                                  mozContact,
                                                  accessToken)
          })
          .catch((e) => {
            if (e.message == 'changed') {
              nextMozContacts.set(mozContact.id, mozContact);
            }
            return Promise.reject(e);
          });
        }
      } else {
        // in mozcontact, but not in google, insert it in google
        currentPromise = serviceConnector.addNewContact(mozContact);
      }
      return currentPromise;
    }

  };
})();
