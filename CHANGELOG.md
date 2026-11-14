# Changelog

## 0.2.0

- The web app looks prices up through the extension when it's installed, so
  shops that turn servers away (Amazon, eBay, …) work
- Extension reads script-filled prices by loading the page in a background tab
- Prices are found on pages without structured data
- New design: product pictures, summary tiles, larger charts, lowest/highest
- Clearer message when a shop can't be read from a server
- Extension offers to watch a product when you open its page on a supported
  shop (366 shop sites built in; can be switched off)
- The same product can't be added twice, however its link was copied
- Last check date and time on every product; expandable rows in the popup
- A test product whose price changes on every check, to try notifications

## 0.1.0

First release.

- Web app: watch list, price history with sparklines, notifications,
  installable PWA with share target, JSON export/import
- Browser extension (Chromium): watch the current page, hourly background
  checks, notifications, per-shop permissions, JSON export
- Price detection from JSON-LD, Open Graph/product meta tags and microdata
