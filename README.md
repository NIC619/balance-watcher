# Watchtower

Watchtower monitors native balances for Ethereum-compatible accounts and sends
Telegram alerts when an account crosses below its configured threshold.

## Features

- Accounts grouped and sorted by EVM network
- Custom name tags and native-token thresholds
- One-click duplication of an address to another network
- Live JSON-RPC balance checks
- Telegram test messages and transition-based low-balance alerts
- D1-backed persistent watchlist and settings

## Development

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm run dev
```

Generate a migration after schema changes:

```bash
pnpm run db:generate
```

Build and verify:

```bash
pnpm run build
pnpm test
```

The Worker exports a scheduled handler that runs the same monitor used by the
“Check now” action. Configure a cron trigger for that handler in the production
Cloudflare environment to keep checks running when the dashboard is closed.
