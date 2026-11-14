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

Open a product page, click Dip, press "Watch this page". That's it. Dip remembers the price, checks it again about once an hour, and sends a notification when it goes down or up.

• Works on most shops, no setup. Dip reads the price the shop publishes on its own page.
• Price history for every item, with the change since the last price.
• Notifications for every change. Click one to open the product.
• Private by design. No account, no analytics, no tracking. Your list and price history are stored in your browser and never leave it.
• Asks for access one shop at a time, only for shops you add.
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
- **alarms**: Schedules an hourly re-check of the watched prices.
- **notifications**: Notifies the user when a watched price changes.
- **activeTab**: Reads the current page when the user clicks "Watch this page", to find the product's price and title.
- **scripting**: Reads the rendered HTML of the page the user is adding, and of a watched product page when its price is filled in by scripts, in order to extract the price.
- **Host permissions (optional, `*://*/*`)**: Product pages can be on any shop, so the sites can't be listed in advance. Access is optional and requested at runtime, per shop, when the user adds a product from that shop. It is used only to fetch the watched product pages and read their price.
- **Content script on localhost**: Lets the user's own self-hosted Dip web app (an open-source companion that runs on localhost) ask the extension to look up a price. It returns only the extracted price, title and image address.

**Remote code**

No, the extension does not use remote code.

**Data usage**

The extension does not collect or use any user data. Tick none of the data categories, and certify all three disclosures.

**Privacy policy URL**

`https://github.com/<you>/dip/blob/main/PRIVACY.md` (after the repository is public)
