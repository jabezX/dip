# Chrome Web Store listing

Copy for the developer dashboard. Images are in this folder.

## Store listing tab

**Name**

Dip: Price Watch List

**Summary** (132 characters max)

Watch product prices and get notified when they change. Your list and price history stay in your browser.

**Category**

Shopping

**Language**

English

**Description**

Dip keeps a watch list of products you care about and tells you when a price moves.

Open a product page and Dip offers to watch it, or click Dip and press "Watch this page". That's it. Dip remembers the price, checks it again on the schedule you choose, and sends a notification when it goes down or up.

• Works on most shops, no setup. Dip reads the price the shop publishes on its own page.
• Price history for every item, with the change since the last price.
• Checks on your schedule, from every few minutes to monthly.
• Tells you when a product is unavailable or no longer listed.
• Search, sort and organise products into lists.
• Ignores monthly payment plans, so a "$33/mo." offer is never mistaken for a price drop.
• Notifications for every change. Click one to open the product.
• Private by design. No account, no analytics, no tracking. Your list and price history are stored in your browser and never leave it.
• Knows 360+ popular shop sites out of the box; any other shop can be added with one click.
• Export your list as a plain JSON file.
• Free and open source (MIT).

How it works
Dip re-opens the product pages you chose, from your own browser, and reads the price. For shops that fill prices in after the page loads, it briefly loads the page in a background tab. Nothing is sent to any server run by Dip, because there isn't one.

Good to know
• Prices are read from the page as the shop shows it. If a shop shows a "from" price or a different variant, that is what Dip records.
• Checks run while your browser is open.

**Screenshots** (1280×800): `screenshot-1.png`, `screenshot-2.png`

**Small promo tile** (440×280): `promo-small.png`

**Store icon** (128×128): `../extension/icons/128.png`

## Privacy practices tab

**Single purpose**

Track the prices of product pages the user chooses and notify the user when a price changes.

**Permission justifications**

- **storage**: Stores the user's watch list and price history locally on the device.
- **alarms**: Schedules the re-check of watched prices at the interval the user chooses.
- **notifications**: Notifies the user when a watched price changes.
- **activeTab**: Reads the current page when the user clicks "Watch this page", to find the product's price and title.
- **scripting**: Reads the rendered HTML of the page the user is adding, and of a watched product page when its price is filled in by scripts, in order to extract the price.
- **Host permissions (the listed shop sites)**: The extension's purpose is tracking prices on shop product pages. On these well-known shopping sites it (1) reads the page the user is viewing to detect a product and offer to watch its price, and (2) fetches the product pages the user chose to watch, to read their current price. No data from these pages leaves the browser.
- **Optional host permissions (`*://*/*`)**: Lets the user add a product from a shop that isn't on the built-in list. Requested at runtime, per shop, when the user presses "Watch this page" there.
- **Content script on localhost**: Lets the user's own self-hosted Dip web app (an open-source companion that runs on localhost) ask the extension to look up a price. It returns only the extracted price, title and image address.

**Remote code**

No, the extension does not use remote code.

**Data usage**

The extension does not collect or use any user data. Tick none of the data categories, and certify all three disclosures.

**Privacy policy URL**

`https://github.com/<you>/dip/blob/main/PRIVACY.md` (after the repository is public)
