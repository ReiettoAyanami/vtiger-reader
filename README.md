# vtiger-reader

A fast, read-only web interface to a **vtiger / OpenCRM Italia** CRM, focused on tickets, with AI help on demand.

The stock vtiger interface is slow. vtiger-reader shows the same tickets faster, adds a few things the CRM does not have (cleaned-up mails with the raw original one click away, signature images set aside, "has this happened before?", notifications for new tickets) and an optional AI side panel. Each user picks their own AI providers and which model does what.

**The CRM stays the only source of CRM data.** vtiger-reader stores its users and their preferences, nothing the CRM already holds: tickets, comments, customers and attachments are read from the CRM at every request.

> Status: early development. Accounts, settings and the app shell work; the CRM link, the tickets, the AI panel and notifications come next. Read-only: the buttons that would write to the CRM are there, disabled.

## Stack

- **API**: Node 22, TypeScript, Fastify, mysql2, Better Auth (`api/`)
- **Web**: Angular 21, Angular Material 3, no SSR (`web/`)
- **Database**: MySQL 8 (users and preferences only)
- **CRM**: the vtiger webservice API (`/webservice.php`); each user links their own CRM from Settings: its address, their username and access key

## Development

Everything runs in containers; the host only needs Docker.

```bash
cp .env.example .env          # then replace the placeholders
docker compose -f compose.dev.yaml up -d
```

- web (Angular dev server): http://localhost:4200
- API: http://localhost:3001
- MySQL: localhost:3306 (`DB_HOST_PORT`)

The first administrator (`admin` unless `ADMIN_USERNAME` says otherwise) is created at the first start; its password is written to `to_delete.password.txt` at the project root. Read it, then delete the file.

Tests:

```bash
docker compose -f compose.dev.yaml exec api npm test          # API (needs the dev MySQL)
docker compose -f compose.dev.yaml exec web npx ng test --watch=false
```

## Production

```bash
cp .env.example .env          # APP_URL, AUTH_SECRET, DB_PASSWORD, ENCRYPTION_KEY...
docker compose -f compose.prod.yaml up -d --build
```

The app listens on `APP_PORT` (8080). Put it behind a reverse proxy with https: the browser's push notifications need it.

## Versions

`<prefix><year>.<backend>.<frontend>.<build>`, e.g. `dev26.0.0.0000`. `dev` versions live on `dev` and on work branches named after their version; `a` (alpha), `b` (beta) and `v` (release) only on `main`, where the CI publishes the image to `ghcr.io`.

## License

Public domain, under [the Unlicense](LICENSE): copy, change, use and sell it as you like, with no conditions.
