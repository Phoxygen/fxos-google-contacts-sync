# fxos-google-contacts-sync

A sync client for the FxOS Contacts app.

## How to install

Clone the repo and use the webIDE to install.

## Compatibility

Because of web components, you need to have FxOS 2.5+ and activate
dom.webcomponents.enabled in the device preferences.

## Functional note

At the moment, only one-way read-only sync is supported, from google to your
device. We are planning on adding support for 2-way sync soon.

The sync is still manual at the moment.


## Technical note

### OAuth

`app.js` launches the oauth process. The callback of the oauth is redirected to
`oauth_result.html` (see the redirect in manifest.webapp).

### Import and sync

The central point of the applications are:
- `gmail_connector.js`
- `contact_importer.js`

These 2 files have been originally taken from gaia.

`contact_importer.js` is a generic service that takes a connector, and manage the
sync process.

`gmail_connector.js` is the service that actually performs the call to the
remote API. It is driven by `contact_importer.js.`

In an ideal world, we could have any connector and use it with the
`contact_importer.js`. I wouldn’t bet on it right now, and I’m not even sure the
API differences between the various providers will allow that. Would it worth
the effort? Do we even care?
