"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Account = {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  chain_name: string;
  symbol: string;
  asset_type: "native" | "erc20";
  token_address: string | null;
  token_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  threshold: string;
  balance: string | null;
  status: "healthy" | "low" | "pending" | "error";
  last_checked_at: string | null;
};

type Network = {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  color: string;
  environment: "mainnet" | "testnet";
  isPreset: boolean;
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
  assetType: "native" | "erc20";
  tokenAddress: string;
  token: TokenMetadata | null;
  threshold: string;
};

type TokenMetadata = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  chainId: number;
};

type NetworkDraft = {
  chainId?: number;
  name: string;
  rpcUrl: string;
  nativeSymbol: string;
  environment: "mainnet" | "testnet";
  color: string;
};

const emptyAccount: AccountDraft = {
  name: "",
  address: "",
  chainId: "1",
  assetType: "native",
  tokenAddress: "",
  token: null,
  threshold: "0.05",
};

const emptyNetwork: NetworkDraft = {
  name: "",
  rpcUrl: "",
  nativeSymbol: "ETH",
  environment: "mainnet",
  color: "#356b52",
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

function rpcHostname(rpcUrl: string) {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null);
  const [duplicate, setDuplicate] = useState<{ account: Account; chainId: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [networksOpen, setNetworksOpen] = useState(false);
  const [networkDraft, setNetworkDraft] = useState<NetworkDraft | null>(null);
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
    // Initial synchronization with the authenticated server-side watchlist.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((error: Error) => notify(error.message, true));
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
      .sort((a, b) => {
        const environmentOrder = (a.network?.environment === "testnet" ? 1 : 0)
          - (b.network?.environment === "testnet" ? 1 : 0);
        return environmentOrder || (a.network?.name || "").localeCompare(b.network?.name || "");
      });
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
    if (accountDraft.assetType === "erc20" && !accountDraft.token) {
      notify("Validate the ERC-20 token before saving.", true);
      return;
    }
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

  async function validateToken() {
    if (!accountDraft) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tokens/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: Number(accountDraft.chainId),
          tokenAddress: accountDraft.tokenAddress,
        }),
      });
      const payload = (await response.json()) as {
        token?: Omit<TokenMetadata, "chainId">;
        error?: string;
      };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error || "Could not validate token.");
      }
      setAccountDraft({
        ...accountDraft,
        tokenAddress: payload.token.address,
        token: { ...payload.token, chainId: Number(accountDraft.chainId) },
      });
      notify(`${payload.token.name} (${payload.token.symbol}) validated.`);
    } catch (error) {
      setAccountDraft({ ...accountDraft, token: null });
      notify(error instanceof Error ? error.message : "Could not validate token.", true);
    } finally {
      setBusy(false);
    }
  }

  async function saveNetwork(event: React.FormEvent) {
    event.preventDefault();
    if (!networkDraft) return;
    setBusy(true);
    try {
      const response = await fetch("/api/networks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: networkDraft.chainId ? "update" : "create",
          ...networkDraft,
        }),
      });
      const payload = (await response.json()) as {
        chainId?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not save network.");
      await load();
      notify(
        networkDraft.chainId
          ? "Network updated and RPC validated."
          : `Network added with chain ID ${payload.chainId}.`
      );
      setNetworkDraft(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save network.", true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteNetwork(network: Network) {
    if (!window.confirm(`Delete ${network.name} from configured networks?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/networks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", chainId: network.chainId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not delete network.");
      await load();
      notify("Network deleted.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete network.", true);
    } finally {
      setBusy(false);
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
          <button
            className="signout-button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.assign("/login");
            }}
          >
            Sign out
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
              Monitor native and ERC-20 balances across configured EVM networks and get a Telegram alert when an account falls below its safety threshold.
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() =>
              setAccountDraft({
                ...emptyAccount,
                chainId: String(data?.networks[0]?.chainId || 1),
              })
            }
          >
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
              <button
                className="button button-secondary"
                onClick={() => setNetworksOpen(true)}
              >
                Manage networks
              </button>
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
              <button
                className="button button-primary"
                onClick={() =>
                  setAccountDraft({
                    ...emptyAccount,
                    chainId: String(data.networks[0]?.chainId || 1),
                  })
                }
              >
                Add your first account
              </button>
            </div>
          ) : (
            grouped.map(({ network, accounts }) => (
              <div
                className={`network-section ${network?.environment === "testnet" ? "network-testnet" : "network-mainnet"}`}
                key={accounts[0].chain_id}
              >
                <div className="network-header">
                  <div className="network-label">
                    <span className="network-glyph" style={{ "--network-color": network?.color } as React.CSSProperties}>
                      {network?.name.slice(0, 2).toUpperCase() || "EV"}
                    </span>
                    {network?.name || accounts[0].chain_name}
                    <span className="chain-id">#{accounts[0].chain_id}</span>
                    <span className={`network-kind ${network?.environment || "mainnet"}`}>
                      {network?.environment === "testnet" ? "Testnet" : "Mainnet"}
                    </span>
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
                          {account.asset_type === "erc20" && (
                            <div
                              className="asset-label"
                              title={account.token_address || undefined}
                            >
                              Token · {account.token_name || account.symbol}
                              <span>{account.token_address ? shortenAddress(account.token_address) : ""}</span>
                            </div>
                          )}
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
                                assetType: account.asset_type,
                                tokenAddress: account.token_address || "",
                                token: account.asset_type === "erc20" && account.token_address
                                  ? {
                                      address: account.token_address,
                                      name: account.token_name || account.symbol,
                                      symbol: account.token_symbol || account.symbol,
                                      decimals: account.token_decimals ?? 18,
                                      chainId: account.chain_id,
                                    }
                                  : null,
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
              Watch a native gas token or a validated ERC-20 contract balance.
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
              <div className="field field-full">
                <label htmlFor="account-asset">Asset type</label>
                <select
                  id="account-asset"
                  value={accountDraft.assetType}
                  onChange={(event) => {
                    const assetType = event.target.value === "erc20" ? "erc20" : "native";
                    setAccountDraft({
                      ...accountDraft,
                      assetType,
                      tokenAddress: assetType === "native" ? "" : accountDraft.tokenAddress,
                      token: assetType === "native" ? null : accountDraft.token,
                    });
                  }}
                >
                  <option value="native">Native gas token</option>
                  <option value="erc20">ERC-20 token</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="account-network">Network</label>
                <select
                  id="account-network"
                  value={accountDraft.chainId}
                  onChange={(event) =>
                    setAccountDraft({
                      ...accountDraft,
                      chainId: event.target.value,
                      token: null,
                    })
                  }
                >
                  {data.networks.map((network) => (
                    <option value={network.chainId} key={network.chainId}>
                      {network.name} · {network.environment === "testnet" ? "Testnet" : "Mainnet"}
                    </option>
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
                <span className="helper">
                  In {accountDraft.assetType === "erc20"
                    ? accountDraft.token?.symbol || "the token’s units"
                    : "the network’s native token"}.
                </span>
              </div>
              {accountDraft.assetType === "erc20" && (
                <div className="field field-full">
                  <label htmlFor="token-address">ERC-20 token contract</label>
                  <div className="field-action-row">
                    <input
                      id="token-address"
                      value={accountDraft.tokenAddress}
                      onChange={(event) =>
                        setAccountDraft({
                          ...accountDraft,
                          tokenAddress: event.target.value,
                          token: null,
                        })
                      }
                      placeholder="0x…"
                      spellCheck={false}
                      required
                    />
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={validateToken}
                      disabled={busy || !accountDraft.tokenAddress}
                    >
                      Validate
                    </button>
                  </div>
                  {accountDraft.token ? (
                    <div className="validation-result">
                      <strong>✓ {accountDraft.token.name}</strong>
                      <span>
                        {accountDraft.token.symbol} · {accountDraft.token.decimals} decimals
                      </span>
                    </div>
                  ) : (
                    <span className="helper">
                      The contract must pass on-chain code, totalSupply, balanceOf, and decimals checks before it can be saved.
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setAccountDraft(null)}>Cancel</button>
              <button
                type="submit"
                className="button button-primary"
                disabled={
                  busy ||
                  (accountDraft.assetType === "erc20" && !accountDraft.token)
                }
              >
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
                    <option value={network.chainId} key={network.chainId}>
                      {network.name} · {network.environment === "testnet" ? "Testnet" : "Mainnet"}
                    </option>
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

      {networksOpen && data && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setNetworksOpen(false);
            setNetworkDraft(null);
          }
        }}>
          <div className="modal modal-networks">
            <div className="modal-heading-row">
              <div>
                <h2>Networks</h2>
                <p className="modal-intro">
                  Add custom EVM networks or update RPC endpoints. Every RPC is checked against its on-chain chain ID before saving.
                </p>
              </div>
              {!networkDraft && (
                <button
                  className="button button-primary"
                  onClick={() => setNetworkDraft({ ...emptyNetwork })}
                >
                  ＋ Add network
                </button>
              )}
            </div>

            <div className="network-manager-list">
              {data.networks.map((network) => (
                <div className="network-manager-item" key={network.chainId}>
                  <span
                    className="network-glyph"
                    style={{ "--network-color": network.color } as React.CSSProperties}
                  >
                    {network.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="network-manager-info">
                    <strong>{network.name}</strong>
                    <span>
                      #{network.chainId} · {network.nativeSymbol} · {rpcHostname(network.rpcUrl)}
                    </span>
                  </div>
                  <span className={`network-kind ${network.environment}`}>
                    {network.environment === "testnet" ? "Testnet" : "Mainnet"}
                  </span>
                  <div className="account-actions">
                    <button
                      className="tiny-button"
                      onClick={() =>
                        setNetworkDraft({
                          chainId: network.chainId,
                          name: network.name,
                          rpcUrl: network.rpcUrl,
                          nativeSymbol: network.nativeSymbol,
                          environment: network.environment,
                          color: /^#[0-9a-fA-F]{6}$/.test(network.color)
                            ? network.color
                            : "#356b52",
                        })
                      }
                    >
                      Edit
                    </button>
                    {!network.isPreset && (
                      <button
                        className="tiny-button danger"
                        onClick={() => void deleteNetwork(network)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {networkDraft && (
              <form className="network-editor" onSubmit={saveNetwork}>
                <h3>{networkDraft.chainId ? "Edit network" : "Add custom network"}</h3>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="network-name">Network name</label>
                    <input
                      id="network-name"
                      value={networkDraft.name}
                      onChange={(event) =>
                        setNetworkDraft({ ...networkDraft, name: event.target.value })
                      }
                      placeholder="e.g. Gnosis"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="network-symbol">Native token symbol</label>
                    <input
                      id="network-symbol"
                      value={networkDraft.nativeSymbol}
                      onChange={(event) =>
                        setNetworkDraft({
                          ...networkDraft,
                          nativeSymbol: event.target.value.toUpperCase(),
                        })
                      }
                      placeholder="ETH"
                      required
                    />
                  </div>
                  <div className="field field-full">
                    <label htmlFor="network-rpc">RPC URL</label>
                    <input
                      id="network-rpc"
                      type="url"
                      value={networkDraft.rpcUrl}
                      onChange={(event) =>
                        setNetworkDraft({ ...networkDraft, rpcUrl: event.target.value })
                      }
                      placeholder="https://…"
                      spellCheck={false}
                      required
                    />
                    <span className="helper">
                      Watchtower calls eth_chainId and derives the chain ID automatically.
                    </span>
                  </div>
                  {networkDraft.chainId && (
                    <div className="field">
                      <label>Chain ID</label>
                      <input value={networkDraft.chainId} disabled readOnly />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="network-environment">Environment</label>
                    <select
                      id="network-environment"
                      value={networkDraft.environment}
                      onChange={(event) =>
                        setNetworkDraft({
                          ...networkDraft,
                          environment: event.target.value === "testnet"
                            ? "testnet"
                            : "mainnet",
                        })
                      }
                    >
                      <option value="mainnet">Production / mainnet</option>
                      <option value="testnet">Testnet</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="network-color">Color</label>
                    <input
                      id="network-color"
                      className="color-input"
                      type="color"
                      value={networkDraft.color}
                      onChange={(event) =>
                        setNetworkDraft({ ...networkDraft, color: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setNetworkDraft(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary" disabled={busy}>
                    Validate RPC & save
                  </button>
                </div>
              </form>
            )}

            {!networkDraft && (
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setNetworksOpen(false)}
                >
                  Done
                </button>
              </div>
            )}
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
