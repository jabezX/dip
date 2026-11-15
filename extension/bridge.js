// Content script for the Dip web app (see "content_scripts" in manifest.json).
// Lets the app look prices up through this extension, so shop pages are read
// by your own browser instead of by a server that shops tend to turn away.
// Only the extracted price, title and picture go back to the page.
addEventListener("message", async (e) => {
  if (e.source !== window || !e.data?.id) return;
  const { dip, id, url, via } = e.data;
  if (dip === "ping") return postMessage({ dip: "result", id, found: true }, location.origin);
  if (dip !== "lookup") return;
  const reply = await chrome.runtime
    .sendMessage({ type: "lookup", url, via: via === "fetch" || via === "render" ? via : undefined })
    .catch((err) => ({ error: err.message }));
  postMessage({ dip: "result", id, ...reply }, location.origin);
});
