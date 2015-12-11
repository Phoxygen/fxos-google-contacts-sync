/* globals Promise, SimplePhoneMatcher, utils, ContactPhotoHelper */

'use strict';

var contacts = window.contacts || {};

contacts.Updater = (function() {
  var DEFAULT_ADR_TYPE = 'home';
  var DEFAULT_TEL_TYPE = 'other';
  var DEFAULT_EMAIL_TYPE = 'other';

  // Performs an update of updatedContact with the info in updatingContact.
  // Atm every relevant info are replaced in updatedContact
  // In a future commit, this function will be able to report any conflict it
  // finds.
  function doUpdate(updatedContact, updatingContact) {
    return updateAll(updatedContact, updatingContact, true);
  }

  function isSimContact(contact) {
    return Array.isArray(contact.category) &&
                                        contact.category.indexOf('sim') !== -1;
  }

  function updateArrayField(updatedContact, updatingContact, fieldName, ignoreConflict) {
    if (ignoreConflict) {
      updatedContact[fieldName] = updatingContact[fieldName] || [];
    } else {
      // TODO report conflict
    }
  }

  function updateArrayFieldByField(updatedContact, updatingContact, fieldName,
                                   ignoreConflict) {
    if (ignoreConflict) {
      if (updatingContact[fieldName]) {
        for (var i = 0; i < updatingContact[fieldName].length; i++) {
          updatedContact[fieldName][i] = updatingContact[fieldName][i];
        }
      }
    } else {
      // TODO report conflict
    }
  }

  function updateField(updatedContact, updatingContact, fieldName, ignoreConflict) {
    if (ignoreConflict) {
      updatedContact[fieldName] = updatingContact[fieldName];
    } else {
      // TODO report conflict
    }
  }

  function updateAll(updatedContact, updatingContact, ignoreConflict) {
    return new Promise(function(resolve, reject) {
      var emailsHash;
      var categoriesHash;
      var telsHash;
      var updatedPhoto;

      var arrayFields = ['givenName', 'familyName', 'photo', 'adr', 'org',
        'url', 'tel', 'category', 'email', 'impp'];
      for (var arrayField of arrayFields) {
        updateArrayField(updatedContact, updatingContact, arrayField, ignoreConflict);
      }

      var fields = ['bday', 'anniversary'];
      for (var field of fields) {
        updateField(updatedContact, updatingContact, field);
      }

      // Special case for note: only the first note can be synchronized with
      // google
      updateArrayFieldByField(updatedContact, updatingContact, 'note',
                              ignoreConflict);

      updatedContact.name = [((updatedContact.givenName[0] ?
                             updatedContact.givenName[0] : '') + ' ' +
                            (updatedContact.familyName[0] ?
                              updatedContact.familyName[0] : '')).trim()];

      if (!Array.isArray(updatedContact.photo) || !updatedContact.photo[0] ||
          updatedContact.photo.length >= 2) {
        resolve(updatedContact);
        return;
      }

      updatedPhoto = updatedContact.photo[0];

      utils.thumbnailImage(updatedPhoto, function gotTumbnail(thumbnail) {
        if (updatedPhoto !== thumbnail) {
          updatedContact.photo = [updatedPhoto, thumbnail];
        } else {
          updatedContact.photo = [updatedPhoto];
        }
        resolve(updatedContact);
      });

    });
  }

  // TODO remove unused functions in the following

  function isDefined(field) {
    return (Array.isArray(field) && field[0] &&
            ((typeof field[0] === 'string' && field[0].trim().length > 0) ||
             typeof field[0] === 'object'));
  }

  function copyStringArray(source, dest) {
    if (Array.isArray(source)) {
      source.forEach(function(aVal) {
        if (aVal && aVal.trim()) {
          dest.push(aVal);
        }
      });
    }
  }

  function populateEmails(sourceEmails, hash, out) {
    if (Array.isArray(sourceEmails)) {
      sourceEmails.forEach(function(aEmail) {
        aEmail.type = Array.isArray(aEmail.type) ? aEmail.type : [aEmail.type];
        aEmail.type[0] = aEmail.type[0] || DEFAULT_EMAIL_TYPE;
        var value = aEmail.value;
        if (value && value.trim()) {
          value = value.toLowerCase();
          if (!hash[value]) {
            aEmail.value = value;
            out.push(aEmail);
            hash[value] = true;
          }
        }
      });
    }
  }

  function populateNoDuplicates(source, hash, out) {
    if (Array.isArray(source)) {
      source.forEach(function(aCat) {
        if (!hash[aCat]) {
          out.push(aCat);
          hash[aCat] = true;
        }
      });
    }
  }

  function populateField(source, destination, defaultType) {
    if (Array.isArray(source)) {
      // The easiest way to compare two objects is to compare their's
      // stringified JSON representations as strings. So we create
      // temporary Array with JSONs of the objects to compare.
      var stringifiedDestination = destination.map(function(element){
        return JSON.stringify(element);
      });

      source.forEach(function(as, index) {
        // If the source value and destination value is the same we
        // don't want to merge and will leave contact as it is. This
        // prevents duplication of the data like in Bug 935636
        if (stringifiedDestination.indexOf(JSON.stringify(as)) === -1) {
          if (defaultType && (!as.type || !as.type[0])) {
            as.type = [defaultType];
          }
          destination.push(as);
        }
      });
    }
  }

  return {
    update: doUpdate,
  };

})();
