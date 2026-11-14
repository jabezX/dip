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
- Product pictures, lowest/highest price and a summary of what got cheaper
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
           │ /api/price?url=…                     │ fetch, hourly
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
4. The first element labelled "price" whose text reads like money

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
| Checks while the app is closed   |               | ✓ (hourly)         |

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

Open a product page, click the Dip icon, then **Watch this page**. Dip asks
for access to that one shop so it can re-check the price in the background.

To let the web app use the extension for its lookups, press **Let Dip check
any shop** in the popup. That's the only time it asks for access to all sites,
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
- When a page has no structured data, the price is a best guess from the
  page's markup and can be wrong (a "from" price, a different variant).
- For shops that fill prices in with scripts, the extension briefly opens the
  page in a background tab on each check.
- A shop that publishes a wrong or stale price in its structured data will
  show that price here.
- Firefox and Safari extensions aren't supported yet.

## Contributing

Contributions are welcome, especially reports and fixes for shops whose prices
aren't detected. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
