'use strict';

var MozContactConnector = (function MozContactConnector() {

  var serviceConnector = GmailConnector;

  var isOnLine = navigator.onLine;

  window.addEventListener('online', onLineChanged);
  window.addEventListener('offline', onLineChanged);

  function onLineChanged() {
    isOnLine = navigator.onLine;
  }

  /**
   * This function update changes made to an existing contact.
   *
   * Please note that this includes the deletion of said contact.
   */
  function updateContact(mozContactId, updatingContact) {

    if (updatingContact.deleted) {
      console.log('Will delete contact', mozContactId);
      return deleteMozContact(mozContactId).then(() => {
        localStorage.removeItem(updatingContact.uid);
        localStorage.removeItem('mozcontact#' + mozContactId);
        return {
          type: 'mozilla',
          action: 'deleted',
          id: mozContactId
        };
      });
    } else {
      console.log('Will update contact %s with', mozContactId,
                  updatingContact);
      var mozContactPromise = getMozContactById(mozContactId);
      var newContactPromise = createMozContact(updatingContact);
      return Promise.all([mozContactPromise, newContactPromise])
      .then(contacts => {
        var mozContact = contacts[0];
        var newContact = contacts[1];
        if (hasEtagChanged(mozContact)) {
          return Promise.reject(new Error('changed'));
        } else {
          return new window.contacts.Updater.update(mozContact, newContact);
        }
      }).then(saveMozContact)
      .then((contact) => {
        return {
          type: 'mozilla',
          action: 'updated',
          id: contact.id
        };
      });
    }
  }

  function pictureReady(serviceContact, blobPicture) {
    // Photo is assigned to the service contact as it is needed by the
    // Fb Connector
    if (!blobPicture) {
      return Promise.resolve(serviceContact);
    }

    return utils.thumbnailImage(blobPicture).then((thumbnail) => {
      if (blobPicture !== thumbnail) {
        serviceContact.photo = [blobPicture, thumbnail];
      } else {
        serviceContact.photo = [blobPicture];
      }
      return serviceContact;
    });
  }

  function createMozContact(serviceContact) {
    var promise;
    if (isOnLine === true) {
      // TODO maybe have this outside of this method.
      promise = OAuthManager.getAccessToken().then(accessToken => {
        return serviceConnector.downloadContactPicture(
          serviceContact,
          accessToken
        )
        .then(pictureReady.bind(this, serviceContact))
      })
      .catch((e) => {
        // a picture download fail does not block the save
        console.warn('Error while downloading picture for contact',
                     serviceContact, e);
        return serviceContact;
      });
    } else {
      promise = Promise.resolve(serviceContact);
    }
    return promise.then(serviceConnector.adaptDataForSaving);
  }

  function importContact(serviceContact) {
    if (serviceContact.isDeleted) {
      // We do not import contacts that are deleted remotely
      return Promise.resolve({action: 'none'});
    }
    return createMozContact(serviceContact)
    .then((contact) => saveMozContact(contact))
    .then((contact) => {
      // save mapping between google id and mozcontact id
      // using localstorage for now
      // we naively store both side of the relationship for now.
      // TODO replace by indexed DB ?
      localStorage.setItem('mozcontact#' + contact.id, serviceContact.uid);
      localStorage.setItem(serviceContact.uid, contact.id);
      addKnownMozId(contact.id);
      return {
        type: 'mozilla',
        action: 'added',
        id: contact.id

      };
    });
  }

  function getGoogleId(mozId) {
    return localStorage.getItem('mozcontact#' + mozId);
  }

  // TODO replace by indexed DB
  // This function supposes we do not track this contact already.
  function addKnownMozId(id) {
    var knownMozIdsStr = localStorage.getItem('knownMozIds');

    var knownMozIds;
    if (knownMozIdsStr) {
      knownMozIds = knownMozIdsStr.split(',');
    } else {
      knownMozIds = [];
    }
    knownMozIds.push(id);
    localStorage.setItem('knownMozIds', knownMozIds);
  }

  function removeKnownMozId(id) {
    var knownMozIdsStr = localStorage.getItem('knownMozIds');

    var knownMozIds;
    if (knownMozIdsStr) {
      knownMozIds = knownMozIdsStr.split(',');
    } else {
      knownMozIds = [];
    }

    // remove the ids
    var index = knownMozIds.indexOf(id);
    if (index > -1) {
      knownMozIds.splice(index, 1);
    }

    localStorage.setItem('knownMozIds', knownMozIds);
  }


  /**
   * Save a contact in the device DB. Return a promise that resolve to the
   * contact.
   *
   * It's useful because contact.id will then be populated.
   */
  function saveMozContact(deviceContact) {
    return new Promise(function(resolve, reject) {
      var contact = utils.misc.toMozContact(deviceContact);
      var req = navigator.mozContacts.save(contact);

      req.onsuccess = function() {
        // remember the 'updated' field.

        // So for some reason, updated and published field are still null there.
        // I *wish* I could simply do
        // rememberEtag(contact);
        // here
        getMozContactById(contact.id).then( realContact => {
          rememberEtag(realContact);
          resolve(realContact);
        });
      };
      req.onerror = reject;
    });
  }

  function deleteMozContact(id) {
    return new Promise(function(resolve, reject) {
      var contact = new mozContact();
      contact.id = id;
      var req = navigator.mozContacts.remove(contact);

      req.onsuccess = function() {
        removeKnownMozId(id);
        resolve();
      }
      req.onerror = reject;
    });
  }

  function getMozContactById(id) {
    return new Promise(function(resolve, reject) {
      var req = navigator.mozContacts.find({
        filterBy: ['id'],
        filterValue: [id],
        filterOp: 'equals'
      });

      req.onsuccess = function() {
        if (this.result.length === 0) {
          reject(new Error('no contact found'));
        } else {
          resolve(this.result[0]);
        }
      };

      req.onerror = reject
    });
  }

  /**
   * Get all the modified contact operations between from and to.
   *
   * WARNING: this method is really bad.
   *
   * Basically, it is because of the limitations of the contact API:
   * - we cannot filter by multiple values, so we cannot get only the contacts
   *   we're interested in (basically with a list of ids.)
   * - we cannot pass any predicate of any sort that would be useful for our
   *   purpose
   * - I initially planned to sort by 'updated' in descending order, that
   *   would at least make us able to stop the iteration somewhere. However,
   *   quoting mdn:
   *   "sortBy: A string representing the field by which the results of the
   *   search are sorted. Currently only givenName and familyName are
   *   supported."
   *   *Sigh!
   *
   * So we haven't any better choice to just loop through all the device
   * contacts to find modified contacts between 2 dates.
   *
   * Worse: we don't have *any* way to get a list of deleted contact. So in next
   * step, the * only thing we can do is loop through the managed ids to find
   * those that disappears from the getAll request.
   *
   * That makes a complexity of N*M with N number of devices contact and M
   * number of devices contact that are also in google DB, so potentially
   * N^2.
   *
   * Yep, that's what I meant by bad.
   */
  function getChangedMozContacts(from, to) {
    var foundContactByIds = new Map();
    return new Promise(function(resolve, reject) {
      var contacts = [];
      var req = navigator.mozContacts.getAll();
      req.onsuccess = function() {
        if (this.result ) {
          // remember all the ids to find deleted contact later.
          foundContactByIds.set(this.result.id, this.result);
          if ((!from || this.result.updated > from) &&
              (!to || this.result.updated < to) &&
              // ignoring contacts we inserted as a result of last sync
              hasEtagChanged(this.result)) {

            rememberEtag(this.result);
            contacts.push(this.result);
          }
          this.continue();
        } else {
          // we're done iterating
          resolve(contacts);
        }
      }
      req.onerror = reject;

    }).then(contacts => {
      var knownMozIdsStr = localStorage.getItem('knownMozIds');
      if (knownMozIdsStr) {
        var knownMozIds = knownMozIdsStr.split(',');
      } else {
        knownMozIds = [];
      }

      // find removed contacts
      knownMozIds.forEach( id => {
        if (!foundContactByIds.has(id)) {
          contacts.push({ id, isDeleted: true });
        }
      });

      // find created contacts
      for (var [id, contact] of foundContactByIds) {
        if (knownMozIds.indexOf(id) < 0) {
          contacts.push(contact);
        }
      }
      return contacts;
    });
  }

  function rememberEtag(contact) {
    localStorage.setItem('mozcontact-etag#' + contact.id,
                         contact.updated ? contact.updated.getTime() : 0);
  }

  function hasEtagChanged(mozContact) {
    var etag = +localStorage.getItem('mozcontact-etag#' + mozContact.id);
    // a null or invalid etag is considered as not changed.
    return etag ? etag != mozContact.updated.getTime() : false;
  }

  return {
    updateContact: updateContact,
    importContact: importContact,
    getChangedMozContacts: getChangedMozContacts,
    getGoogleId: getGoogleId
  };

})();
