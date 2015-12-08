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
  var EXTRA_HEADERS = {
    'GData-Version': '3.0'
  };
  var GD_NAMESPACE = 'http://schemas.google.com/g/2005';

  var CATEGORY = 'gmail';
  var URN_IDENTIFIER = 'urn:service:gmail:uid:';

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
      contacts.push(gContactToJson(entries[i]));
    }

    return contacts;
  };

  // Returns the object used to build the headers necesary by the service
  var buildRequestHeaders = function buildRequestHeaders(access_token) {
    var requestHeaders = EXTRA_HEADERS;
    requestHeaders.Authorization = 'OAuth ' + access_token;

    return requestHeaders;
  };

  var listUpdatedContacts = function listUpdatedContacts(accessToken, from, to) {
    photoUrls = {};
    return getContactsGroupId(accessToken).then((id) => {
      return getContactsByGroup(id, accessToken, from, to);
    });
  };

  var getContactsGroupId = function getContactsGroupId(access_token) {
    return performAPIRequest(GROUPS_END_POINT, access_token)
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
                                                       access_token,
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
    return performAPIRequest(groupUrl, access_token).then((response) => {
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
  var performAPIRequest = function performAPIRequest(url, access_token) {
    return Rest.get(url, {
      'requestHeaders': buildRequestHeaders(access_token),
      'responseType': 'xml'
    });
  };

  var addNewContact = function addNewContact(mozContact) {
    // TODO implement
    return new Promise(function(resolve, reject) {
      console.log('Adding contact to google', mozContact);
      resolve({
        type: 'google',
        action: 'added',
        id: 'nope'
      });
    });
  };

  var updateContact = function updateContact(id, updatingContact) {
    //TODO implement
    return new Promise(function(resolve, reject) {
      console.log('Updating google contact', updatingContact);
      resolve({
        type: 'google',
        action: 'updated',
        id: 'nope'
      });
    });
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

  var adaptDataForSaving = function adaptDataForSaving(contact) {
    return contact;
  };

  // Transform a Google contact entry into json format.
  // The json format is the same used in Contacts api ;P
  var gContactToJson = function gContactToJson(googleContact) {
    var output = {};

    // This field will be needed for indexing within the
    // import process, not for the api
    output.uid = getUid(googleContact);
    output.etag = getEtag(googleContact);

    var isDeleted =
      googleContact.getElementsByTagNameNS(GD_NAMESPACE, 'deleted').length > 0;

    if (isDeleted) {
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
    return contact.getAttribute('gd:etag');
  };

  // Returns an array with the possible emails found in a contact
  // as a ContactField format
  var parseEmails = function parseEmails(googleContact) {
    var DEFAULT_EMAIL_TYPE = 'other';
    var emails = [];
    var fields = googleContact.getElementsByTagNameNS(GD_NAMESPACE,
      'email');
    if (fields && fields.length > 0) {
      for (var i = 0; i < fields.length; i++) {
        var emailField = fields.item(i);

        // Type format: rel="http://schemas.google.com/g/2005#home"
        var type = emailField.getAttribute('rel') || DEFAULT_EMAIL_TYPE;
        if (type.indexOf('#') > -1) {
          type = type.substr(type.indexOf('#') + 1);
        }

        emails.push({
          'type': [type],
          'value': emailField.getAttribute('address')
        });
      }
    }

    return emails;
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
    var GMAIL_MAP = {
      'work_fax' : 'faxOffice',
      'home_fax' : 'faxHome',
      'pager' : 'other',
      'main' : 'other'
    };
    var phones = [];
    var fields = googleContact.getElementsByTagNameNS(GD_NAMESPACE,
      'phoneNumber');
    if (fields && fields.length > 0) {
      for (var i = 0; i < fields.length; i++) {
        var field = fields.item(i);

        // Type format: rel="http://schemas.google.com/g/2005#home"
        var type = field.getAttribute('rel') || DEFAULT_PHONE_TYPE;
        if (type.indexOf('#') > -1) {
          type = type.substr(type.indexOf('#') + 1);
        }

        phones.push({
          'type': [GMAIL_MAP[type] || type],
          'value': field.textContent
        });
      }
    }

    return phones;
  };

  var downloadContactPicture = function downloadContactPicture(googleContact,
    access_token) {
    var url = buildContactPhotoURL(googleContact, access_token);
    return Rest.get(url, { 'responseType': 'blob' });
  };

  // Build the url of the photo with the access token
  var buildContactPhotoURL = function contactPhotoURL(contact, access_token) {
    if (photoUrls && photoUrls[contact.uid]) {
      return photoUrls[contact.uid] + '?access_token=' + access_token;
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
