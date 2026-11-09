// Settings page. The permission request must be the first async call of the
// click handler, so the browser counts it as coming from the user.

const CRM_KEY = "crmOrigin";
const input = document.getElementById("crm");
const status = document.getElementById("status");

function say(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

// Accepts only a public https address; returns its origin (no path, no slash).
function parseOrigin(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.origin;
}

async function loadSaved() {
  const { [CRM_KEY]: origin } = await chrome.storage.local.get(CRM_KEY);
  if (origin) input.value = origin;
}

document.getElementById("save").addEventListener("click", async () => {
  const origin = parseOrigin(input.value);
  if (!origin) {
    say("Use a full https address, for example https://crm.example.com", true);
    return;
  }
  // First await: the permission prompt needs the user's click.
  let granted;
  try {
    granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  } catch (err) {
    say("The browser did not allow the permission: " + err.message, true);
    return;
  }
  if (!granted) {
    say("Permission was not given, so nothing is turned on.", true);
    return;
  }
  await chrome.storage.local.set({ [CRM_KEY]: origin });
  const reply = await chrome.runtime.sendMessage({ type: "register" });
  if (!reply || !reply.ok) {
    say("Saved, but the page could not be switched on: " + (reply && reply.error), true);
    return;
  }
  input.value = origin;
  say("On for " + origin + ". Open the CRM and click vtiger-reader (bottom right).");
});

document.getElementById("forget").addEventListener("click", async () => {
  const { [CRM_KEY]: origin } = await chrome.storage.local.get(CRM_KEY);
  await chrome.storage.local.remove(CRM_KEY);
  await chrome.runtime.sendMessage({ type: "unregister" });
  if (origin) {
    await chrome.permissions.remove({ origins: [origin + "/*"] });
  }
  input.value = "";
  say("Forgotten. The overlay is off everywhere.");
});

loadSaved();
