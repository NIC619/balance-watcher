"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Account = {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  chain_name: string;
  symbol: string;
  threshold: string;
  balance: string | null;
  status: "healthy" | "low" | "pending" | "error";
  last_checked_at: string | null;
};

type Network = {
  chainId: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  color: string;
};

type Settings = {
  telegramBotToken: string;
  telegramChatId: string;
  telegramConfigured: boolean;
  checkIntervalMinutes: number;
};

type DashboardData = {
  accounts: Account[];
  networks: Network[];
  settings: Settings;
};

type AccountDraft = {
  id?: number;
  name: string;
  address: string;
  chainId: string;
  threshold: string;
};

const emptyAccount: AccountDraft = {
  name: "",
  address: "",
  chainId: "1",
  threshold: "0.05",
};

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatChecked(value: string | null) {
  if (!value) return "Not checked yet";
  const difference = Math.max(0, Date.now() - new Date(value).getTime());
  if (difference < 60_000) return "Checked just now";
  if (difference < 3_600_000) return `Checked ${Math.floor(difference / 60_000)}m ago`;
  return `Checked ${Math.floor(difference / 3_600_000)}h ago`;
}

function displayBalance(balance: string | null) {
  if (balance === null) return "—";
  const numeric = Number(balance);
  if (!Number.isFinite(numeric)) return balance;
  if (numeric === 0) return "0";
  if (numeric < 0.0001) return numeric.toExponential(2);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 5 });
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null);
  const [duplicate, setDuplicate] = useState<{ account: Account; chainId: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const payload = (await response.json()) as DashboardData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Could not load dashboard.");
    setData(payload);
  }, []);

  useEffect(() => {
    load().catch((error: Error) => notify(error.message, true));
  }, [load, notify]);

  useEffect(() => {
    if (!data?.settings?.checkIntervalMinutes) return;
    const interval = window.setInterval(() => {
      fetch("/api/monitor", { method: "POST" })
        .then(() => load())
        .catch(() => undefined);
    }, data.settings.checkIntervalMinutes * 60_000);
    return () => window.clearInterval(interval);
  }, [data?.settings?.checkIntervalMinutes, load]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const groups = new Map<number, Account[]>();
    for (const account of data.accounts) {
      const group = groups.get(account.chain_id) || [];
      group.push(account);
      groups.set(account.chain_id, group);
    }
    return [...groups.entries()]
      .map(([chainId, accounts]) => ({
        network: data.networks.find((network) => network.chainId === chainId),
        accounts,
      }))
      .sort((a, b) => (a.network?.name || "").localeCompare(b.network?.name || ""));
  }, [data]);

  const lowCount = data?.accounts.filter((account) => account.status === "low").length || 0;
  const healthyCount = data?.accounts.filter((account) => account.status === "healthy").length || 0;

  async function mutate(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Request failed.");
      await load();
      notify(successMessage);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Request failed.", true);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!accountDraft) return;
    try {
      await mutate(
        {
          action: accountDraft.id ? "update" : "create",
          ...accountDraft,
          chainId: Number(accountDraft.chainId),
        },
        accountDraft.id ? "Account updated." : "Account added."
      );
      setAccountDraft(null);
    } catch {
      // The inline toast already explains the validation error.
    }
  }

  async function runCheck() {
    setBusy(true);
    try {
      const response = await fetch("/api/monitor", { method: "POST" });
      const payload = (await response.json()) as {
        error?: string;
        checked?: number;
        low?: number;
        failed?: number;
        notified?: number;
      };
      if (!response.ok) throw new Error(payload.error || "Balance check failed.");
      await load();
      const detail = payload.failed
        ? `${payload.checked} checked, ${payload.failed} failed.`
        : `${payload.checked} account${payload.checked === 1 ? "" : "s"} checked.`;
      notify(`${detail}${payload.notified ? ` ${payload.notified} alert sent.` : ""}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Balance check failed.", true);
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    if (!data) return;
    setSettingsDraft({ ...data.settings });
    setSettingsOpen(true);
  }

  async function saveSettings(sendTest = false) {
    if (!settingsDraft) return;
    setBusy(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settingsDraft, sendTest }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save settings.");
      await load();
      notify(sendTest ? "Test message sent to Telegram." : "Notification settings saved.");
      if (!sendTest) setSettingsOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save settings.", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <span>Watchtower</span>
        </div>
        <div className="top-actions">
          <div className="status-live">
            <span className="status-dot" />
            {data?.settings.telegramConfigured ? "Telegram connected" : "Monitor ready"}
          </div>
          <button className="icon-button" onClick={openSettings} aria-label="Open notification settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {busy && <div className="loading-line" />}

      <main className="main">
        <section className="hero">
          <div>
            <p className="eyebrow">EVM balance monitoring</p>
            <h1>Keep every account above the line.</h1>
            <p className="hero-copy">
              Monitor native balances across networks and get a Telegram alert the moment an account falls below its safety threshold.
            </p>
          </div>
          <button className="button button-primary" onClick={() => setAccountDraft({ ...emptyAccount })}>
            <span>＋</span> Add account
          </button>
        </section>

        <section className="summary-grid" aria-label="Monitoring summary">
          <div className="summary-item">
            <span className="summary-label">Accounts watched</span>
            <span className="summary-value">{data?.accounts.length ?? "—"}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Healthy balances</span>
            <span className="summary-value">{data ? healthyCount : "—"}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Below threshold</span>
            <span className={`summary-value ${lowCount ? "alert-text" : ""}`}>{data ? lowCount : "—"}</span>
          </div>
        </section>

        <section>
          <div className="toolbar">
            <div className="section-title">
              <h2>Watched accounts</h2>
              <span className="count-pill">{data?.accounts.length || 0}</span>
            </div>
            <div className="toolbar-actions">
              <button className="button button-secondary" onClick={openSettings}>
                {data?.settings.telegramConfigured ? "Telegram ✓" : "Connect Telegram"}
              </button>
              <button className="button button-secondary" onClick={runCheck} disabled={busy}>
                ↻ Check now
              </button>
            </div>
          </div>

          {!data ? (
            <div className="empty-state">
              <div className="empty-mark">↻</div>
              <h3>Loading your watchlist</h3>
              <p>Connecting to the monitor…</p>
            </div>
          ) : data.accounts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-mark">＋</div>
              <h3>No accounts yet</h3>
              <p>Add your first account and set the balance that should trigger an alert.</p>
              <button className="button button-primary" onClick={() => setAccountDraft({ ...emptyAccount })}>
                Add your first account
              </button>
            </div>
          ) : (
            grouped.map(({ network, accounts }) => (
              <div className="network-section" key={accounts[0].chain_id}>
                <div className="network-header">
                  <div className="network-label">
                    <span className="network-glyph" style={{ "--network-color": network?.color } as React.CSSProperties}>
                      {network?.name.slice(0, 2).toUpperCase() || "EV"}
                    </span>
                    {network?.name || accounts[0].chain_name}
                    <span className="chain-id">#{accounts[0].chain_id}</span>
                  </div>
                  <span className="chain-id">{accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
                </div>
                <div className="account-grid">
                  {accounts.map((account) => (
                    <article className="account-card" key={account.id}>
                      <div className="account-head">
                        <div>
                          <div className="account-name">{account.name}</div>
                          <div className="account-address" title={account.address}>{shortenAddress(account.address)}</div>
                        </div>
                        <span className={`status-pill ${account.status}`}>
                          {account.status === "low"
                            ? "Low balance"
                            : account.status === "healthy"
                              ? "Healthy"
                              : account.status === "error"
                                ? "Check failed"
                                : "Pending"}
                        </span>
                      </div>
                      <div className="balance-line">
                        <div className="balance">
                          {displayBalance(account.balance)}
                          <span className="balance-symbol">{account.symbol}</span>
                        </div>
                        <div className="threshold">
                          Alert below
                          <strong>{account.threshold} {account.symbol}</strong>
                        </div>
                      </div>
                      <div className="account-meta">
                        <span className="checked">{formatChecked(account.last_checked_at)}</span>
                        <div className="account-actions">
                          <button
                            className="tiny-button"
                            onClick={() =>
                              setDuplicate({
                                account,
                                chainId: String(data.networks.find((item) => item.chainId !== account.chain_id)?.chainId || 1),
                              })
                            }
                          >
                            Duplicate
                          </button>
                          <button
                            className="tiny-button"
                            onClick={() =>
                              setAccountDraft({
                                id: account.id,
                                name: account.name,
                                address: account.address,
                                chainId: String(account.chain_id),
                                threshold: account.threshold,
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="tiny-button"
                            onClick={() => {
                              if (window.confirm(`Stop watching ${account.name} on ${account.chain_name}?`)) {
                                mutate({ action: "delete", id: account.id }, "Account removed.").catch(() => undefined);
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {accountDraft && data && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAccountDraft(null);
        }}>
          <form className="modal" onSubmit={saveAccount}>
            <h2>{accountDraft.id ? "Edit account" : "Add an account"}</h2>
            <p className="modal-intro">
              Watch the native gas-token balance for any Ethereum-compatible address.
            </p>
            <div className="form-grid">
              <div className="field field-full">
                <label htmlFor="account-name">Name tag</label>
                <input
                  id="account-name"
                  value={accountDraft.name}
                  onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })}
                  placeholder="e.g. Production relayer"
                  autoFocus
                  required
                />
              </div>
              <div className="field field-full">
                <label htmlFor="account-address">Account address</label>
                <input
                  id="account-address"
                  value={accountDraft.address}
                  onChange={(event) => setAccountDraft({ ...accountDraft, address: event.target.value })}
                  placeholder="0x…"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="account-network">Network</label>
                <select
                  id="account-network"
                  value={accountDraft.chainId}
                  onChange={(event) => setAccountDraft({ ...accountDraft, chainId: event.target.value })}
                >
                  {data.networks.map((network) => (
                    <option value={network.chainId} key={network.chainId}>{network.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="account-threshold">Low-balance threshold</label>
                <input
                  id="account-threshold"
                  type="number"
                  min="0"
                  step="any"
                  value={accountDraft.threshold}
                  onChange={(event) => setAccountDraft({ ...accountDraft, threshold: event.target.value })}
                  required
                />
                <span className="helper">In the network’s native token.</span>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setAccountDraft(null)}>Cancel</button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {accountDraft.id ? "Save changes" : "Start watching"}
              </button>
            </div>
          </form>
        </div>
      )}

      {duplicate && data && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDuplicate(null);
        }}>
          <div className="modal">
            <h2>Duplicate to a network</h2>
            <p className="modal-intro">
              Add {duplicate.account.name} with the same address and threshold on another chain.
            </p>
            <div className="field">
              <label htmlFor="duplicate-network">Target network</label>
              <select
                id="duplicate-network"
                value={duplicate.chainId}
                onChange={(event) => setDuplicate({ ...duplicate, chainId: event.target.value })}
              >
                {data.networks
                  .filter((network) => network.chainId !== duplicate.account.chain_id)
                  .map((network) => (
                    <option value={network.chainId} key={network.chainId}>{network.name}</option>
                  ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setDuplicate(null)}>Cancel</button>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={async () => {
                  try {
                    await mutate(
                      { action: "duplicate", id: duplicate.account.id, chainId: Number(duplicate.chainId) },
                      "Account duplicated."
                    );
                    setDuplicate(null);
                  } catch {
                    // Toast already shown.
                  }
                }}
              >
                Duplicate account
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && settingsDraft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <div className="modal modal-wide">
            <h2>Telegram notifications</h2>
            <p className="modal-intro">
              Watchtower sends one alert when an account crosses below its threshold. A new alert can fire after the balance recovers.
            </p>
            <div className="form-grid">
              <div className="field field-full">
                <label htmlFor="bot-token">Telegram bot token</label>
                <input
                  id="bot-token"
                  type="password"
                  value={settingsDraft.telegramBotToken}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, telegramBotToken: event.target.value })}
                  placeholder="123456789:AA…"
                  autoComplete="off"
                />
                <span className="helper">Create a bot with @BotFather, then paste its token here.</span>
              </div>
              <div className="field">
                <label htmlFor="chat-id">Chat ID</label>
                <input
                  id="chat-id"
                  value={settingsDraft.telegramChatId}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, telegramChatId: event.target.value })}
                  placeholder="-1001234567890"
                />
              </div>
              <div className="field">
                <label htmlFor="check-interval">Check every</label>
                <select
                  id="check-interval"
                  value={settingsDraft.checkIntervalMinutes}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, checkIntervalMinutes: Number(event.target.value) })
                  }
                >
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="button button-ghost" onClick={() => saveSettings(true)} disabled={busy}>Send test</button>
              <button className="button button-secondary" onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button className="button button-primary" onClick={() => saveSettings(false)} disabled={busy}>Save settings</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`} role="status">{toast.message}</div>}
    </div>
  );
}
