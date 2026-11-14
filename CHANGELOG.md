# Changelog

## Unreleased

- The web app looks prices up through the extension when it's installed, so
  shops that turn servers away (Amazon, eBay, …) work
- Extension reads script-filled prices by loading the page in a background tab
- Prices are found on pages without structured data
- New design: product pictures, summary tiles, larger charts, lowest/highest
- Clearer message when a shop can't be read from a server

## 0.1.0

First release.

- Web app: watch list, price history with sparklines, notifications,
  installable PWA with share target, JSON export/import
- Browser extension (Chromium): watch the current page, hourly background
  checks, notifications, per-shop permissions, JSON export
- Price detection from JSON-LD, Open Graph/product meta tags and microdata
