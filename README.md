# vtiger-reader

A fast, read-only **desktop app** for a **vtiger / OpenCRM Italia** CRM, focused on tickets, with AI help on demand.

The stock vtiger interface is slow. vtiger-reader shows the same tickets faster, adds a few things the CRM does not have (cleaned-up mails with the raw original one click away, signature images set aside, "has this happened before?", notifications for new tickets) and an optional AI side panel. You pick your own AI providers and which model does what.

**The CRM stays the only source of CRM data.** The app stores your preferences on your PC, nothing the CRM already holds: tickets, comments, customers and attachments are read from the CRM every time.

> Status: early development. Windows only for now. Your CRM link, the tickets (your own lists, search, filters, a ticket with its mails cleaned or raw, attachments, signature images set aside), the AI panel and the notifications work. Read-only: the buttons that would write to the CRM are there, disabled.

## Install

Download `vtiger-reader-setup-<version>.exe` (the CI builds it on every push: the artifact of the "Desktop app" job; final versions also as a GitHub Release) and run it. It installs for your Windows user only, no administrator needed. It is not signed yet: Windows says "unknown publisher" the first time.

Then, in the app: Settings → CRM account (the CRM's address, your username, your access key from the CRM's My Preferences).

- Closing the window keeps the app in the tray, so new tickets are still told (every 2 minutes). Quit it from the tray icon.
- Settings → Notifications: which of your lists notify, a test, and "Start with Windows" (in the tray).
- Your data lives in `%APPDATA%\vtiger-reader`: the database (SQLite), the key that seals your CRM and AI keys (kept by Windows for your user), the log. Uninstalling keeps it.

## How it is made

- **App**: Electron (`api/src/desktop/`). Its main process runs the API itself, on `127.0.0.1` with a random port; only its own window can use it (a secret cookie, new at every start).
- **API**: Node, TypeScript, Fastify, SQLite through `node:sqlite` (`api/`)
- **Web**: Angular 21, Angular Material 3 (`web/`), shown in the app's window
- **CRM**: the vtiger webservice API (`/webservice.php`), with your own account

## Development

Node 22.13 or later; nothing else (no database server, no Docker).

```bash
cd api && npm install
cd ../web && npm install
```

In the browser, with live reload:

```bash
cd api && npm run dev        # the API on http://127.0.0.1:3000, database in api/data/
cd web && npx ng serve       # http://localhost:4200 (proxies /api to the API)
```

There notifications go to the API's log: there is no desktop to show them on.

The desktop app:

```bash
cd api
npm run web                  # the Angular build the app shows
npm run desktop              # builds the API and starts the app (data in %APPDATA%\vtiger-reader-dev)
npm run smoke                # starts it unseen, checks the window, the bridge and the lock, quits
npm run dist                 # the installer, in api/release/
```

Tests:

```bash
cd api && npm test           # SQLite in memory, a few seconds
cd web && npx ng test --watch=false
```

## Versions

`<prefix><year>.<backend>.<frontend>.<build>`, e.g. `dev26.0.0.0000`. `dev` versions live on `dev` and on work branches named after their version; `a` (alpha), `b` (beta) and `v` (release) only on `main`, where the CI publishes the installer as a GitHub Release.

## License

Public domain, under [the Unlicense](LICENSE): copy, change, use and sell it as you like, with no conditions.
