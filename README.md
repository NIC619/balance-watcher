# Watchtower

Watchtower monitors native and ERC-20 balances for Ethereum-compatible
accounts and sends Telegram alerts when an account crosses below its configured
threshold.

## Architecture

- Next.js web dashboard and API
- PostgreSQL for accounts, settings, and alert state
- Independent 24/7 monitor worker
- Single-owner authentication using an HTTP-only signed session cookie
- On-chain ERC-20 contract and metadata validation
- Editable built-in networks and validated custom EVM RPC networks

The web service and worker share the same `DATABASE_URL`. A PostgreSQL advisory
lock prevents an automatic worker check and a manual “Check now” request from
running at the same time.

## Using the dashboard

### ERC-20 balances

When adding or editing an account, choose **ERC-20 token**, select a network,
and enter the token contract address. Click **Validate** before saving.
Watchtower checks that the address has contract code and successfully responds
to the ERC-20 `totalSupply()`, `balanceOf()`, and `decimals()` calls. It also
reads the token name and symbol when available.

Token contracts are network-specific. Duplicating an ERC-20 watch to another
network succeeds only if the same contract address validates on the target
network.

### Networks

Open **Manage networks** to add or edit networks. Enter the name, native token
symbol, environment, color, and RPC URL. Watchtower calls `eth_chainId` through
the RPC before saving:

- New custom networks derive their chain ID from the RPC.
- Editing a network requires the RPC to report the existing chain ID.
- Built-in networks can be edited but not deleted.
- Custom networks can be deleted when no watched accounts use them.

Network configuration and token metadata are persisted in PostgreSQL. Existing
installations migrate automatically on the first request or worker cycle after
deployment.

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
