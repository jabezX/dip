<p align="center">
  <img src="src/app/icon.svg" width="88" alt="Dip logo">
</p>

<h1 align="center">Dip</h1>

<p align="center">
  Watch prices. Privately.<br>
  A price watch list that lives in your browser. No account, no central price database.
</p>

---

Dip keeps a list of product pages you care about, checks their prices, and
tells you when one changes. The list and every price it has ever seen are
stored on your device and nowhere else.

It comes in two forms that share the same core:

- **Web app** — an installable PWA built with Next.js. Paste a link (or share
  one to it on Android) and it joins your list.
- **Browser extension** — press *Watch this page* on a product page. It checks
  prices in the background and sends a notification when one moves.

They're better together: with the extension installed, the web app looks
prices up through it, which is what makes Amazon, eBay and other big shops
work. See [Web app or extension?](#web-app-or-extension)

## Features

- Add a product by link, or straight from the page you're on
- Price history with a sparkline per item
- Notifications on any price change, up or down
- The extension offers to watch a product when you open its page on a
  supported shop
- The same product is never added twice, even from a differently copied link
- Product pictures (or the shop's logo), lowest/highest price and a summary
  of what got cheaper
- Checks on your schedule: every N minutes, hours, days, weeks or months
- Spots products that are unavailable or no longer listed
- Search, filter, sort, and group products into your own lists
- No per-shop scrapers to maintain: prices are read from the structured data
  shops publish, or from the page itself when there is none
- Export and import your list as a plain JSON file
- Light and dark mode, follows your system
- No accounts, no tracking, no analytics

## How it works

```
        web app                              extension
 ┌───────────────────┐                ┌───────────────────────┐
 │ list + history in │                │ list + history in     │
 │ localStorage      │                │ chrome.storage.local  │
 └─────────┬─────────┘                └───────────┬───────────┘
           │ /api/price?url=…                     │ fetch, on your schedule
 ┌─────────▼─────────┐                            │
 │ stateless lookup  │                            │
 │ (stores nothing)  │                            │
 └─────────┬─────────┘                            │
           └──────────────► shop page ◄───────────┘
```

Both read the price from the page, trying in this order:

1. [schema.org](https://schema.org/Product) JSON-LD (`Product` → `offers`)
2. Open Graph / product meta tags (`product:price:amount`)
3. Microdata (`itemprop="price"`)
4. The page's main price element, read off the page

### Prices you can trust

A wrong price that triggers a "price drop" alert is worse than no alert, so:

- **Payment plans are never the price.** Monthly instalments ("$33.29/mo.",
  "12 × €83,25", "3 payments of…"), Klarna/Affirm amounts, shipping, deposits,
  crossed-out and "was" prices are all skipped, both in structured data and on
  the page. When a page shows only an instalment, Dip finds no price rather
  than the wrong one.
- **On Amazon** only the main price box counts; the shipping tables, other
  sellers and payment-plan widgets elsewhere on the page are ignored.
- **Other products' prices are never used.** Sponsored cards, "you may also
  like" sections and "page not found" pages are skipped. On Amazon only the
  main price boxes count.
- **Every check reads the page the same way.** Some shops change the price
  with scripts after the page loads, so the plain page and the open tab can
  disagree. When a product is added, Dip notes which version it was read from
  and always re-checks that one, so you never get an alert for a difference
  that is only in how the page was read.
- **Surprising drops are confirmed first.** A drop of more than 40%, or a price
  read off the page that disagrees with the shop's structured data, is held
  back and only recorded (and alerted) when the next check sees it again.

The cases that tripped earlier versions are in
[extension/core/extract.test.js](extension/core/extract.test.js).

**Where the server comes in.** A web page isn't allowed to fetch another
site's HTML, so on its own the web app asks one small route, `/api/price`, to
fetch the page and read the price. It keeps no state: no database, no cache,
no log of what you watch.

### Web app or extension?

Use both if you can.

Many large shops (Amazon, eBay, Best Buy, Etsy…) don't show prices to a
server: they answer with a robot check, a country picker, or a page whose
price is filled in later by scripts. On its own, the web app can only watch
shops that answer plainly.

The extension reads shops from your own browser, where those pages work. It
fetches the page, and if the price isn't in the HTML it loads the page in a
background tab for a few seconds and reads it there.

When the extension is installed, the web app notices and sends its lookups
through it instead of through `/api/price`. To allow that, open the extension
popup once and press **Let Dip check any shop**.

|                                  | Web app alone | With the extension |
| -------------------------------- | ------------- | ------------------ |
| Shops that answer servers        | ✓             | ✓                  |
| Shops with robot checks          |               | ✓                  |
| Prices filled in by scripts      |               | ✓                  |
| Checks while the app is closed   |               | ✓                  |

## Getting started

Requires Node.js 20.9 or newer.

```sh
git clone https://github.com/<you>/dip.git
cd dip
npm install
npm run dev
```

Open http://localhost:3000. To try the installable, offline-capable build:

```sh
npm run build
npm start
```

### Extension

There's no build step.

1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. Choose **Load unpacked** and pick the `extension/` folder

Open a product page, click the Dip icon, then **Watch this page**.

**Supported shops.** The extension comes with access to 366 shop sites: the
Amazon, eBay, Zalando, MediaMarkt, Decathlon, Shopee, Lazada, Jumia and
Mercado Libre country sites, Walmart, Target, Best Buy, Etsy, AliExpress, IKEA,
Apple, Nike and a few hundred more. On those, Dip shows a small "Watch this
price?" card when you open a product page; switch it off in the popup, or per
site on the card. The full list is `host_permissions` in
[extension/manifest.json](extension/manifest.json); adding a shop is a
one-line pull request.

Any other shop works too: press **Watch this page** and Dip asks for access to
that one site.

**Trying notifications.** In a development build (the unpacked extension, or
`npm run dev`), Settings has **Add test product**: a made-up product whose
price changes every minute and sends an alert each time, until you remove it.
Release builds don't contain it.

To let the web app use the extension for its lookups, turn on **Any shop** in
the popup's settings. That's the only time it asks for access to all sites,
and it's optional.

The web app is recognised on `localhost` out of the box. If you host it
elsewhere, add your address to `content_scripts.matches` in
`extension/manifest.json`.

Chromium browsers (Chrome, Edge, Brave, Arc…) version 121 and up.

### Moving a list between the two

**Export** in the extension popup saves `dip-export.json`. **Import** in the
web app reads it. The format is the same on both sides.

## Hosting your own

The web app is a standard Next.js app and runs anywhere Next.js does. Two
things to know before you put it on a public address:

- `/api/price` fetches whatever link it's given. It refuses private and local
  addresses, caps response size and time, and re-checks every redirect, but it
  has no rate limiting. Put it behind your platform's rate limiter.
- See [SECURITY.md](SECURITY.md) for the known limits of those checks.

## Project layout

```
src/app/              web app: page, styles, manifest, /api/price
src/lib/store.ts      the web app's list (localStorage) and price checks
public/sw.js          service worker: offline shell, notification clicks
extension/            the browser extension (load this folder unpacked)
extension/bridge.js   lets the web app look prices up through the extension
extension/core/       price extraction and item logic, shared by both
```

`extension/core/` is plain JavaScript with no dependencies. It lives inside
the extension folder because an unpacked extension can only load files from
its own directory; the web app imports it as `@core/*`.

## Development

```sh
npm test         # node:test, no framework
npm run lint
```

## Limitations

- Without the extension, the web app can't read shops that turn servers away.
  It says so when that happens.
- Without the extension, the web app only checks while it's open.
- When a page has no structured data, the price is read off the page and can
  still be wrong (a "from" price, a different variant). Big moves are confirmed
  before they are recorded, small ones are not.
- For shops that fill prices in with scripts, the extension briefly opens the
  page in a minimized window on each check.
- Amazon only shows prices for products it ships to you: on another country's
  Amazon, many products read as unavailable.
- A shop that publishes a wrong or stale price in its structured data will
  show that price here.
- Firefox and Safari extensions aren't supported yet.

## Privacy

Nothing is collected. See [PRIVACY.md](PRIVACY.md).

## Releasing the extension

`npm run package:ext` writes `dip-extension.zip` from the last commit, without
the test files, and with [release/dev.js](release/dev.js) in place of the test
product. The store copy and images are in [store/](store/).

## Contributing

Contributions are welcome, especially reports and fixes for shops whose prices
aren't detected. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
