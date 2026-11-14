import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { extractPrice, isUnavailable } from "@core/extract";

// Stateless: fetch the page, read the price, forget everything.
// It exists only because browsers can't fetch shop pages cross-origin.

const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 127], // :: and ::1
  // IPv4-mapped addresses (::ffff:a.b.c.d) are matched against the v4 rules by BlockList
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

class Rejected extends Error {
  gone = false;
}

// robot checks, country pickers and script-filled prices all end up here
const NEEDS_BROWSER = "This shop needs the Dip extension";

// ponytail: the address is checked here but fetch() resolves the name again,
// so a DNS-rebinding host could slip through. Pin the resolved IP with a
// custom dispatcher before running this as a public service.
async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Rejected("Only http(s) links are supported");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true }).catch(() => {
    throw new Rejected("Could not resolve that host");
  });
  for (const { address, family } of addresses) {
    if (blocked.check(address, family === 6 ? "ipv6" : "ipv4")) throw new Rejected("That host is not allowed");
  }
}

async function fetchPage(input: string) {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if ([401, 403, 429].includes(res.status)) {
      throw new Rejected(NEEDS_BROWSER);
    }
    if (res.status === 404 || res.status === 410) throw Object.assign(new Rejected("Unlisted"), { gone: true });
    if (!res.ok) throw new Rejected(`Shop answered ${res.status}`);
    if (!res.body) return { html: "", url: url.href };

    // read at most MAX_BYTES, the price is never at the end of a 50 MB page
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
      size += chunk.byteLength;
      if (size >= MAX_BYTES) break;
    }
    return { html: Buffer.concat(chunks).toString("utf8"), url: url.href };
  }
  throw new Rejected("Too many redirects");
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target || !URL.canParse(target)) {
    return Response.json({ error: "Pass a product link as ?url=" }, { status: 400 });
  }
  try {
    const page = await fetchPage(target);
    const result = extractPrice(page.html, page.url);
    if (!result && isUnavailable(page.html)) {
      return Response.json({ error: "Unavailable", unavailable: true }, { status: 422 });
    }
    if (!result) return Response.json({ error: NEEDS_BROWSER }, { status: 422 });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const error = e instanceof Rejected ? e.message : "Could not load that page";
    const gone = e instanceof Rejected && e.gone;
    return Response.json({ error, gone }, { status: e instanceof Rejected ? 400 : 502 });
  }
}
