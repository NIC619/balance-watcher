import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the private Watchtower dashboard and worker", async () => {
  const [page, layout, dashboard, login, proxy, worker, monitor, evm, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/monitor.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/evm.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Dashboard/);
  assert.match(layout, /Watchtower — EVM Balance Monitor/);
  assert.match(dashboard, /Keep every account above the line\./);
  assert.match(dashboard, /Watched accounts/);
  assert.match(dashboard, /Connect Telegram/);
  assert.match(dashboard, /Manage networks/);
  assert.match(dashboard, /ERC-20 token/);
  assert.match(dashboard, /Validate RPC & save/);
  assert.match(login, /Private monitoring/);
  assert.match(proxy, /requestIsAuthenticated/);
  assert.match(worker, /runMonitor/);
  assert.match(monitor, /readErc20Balance/);
  assert.match(evm, /validateErc20Token/);
  assert.match(evm, /eth_chainId/);
  assert.match(packageJson, /"worker": "tsx scripts\/worker\.ts"/);
  assert.doesNotMatch(`${page}${layout}${dashboard}${packageJson}`, /codex-preview|react-loading-skeleton/i);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
