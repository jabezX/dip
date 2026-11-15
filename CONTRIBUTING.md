# Contributing

Thanks for taking a look. Dip is small on purpose, and the bar for a change is
"does this keep it small?"

## Getting set up

```sh
git clone https://github.com/jabezX/dip
cd dip
npm install
npm run dev      # web app on http://localhost:3000
npm test         # unit tests (node:test, no framework)
npm run lint
```

## What makes a good change

- **A shop's price isn't detected.** The most useful contribution. Add a
  trimmed-down copy of the page's markup as a test case, then make the
  extractor handle it. Prefer fixing the general rule over adding a special
  case for one shop.
- **Bug fixes**, with a test that fails without the fix.
- **Small features** that fit the idea: your list and price history stay on
  your device. Please open an issue first so we can agree on the shape before
  you write code.

## What won't be merged

- Accounts, sync servers, analytics, or anything that stores prices centrally.
- New runtime dependencies for things the platform already does.

## Pull requests

- Keep them focused: one change per PR.
- Run `npm test` and `npm run lint` before pushing.
- Commit messages: short, lowercase, imperative ("fix comma decimals").

By contributing you agree that your work is released under the
[MIT License](LICENSE).
