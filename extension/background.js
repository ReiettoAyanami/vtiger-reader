// Service worker. It keeps the CRM's content script registered for the one
// site the user allowed in the settings. The site's address lives only in
// this browser's storage: the repository never names it.

const CRM_KEY = "crmOrigin";
const SCRIPT_ID = "vtr-crm";

async function unregisterCrm() {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch (err) {
    console.warn("vtiger-reader: unregister failed", err);
  }
}

async function registerCrm() {
  await unregisterCrm();
  const { [CRM_KEY]: origin } = await chrome.storage.local.get(CRM_KEY);
  if (!origin) return;
  const pattern = origin + "/*";
  const allowed = await chrome.permissions.contains({ origins: [pattern] });
  if (!allowed) return;
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: [pattern],
      js: ["theme.js", "sample-data.js", "content.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  registerCrm();
});

chrome.runtime.onStartup.addListener(() => {
  registerCrm();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "register") {
    registerCrm().then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err) })
    );
    return true; // answer asynchronously
  }
  if (message && message.type === "unregister") {
    unregisterCrm().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
