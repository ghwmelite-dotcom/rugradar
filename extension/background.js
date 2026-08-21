// RugRadar extension — background service worker.
//
// Fallback fetch relay for the content script. Direct fetch() from a content
// script runs with the *page's* origin, so it is subject to CORS: it only
// works once /api/scan sends Access-Control-Allow-Origin (see README).
// A fetch from this service worker runs with the extension's origin and is
// authorized purely by host_permissions, so this relay lets the badge work
// even before that CORS header ships. The content script tries a direct
// fetch first and only relays here when the direct call fails.

const API_BASE = "https://rugradar.ghwmelite.workers.dev";

// chrome.storage.session defaults to TRUSTED_CONTEXTS, which excludes content
// scripts. The content script's scan cache needs access, so widen it. The
// cached data is non-sensitive public scan results keyed by token address.
chrome.storage.session
  .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
  .catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "rugradar:scan") return false;

  const chain = String(msg.chain || "");
  const address = String(msg.address || "");
  if (!chain || !address) {
    sendResponse({ ok: false, error: "bad request" });
    return false;
  }

  const url = `${API_BASE}/api/scan?chain=${encodeURIComponent(
    chain,
  )}&address=${encodeURIComponent(address)}`;

  fetch(url, { headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) {
        sendResponse({ ok: false, status: res.status });
        return;
      }
      const data = await res.json();
      sendResponse({ ok: true, data });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });

  // Keep the message channel open for the async response.
  return true;
});
