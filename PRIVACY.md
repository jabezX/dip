# Privacy Policy

_Last updated: November 14, 2026_

Dip is a price watch list. This policy covers the Dip browser extension and
the Dip web app.

## The short version

Dip does not collect, transmit or sell any personal data. There are no
accounts, no analytics and no tracking. Your watch list and price history are
stored on your device and stay there.

## What Dip stores, and where

- **Your watch list**: the links you add, each product's title and picture
  address, and the prices Dip has seen with the time it saw them.
- **Where**: in your browser's local storage (`chrome.storage.local` for the
  extension, `localStorage` for the web app). It is never sent to the
  developer or to any third party.

Removing an item deletes it. Uninstalling the extension or clearing site data
deletes everything.

## Network requests Dip makes

- **To the shops you watch.** To check a price, the extension requests the
  product page you added, from your browser, the same way opening it in a tab
  would (including that shop's cookies). The shop sees an ordinary visit from
  you. Dip reads the price from the page and discards the rest.
- **Product pictures** are loaded directly from the shop's own servers.
- **The web app without the extension** asks its own server route to fetch
  the product page. That route keeps no database, cache or log of the links
  it is given.

Dip makes no other requests. Nothing is sent to the developer.

## Permissions the extension uses

- **storage**: keep your watch list on your device.
- **alarms**: re-check prices on the schedule you choose.
- **notifications**: tell you when a price changes.
- **activeTab** and **scripting**: read the price from the page you are on
  when you press "Watch this page", and from pages Dip opens to re-check a
  price.
- **Access to a built-in list of shop sites**: on these shopping sites Dip
  reads the page you are viewing, inside your browser, to see whether it is a
  product page and offer to watch its price, and fetches the product pages you
  chose to watch. What it reads is not stored unless you choose to watch the
  product, and is never sent anywhere. The offer can be switched off.
- **Access to other sites (optional, asked per shop)**: for shops not on the
  list, Dip asks when you add a product there. Access to all sites is only
  requested if you press "Let Dip check any shop".

## Data sharing

None. Dip has no servers that receive your data, so there is nothing to share,
sell or disclose.

## Changes

Changes to this policy are published in this file, in the project's public
repository, with the date updated above.

## Contact

Open an issue on the project's GitHub repository.
