# Changelog

## 0.3.0

- Fix: a monthly instalment ("$33.29/mo.") could be read as the price and
  reported as a price drop. Payment plans are now skipped everywhere, Amazon
  pages only read the main price box, and drops over 40% are confirmed by a
  second check before they are recorded or alerted
- Checks run on your schedule: every N minutes, hours, days, weeks or months
- Unavailable and unlisted products are detected and marked
- Search, filter and sort, and your own lists
- Shop logos when a product has no picture; better product pictures
- Popup: smaller type, relative check times ("2 hours ago"), product opens on
  click, details in a sheet, settings, yellow warnings
- Test product (development builds only) alerts every minute until removed
- Notifications no longer replace each other silently

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
