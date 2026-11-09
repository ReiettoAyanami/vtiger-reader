# vtiger-reader: browser extension (step 1, look only)

A Chrome or Edge extension that puts the vtiger-reader look over the CRM page you already use,
with the same session: no CRM access key. **Status: test version, sample data.** The tickets
come from the CRM in the next step.

## Try it locally

```bash
node extension/build.mjs
```

It prints a folder under `extension/dist/`. Then:

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. **Load unpacked**, and pick the printed folder.
3. Open the extension's **settings** (its entry in the list → Details → Extension options).
4. Type the CRM address (https) and click **Allow and turn on**. The browser asks permission for
   that one site only.
5. Open the CRM and click **vtiger-reader** at the bottom right.

Forget the CRM in the same settings page to turn it off everywhere.

## What is here

- `manifest.json`: MV3, asks only for `storage` and `scripting`, and the CRM site as an
  *optional* host permission. No CRM address is written in the code or the manifest.
- `background.js`: registers the overlay for the one allowed site (kept across restarts).
- `options.html`, `options.js`: the settings page.
- `content.js`: the button and the overlay, in a shadow root (the CRM's CSS cannot change them).
- `theme.js`: the look (the same tokens as substance-tracker).
- `sample-data.js`: invented tickets. Nothing in it comes from the CRM.

## Not yet

- Real tickets from the CRM (step 2). The CRM facts are in the brain: `wiki/projects/vtiger-reader/crm-spike.md`.
- The AI panel (step 3). The buttons are shown, disabled.
- Notifications for new tickets, restyling of the CRM's own pages.
- Packaging for coworkers (Web Store unlisted or company policy): an open decision.
