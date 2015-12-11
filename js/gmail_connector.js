/* globals Rest */

/* exported GmailConnector */

'use strict';

/*
  Gmail Contacts connector

  Provides the capabilities to connect to the Gmail Contacts service
  and return the contacts on a readable and importable format.
*/
var GmailConnector = (function GmailConnector() {

  // Google contacts service end point,
  // force a huge number of contacts to not paginate :S
  var END_POINT =
    'https://www.google.com/m8/feeds/contacts/default/full/?max-results=10000';
  var GROUPS_END_POINT =
    'https://www.google.com/m8/feeds/groups/default/full/';
  var UPDATE_END_POINT =
    'https://www.google.com/m8/feeds/contacts/default/full'
  var EXTRA_HEADERS = {
    'GData-Version': '3.0'
  };
  var GD_NAMESPACE = 'http://schemas.google.com/g/2005';
  var ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';
  var GD_IM_PROTOCOL = {
    "AIM": "http://schemas.google.com/g/2005#AIM",
    "MSN": "http://schemas.google.com/g/2005#MSN",
    "YAHOO": "http://schemas.google.com/g/2005#YAHOO",
    "SKYPE": "http://schemas.google.com/g/2005#SKYPE",
    "QQ": "http://schemas.google.com/g/2005#QQ",
    "GOOGLE_TALK": "http://schemas.google.com/g/2005#GOOGLE_TALK",
    "ICQ": "http://schemas.google.com/g/2005#ICQ",
    "JABBER": "http://schemas.google.com/g/2005#JABBER",
  }

  var CATEGORY = 'gmail';
  var URN_IDENTIFIER = 'urn:service:gmail:uid:';

  // global utils object
  var entryParser = new DOMParser();
  var entrySerializer = new XMLSerializer();

  // Will be used as a cache for the thumbnail url for each contact
  var photoUrls = {};

  // In some cases we will need the access token, cache a copy
  var accessToken = null;

  // We have a xml response from Google, all the entries in an array,
  // no matter if they are xml entries.
  // Despite of being a node, inject a 'uid' as this will be necessary
  // for the selection
  var nodeListToArray = function nodeListToArray(response) {
    var entries = response.getElementsByTagName('entry');
    var contacts = [];
    var numContacts = entries.length;
    for (var i = 0; i < numContacts; i++) {
      var currentEntry = entries[i];
      var oldEntry = getXMLEntry(getUid(currentEntry));
      var jsonContact = gContactToJson(currentEntry);

      // We only keep those whose etag changed
      if ( !oldEntry || jsonContact.etag !== getEtag(oldEntry)) {
        if (jsonContact.deleted) {
          // delete the entry in localstorage
          localStorage.removeItem('gContact#' + jsonContact.uid);
        } else {
          // store the xml for later update
          localStorage.setItem(
            'gContact#' + jsonContact.uid,
            entrySerializer.serializeToString(currentEntry)
          );
        }
        contacts.push(jsonContact);
      }
    }
    return contacts;
  };

  // Returns the object used to build the headers necesary by the service
  var buildRequestHeaders = function buildRequestHeaders(accessToken) {
    var requestHeaders = EXTRA_HEADERS;
    requestHeaders.Authorization = 'OAuth ' + accessToken;

    return requestHeaders;
  };

  /**
   * This method constructs a Headers object to use when doing PUT for
   * updating/creating contacts
   */
  var buildPutHeaders = function buildPutHeaders(accessToken, etag) {
    var headers = buildRequestHeaders(accessToken);
    headers['If-Match'] = etag;
    headers['Content-Type'] = 'application/atom+xml';
    return headers;
  }

  var listUpdatedContacts =
  function listUpdatedContacts(accessToken, from, to) {
    photoUrls = {};
    return getContactsGroupId(accessToken).then((id) => {
      return getContactsByGroup(id, accessToken, from, to);
    });
  };

  var getContactsGroupId = function getContactsGroupId(accessToken) {
    return performAPIRequest(GROUPS_END_POINT, accessToken)
      .then((response) => {
        // Locate the entry witch systemGroup id is 'Contacts'
        var feed = response.querySelector('feed');
        if (feed === null) {
          return Promise.reject('feed is null');
        }

        var sgc = feed.querySelector('systemGroup[id="Contacts"]');
        if (sgc !== null) {
          // return id
          return sgc.parentNode.querySelector('id').textContent;
        } else {
          Promise.reject('No systemGroup with id "Contacts" found');
        }
    });
  };

  // Retrieve all the contacts for the specific groupId
  var getContactsByGroup = function getContactsByGroup(groupId,
                                                       accessToken,
                                                       updatedMin,
                                                       updatedMax) {

    var groupUrl = END_POINT + '&group=' + groupId;
    if (updatedMin) {
      groupUrl += '&updated-min=' + updatedMin.toISOString();
      // if we ask for a timerange, we want to know about deletion operations as
      // well.
      groupUrl += '&showdeleted=true';
    }
    if (updatedMax) {
      groupUrl += '&updated-max=' + updatedMax.toISOString();
    }
    return performAPIRequest(groupUrl, accessToken).then((response) => {
      // extract updated
      var updated = new Date(response.querySelector('updated').textContent);
      return {
        'data': nodeListToArray(response),
        'updated': updated
      };
    });
  };

  // Given a Google contacts api url add the authentication and
  // extra headers to perform the correct request
  var performAPIRequest = function performAPIRequest(url, accessToken) {
    return Rest.get(url, {
      'requestHeaders': buildRequestHeaders(accessToken),
      'responseType': 'xml'
    }).then(result => {
      if (result.status == 200) {
        return Promise.resolve(result.response);
      } else {
        return Promise.reject(new Error(`Error when executing request with url
                                        ${url}: ${result.status}`));
      }
    });
  };

  var addNewContact = function addNewContact(mozContact) {
    // TODO implement
    return new Promise(function(resolve, reject) {
      console.log('Adding contact to google', mozContact);
      //TODO MozContactConnector.rememberEtag(mozContact);
      resolve({
        type: 'google',
        action: 'added',
        id: 'nope'
      });
    });
  };

  var getXMLEntry = function getXMLEntry(id) {
    var entryStr = localStorage.getItem('gContact#' + id);
    if (!entryStr) {
      return null;
    }

    return entryParser.parseFromString(entryStr, 'application/xml').
      documentElement;
  };

  var updateContactEntry = function(id, updatingContact) {
    var entry = getXMLEntry(id);
    if (!entry) {
      throw new Error('No entry for gContact ' + id);
    }
    var isDeleted =
      entry.getElementsByTagNameNS(GD_NAMESPACE, 'deleted').length > 0;
    if (isDeleted) {
      throw new Error('You are trying to update a deleted contact');
    }

    var name = entry.querySelector('name');
    if (name) {
      setValueFromArrayForNode(name, 'fullName', updatingContact.name);
      setValueFromArrayForNode(name, 'givenName', updatingContact.givenName);
      setValueFromArrayForNode(name, 'additionalName',
                      updatingContact.additionalName);
      setValueFromArrayForNode(name, 'familyName',
                               updatingContact.familyName);
      setValueFromArrayForNode(name, 'namePrefix',
                               updatingContact.honorificPrefix);
      setValueFromArrayForNode(name, 'nameSuffix',
                               updatingContact.honorificSuffix);
    }

    // email
    // remove old elem
    for (var emailTag of entry.querySelectorAll('email')) {
      emailTag.parentNode.removeChild(emailTag);
    }
    // create new elem
    for (var email of updatingContact.email) {
      var elm = document.createElementNS(GD_NAMESPACE, 'email');
      // deal with type
      var type = email.type.length === 0 ? '' : email.type[0];
      if (type === 'work' || type === 'home' || type === 'other') {
        elm.setAttribute('rel', `http://schemas.google.com/g/2005#${type}`);
      } else {
        elm.setAttribute('label', type);
      }
      // deal with address
      elm.setAttribute('address', email.value);
      elm.setAttribute('primary', !!email.pref);
      entry.appendChild(elm);
    }

    // IM
    for (var imTag of entry.querySelectorAll('im')) {
      imTag.parentNode.removeChild(imTag);
    }
    for (var impp of updatingContact.impp) {
      var elm = document.createElementNS(GD_NAMESPACE, 'im');
      elm.setAttribute('address', impp.value);
      elm.setAttribute('primary', !!impp.pref);

      var type = impp.type.length === 0 ? '' : impp.type[0];
      if (type === 'work' || type === 'home' || type === 'other' ||
          type === 'netmeeting') {
        elm.setAttribute('rel', `http://schemas.google.com/g/2005#${type}`);
      } else {
        elm.setAttribute('label', type);
      }
      if (impp.type && impp.type.length > 1) {
        var protocol = impp.type[1];
        elm.setAttribute('protocol', GD_IM_PROTOCOL[protocol] || protocol);
      }
      entry.appendChild(elm);
    }

    // note
    // we can synchronize only the first note
    var content = entry.querySelector('content');
    var note = updatingContact.note ? updatingContact.note[0] : null;
    if (note) {
      if (!content) {
        content = document.createElementNS(ATOM_NAMESPACE, 'content');
        entry.appendChild(content);
      }
      content.textContent = note;
    } else if (content) {
      content.parentNode.removeChild(content);
    }


    // phone
    for (var phoneTag of entry.querySelectorAll('phoneNumber')) {
      phoneTag.parentNode.removeChild(phoneTag);
    }
    // we hook a few elements to known element to google, to nicely select in
    // the google dropdown list.
    // We won't try to be too clever here. For example, we have a #home in both
    // side, but it appears as Personal in google, but we also have a personal
    // builtin type in MozContact... In this mess, better not try to fix
    // everything. Less code, less bugs, less data loss.
    var TEL_TYPE_REL_MAP = {
      'faxOffice' : GD_NAMESPACE + '#work_fax',
      'faxHome' : GD_NAMESPACE + '#home_fax',
      'work': GD_NAMESPACE + '#work',
      'home': GD_NAMESPACE + '#home',
      'mobile': GD_NAMESPACE + '#mobile',
      'pager': GD_NAMESPACE + '#pager'
    };
    // so google displays a label (NOT a rel!) of grandcentral as Google
    // Voice... Wow!
    var TEL_TYPE_LABEL_MAP = {
      'Google Voice': 'grandcentral'
    }
    for (var tel of updatingContact.tel) {
      var elm = document.createElementNS(GD_NAMESPACE, 'phoneNumber');
      var type = tel.type.length === 0 ? '' : tel.type[0];
      if (TEL_TYPE_REL_MAP[type]) {
        elm.setAttribute('rel', TEL_TYPE_REL_MAP[type])
      } else {
        elm.setAttribute('label', TEL_TYPE_LABEL_MAP[type] || type);
      }
      elm.setAttribute('primary', !!tel.pref);
      elm.textContent = tel.value;
      entry.appendChild(elm);
    }

    // TODO organization
    // TODO address
    // TODO place ?
    // TODO extended fields: store the rest of datas:
    // - nickname
    // - url ?
    // - category ?
    // - bday ?
    // - anniversary ?
    // - sex
    // - gender identity
    // - key
    //


    // TODO deal with photo update.

    return entry;
  };

  var getEditUrl = function getEditUrl(entry) {
    return entry.querySelector('link[rel="edit"]').getAttribute('href');
  };

  var updateContact = function updateContact(id, updatingContact, accessToken) {

    if (updatingContact.isDeleted) {
      // TODO
      console.log('Will delete contact ', id);
      return Promise.resolve();
    }

    var entry = updateContactEntry(id, updatingContact);

    var url = getEditUrl(entry);

    return Rest.put(url, {
      'requestHeaders': buildPutHeaders(accessToken, getEtag(entry)),
      'responseType': 'xml'
    }, entrySerializer.serializeToString(entry))
    .then( result => {
      if (result.status == 200) {
        localStorage.setItem('gContact#' + id,
          entrySerializer.serializeToString(result.response.documentElement));
        return {
          type: 'google',
          action: 'updated',
          id
        };
      } else if (result.status == 412) {
        throw new Error('changed');
      } else {
        throw new Error(`Error when PUTing on url ${url}: ${result.status}`);
      }
    });

    /*return fetch('url', {
      method: 'PUT',
      headers: buildPutHeaders(accessToken, getEtag(entry)),
      body: entry,
      mode: 'no-cors'
    })
    .then( response => {
      if (response.status == 412) {
        // google contact has changed remotely
        return Promise.reject(new Error('changed'));
      } else if (response.status == 200) {
        MozContactConnector.rememberEtag(updatingContact);
        return {
          type: 'google',
          action: 'updated',
          id: id
        }
      } else {
        return Promise.reject(new Error(
          `Error when updating contact:
          ${response.status} - ${response.statusText}`
        ));
      }
    });
    */
  };

  var getValueForNode = function getValueForNode(doc, name, def) {
    var defaultValue = def || '';

    if (doc == null || name == null) {
      return defaultValue;
    }

    var node = doc.querySelector(name);

    if (node && node.textContent) {
      return node.textContent;
    }

    return defaultValue;
  };

  var setValueFromArrayForNode =
    function setValueFromArrayForNode(doc, name, array) {
    if (!array || array.length === 0 || !array[0] || array[0] === '') {
      // nothing to do
      return;
    }
    if (!doc) {
      throw new Error('doc is null');
    }

    var node = doc.querySelector(name);

    if (!node) {
      node = document.createElementNS(GD_NAMESPACE, 'additionalName');
      doc.appendChild(node);
    }
    node.textContent = array[0];
  };

  var adaptDataForSaving = function adaptDataForSaving(contact) {
    return contact;
  };

  var isDeleted = function isDeleted(contact) {
    return contact.getElementsByTagNameNS(GD_NAMESPACE, 'deleted').length > 0;
  };

  var getUpdated = function getUpdated(contact) {
    var date = new Date(contact.querySelector('updated').textContent);
    if (isNaN(date.getTime())) {
      // sanity check, even if at the moment of writing google conveniently
      // sends date in the right format.
      return new Date(0);
    } else {
      return date;
    }
  };

  // Transform a Google contact entry into json format.
  // The json format is the same used in Contacts api ;P
  var gContactToJson = function gContactToJson(googleContact) {
    var output = {};
    // This field will be needed for indexing within the
    // import process, not for the api
    output.uid = getUid(googleContact);
    output.etag = getEtag(googleContact);
    output.updated = getUpdated(googleContact)

    if (isDeleted(googleContact)) {
      output.deleted = true;
      // early return in this case: we only need to know it has been deleted.
      return output;
    }

    output.name = [getValueForNode(googleContact, 'title')];

    // Store the photo url, not in the contact itself
    var photoUrl = googleContact.querySelector('link[type="image/*"]');
    if (photoUrl) {
      photoUrl = photoUrl.getAttribute('href');
    } else {
      // No image link
      photoUrl = '';
    }
    photoUrls[output.uid] = photoUrl;

    var name = googleContact.querySelector('name');
    if (name) {
      var contactName = getValueForNode(name, 'givenName');
      if (contactName) {
        output.givenName = [contactName];
      }
      var contactFamilyName = getValueForNode(name, 'familyName');
      if (contactFamilyName) {
        output.familyName = [contactFamilyName];
      }
      var contactSuffix = getValueForNode(name, 'additionalName');
      if (contactSuffix) {
        output.additionalName = [contactSuffix];
      }
    }

    output.email = parseEmails(googleContact);

    output.impp = parseIms(googleContact);

    output.adr = parseAddress(googleContact);

    output.tel = parsePhones(googleContact);

    var org = googleContact.querySelector('organization');
    if (org) {
      output.org = [getValueForNode(org, 'orgName')];
      output.jobTitle = [getValueForNode(org, 'orgTitle')];
    }

    var bday = googleContact.querySelector('birthday');
    if (bday) {
      var bdayMS = Date.parse(bday.getAttribute('when'));
      if (!isNaN(bdayMS)) {
        output.bday = new Date(bdayMS);
      }
    }

    var content = googleContact.querySelector('content');
    if (content) {
      output.note = [content.textContent];
    }

    output.category = [CATEGORY];
    output.url = [{
      type: ['source'],
      value: getContactURI(output)
    }];

    return output;
  };

  var getContactURI = function getContactURI(contact) {
    return URN_IDENTIFIER + contact.uid;
  };

  // This will be a full url like:
  // http://www.google.com/m8/feeds/contacts/<email>/base/<contact_id>
  // for a specific contact node
  var getUid = function getUid(contact) {
    return contact.querySelector('id').textContent;
  };

  var getEtag = function getEtag(contact) {
    return contact.getAttributeNS(GD_NAMESPACE, 'etag');
  };

  /**
   * This function parse the type of a mean of contact from google such as tel,
   * email, im etc...
   * The type information is either, in this priority order:
   * - a rel element with predefined values such as
   *   http://schemas.google.com/g/2005#home (possible value are #home, #work,
   *   #other, and #netmeeting for im)
   * - a label element for custom types
   *
   */
  var parseType = function parseType(contactField) {
    var DEFAULT_TYPE = 'other';
    var type = contactField.getAttribute('rel') ||
      contactField.getAttribute('label') ||
      DEFAULT_TYPE;
    if (type.indexOf('#' > -1)) {
      type = type.substr(type.indexOf('#') + 1);
    }
    return type;
  };

  // Returns an array with the possible emails found in a contact
  // as a ContactField format
  var parseEmails = function parseEmails(googleContact) {
    var DEFAULT_EMAIL_TYPE = 'other';
    var emails = [];
    var fields = googleContact.getElementsByTagNameNS(GD_NAMESPACE, 'email');
    if (fields && fields.length > 0) {
      for (var i = 0; i < fields.length; i++) {
        var emailField = fields.item(i);
        emails.push({
          'type': [parseType(emailField)],
          'value': emailField.getAttribute('address'),
          'pref': emailField.getAttribute('primary')
        });
      }
    }
    return emails;
  };

  var parseIms = function parseIms(googleContact) {
    var DEFAULT_IM_TYPE = 'other';
    var ims = [];
    var fields = googleContact.getElementsByTagNameNS(GD_NAMESPACE, 'im');
    if (fields) {
      for (var imTag of fields) {
        var protocol = imTag.getAttribute('protocol');
        if (protocol.indexOf('#') > -1) {
          protocol = protocol.substr(protocol.indexOf('#') + 1);
        }
        ims.push({
          'type': [parseType(imTag), imTag.getAttribute('protocol')],
          'value': imTag.getAttribute('address'),
          'pref': imTag.getAttribute('primary')
        });
      }
    }
    return ims;
  };

  // Given a google contact returns an array of ContactAddress
  var parseAddress = function parseAddress(googleContact) {
    var addresses = [];
    var fields = googleContact.getElementsByTagNameNS(GD_NAMESPACE,
      'structuredPostalAddress');
    if (fields && fields.length > 0) {
      for (var i = 0; i < fields.length; i++) {
        var field = fields.item(i);
        var address = {};

        address.streetAddress = getValueForNode(field, 'street');
        address.locality = getValueForNode(field, 'city');
        address.region = getValueForNode(field, 'region');
        address.postalCode = getValueForNode(field, 'postcode');
        address.countryName = getValueForNode(field, 'country');

        addresses.push(address);
      }
    }
    return addresses;
  };

  // Given a google contact this function returns an array of
  // ContactField with the pones stored for that contact
  var parsePhones = function parsePhones(googleContact) {
    var DEFAULT_PHONE_TYPE = 'other';
    // we only change what are obvious correspondance.
    var GMAIL_MAP = {
      'work_fax' : 'faxOffice',
      'home_fax' : 'faxHome',
      'grandcentral': 'Google Voice'
    };
    var phones = [];
    var fields = googleContact.getElementsByTagNameNS(GD_NAMESPACE,
      'phoneNumber');
    if (fields && fields.length > 0) {
      for (var i = 0; i < fields.length; i++) {
        var field = fields.item(i);
        var type = parseType(field);

        phones.push({
          'type': [ GMAIL_MAP[type] || type],
          'value': field.textContent
        });
      }
    }

    return phones;
  };

  var downloadContactPicture = function downloadContactPicture(googleContact,
    accessToken) {
    var url = buildContactPhotoURL(googleContact, accessToken);
    return Rest.get(url, { 'responseType': 'blob' }).then( result => {
      if (result.status == 200) {
        return result.response;
      } else {
        throw new Error(result.status);
      }
    });
  };

  // Build the url of the photo with the access token
  var buildContactPhotoURL = function contactPhotoURL(contact, accessToken) {
    if (photoUrls && photoUrls[contact.uid]) {
      return photoUrls[contact.uid] + '?access_token=' + accessToken;
    }

    return null;
  };

  var getAutomaticLogout = (function getAutomaticLogout() {
    return true;
  })();

  return {
    'listUpdatedContacts': listUpdatedContacts,
    'addNewContact': addNewContact,
    'updateContact': updateContact,
    'adaptDataForSaving': adaptDataForSaving,
    'downloadContactPicture': downloadContactPicture,
  };

})();
