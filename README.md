# Watchtower

Watchtower monitors native balances for Ethereum-compatible accounts and sends
Telegram alerts when an account crosses below its configured threshold.

## Architecture

- Next.js web dashboard and API
- PostgreSQL for accounts, settings, and alert state
- Independent 24/7 monitor worker
- Single-owner authentication using an HTTP-only signed session cookie

The web service and worker share the same `DATABASE_URL`. A PostgreSQL advisory
lock prevents an automatic worker check and a manual “Check now” request from
running at the same time.

## Local development

Requires Node.js 22.13+, npm, and Docker.

```bash
cp .env.example .env.local
docker compose up -d postgres
npm install
npm run dev
```

In a second terminal, start the monitor:

```bash
npm run worker
```

Open `http://localhost:3000`. Choose private values for `APP_USERNAME` and
`APP_PASSWORD`, and generate `AUTH_SECRET` with:

```bash
openssl rand -base64 48
```

## Railway deployment

Create one Railway project with:

1. A PostgreSQL database.
2. A web service connected to this repository.
3. A worker service connected to the same repository.

In each service's settings, select its custom Railway config file:

- Web: `/railway.web.toml`
- Worker: `/railway.worker.toml`

Set these variables on both application services:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `APP_USERNAME`
- `APP_PASSWORD`
- `AUTH_SECRET` (generate with `openssl rand -base64 48`)

Expose a public domain only for the web service. The worker needs no public
domain. The monitor interval is controlled from Telegram settings in the UI.

## Commands

```bash
npm run dev
npm run worker
npm run build
npm test
npm run lint
```
