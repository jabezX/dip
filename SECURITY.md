# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's
**Security → Report a vulnerability** on this repository so it can be fixed
before it's public. You'll get a reply within a week.

## What to know

**`/api/price` fetches user-supplied links.** To keep it from being used to
reach internal services, it:

- only follows `http` and `https`
- resolves the host and refuses loopback, private, link-local and other
  non-public addresses (IPv4 and IPv6)
- follows redirects itself and re-checks each hop
- limits response time and size

Known gap: the address is validated and then the request resolves the name
again, so a host that changes its DNS answer between the two (DNS rebinding)
could get past the check. If you host the app somewhere with access to
sensitive internal services, restrict its outbound network access as well.

There is no rate limiting built in.

**The extension** asks for access one shop at a time, only for shops you add,
unless you choose "Let Dip check any shop". Background checks send that shop's
cookies, the same as opening the page in a tab would, and may load the page in
a background tab. Page titles are treated as text, never as HTML.

**The web app bridge.** On the addresses listed under `content_scripts` in
`extension/manifest.json` (`localhost` by default), a page can ask the
extension to look up a link. It gets back only the extracted price, title and
picture, never the page itself, and only for shops the extension has been
allowed to read. Only add addresses you control to that list.

**Imported files** are validated before use; links that aren't `http(s)` are
rejected.
