"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Asset = {
  id: number;
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

type Wallet = {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  chain_name: string;
  assets: Asset[];
};

type Network = {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorerUrl: string | null;
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
  wallets: Wallet[];
  networks: Network[];
  settings: Settings;
};

type AssetDraft = {
  id?: number;
  assetType: "native" | "erc20";
  tokenAddress: string;
  token: TokenMetadata | null;
  threshold: string;
};

type WalletDraft = {
  id?: number;
  name: string;
  address: string;
  chainId: string;
  assets: AssetDraft[];
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
  explorerUrl: string;
  nativeSymbol: string;
  environment: "mainnet" | "testnet";
  color: string;
};

const emptyWallet: WalletDraft = {
  name: "",
  address: "",
  chainId: "1",
  assets: [
    {
      assetType: "native",
      tokenAddress: "",
      token: null,
      threshold: "0.05",
    },
  ],
};

const emptyNetwork: NetworkDraft = {
  name: "",
  rpcUrl: "",
  explorerUrl: "",
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

function explorerAddressUrl(explorerUrl: string, address: string) {
  return `${explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

const statusPriority: Record<Asset["status"], number> = {
  healthy: 0,
  pending: 1,
  low: 2,
  error: 3,
};

function statusLabel(status: Asset["status"]) {
  if (status === "low") return "Low balance";
  if (status === "healthy") return "Healthy";
  if (status === "error") return "Check failed";
  return "Pending";
}

function walletStatus(wallet: Wallet): Asset["status"] {
  return wallet.assets.reduce<Asset["status"]>(
    (worst, asset) =>
      statusPriority[asset.status] > statusPriority[worst] ? asset.status : worst,
    "healthy"
  );
}

function walletToDraft(wallet: Wallet): WalletDraft {
  return {
    id: wallet.id,
    name: wallet.name,
    address: wallet.address,
    chainId: String(wallet.chain_id),
    assets: wallet.assets.map((asset) => ({
      id: asset.id,
      assetType: asset.asset_type,
      tokenAddress: asset.token_address || "",
      token:
        asset.asset_type === "erc20" && asset.token_address
          ? {
              address: asset.token_address,
              name: asset.token_name || asset.symbol,
              symbol: asset.token_symbol || asset.symbol,
              decimals: asset.token_decimals ?? 18,
              chainId: wallet.chain_id,
            }
          : null,
      threshold: asset.threshold,
    })),
  };
}

function newWalletDraft(chainId: number): WalletDraft {
  return {
    ...emptyWallet,
    chainId: String(chainId),
    assets: emptyWallet.assets.map((asset) => ({ ...asset })),
  };
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [walletDraft, setWalletDraft] = useState<WalletDraft | null>(null);
  const [duplicate, setDuplicate] = useState<{ wallet: Wallet; chainId: string } | null>(null);
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
    const groups = new Map<number, Wallet[]>();
    for (const wallet of data.wallets) {
      const group = groups.get(wallet.chain_id) || [];
      group.push(wallet);
      groups.set(wallet.chain_id, group);
    }
    return [...groups.entries()]
      .map(([chainId, wallets]) => ({
        network: data.networks.find((network) => network.chainId === chainId),
        wallets,
      }))
      .sort((a, b) => {
        const environmentOrder = (a.network?.environment === "testnet" ? 1 : 0)
          - (b.network?.environment === "testnet" ? 1 : 0);
        return environmentOrder || (a.network?.name || "").localeCompare(b.network?.name || "");
      });
  }, [data]);

  const assets = data?.wallets.flatMap((wallet) => wallet.assets) || [];
  const lowCount = assets.filter((asset) => asset.status === "low").length;

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

  async function saveWallet(event: React.FormEvent) {
    event.preventDefault();
    if (!walletDraft) return;
    if (
      walletDraft.assets.some(
        (asset) => asset.assetType === "erc20" && !asset.token
      )
    ) {
      notify("Validate every ERC-20 token before saving.", true);
      return;
    }
    try {
      await mutate(
        {
          action: "save",
          ...walletDraft,
          chainId: Number(walletDraft.chainId),
        },
        walletDraft.id ? "Watched wallet updated." : "Watched wallet added."
      );
      setWalletDraft(null);
    } catch {
      // The inline toast already explains the validation error.
    }
  }

  async function validateToken(assetIndex: number) {
    if (!walletDraft) return;
    const asset = walletDraft.assets[assetIndex];
    if (!asset) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tokens/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: Number(walletDraft.chainId),
          tokenAddress: asset.tokenAddress,
        }),
      });
      const payload = (await response.json()) as {
        token?: Omit<TokenMetadata, "chainId">;
        error?: string;
      };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error || "Could not validate token.");
      }
      const nextAssets = [...walletDraft.assets];
      nextAssets[assetIndex] = {
        ...asset,
        tokenAddress: payload.token.address,
        token: { ...payload.token, chainId: Number(walletDraft.chainId) },
      };
      setWalletDraft({ ...walletDraft, assets: nextAssets });
      notify(`${payload.token.name} (${payload.token.symbol}) validated.`);
    } catch (error) {
      const nextAssets = [...walletDraft.assets];
      nextAssets[assetIndex] = { ...asset, token: null };
      setWalletDraft({ ...walletDraft, assets: nextAssets });
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
        : `${payload.checked} asset${payload.checked === 1 ? "" : "s"} checked.`;
      notify(`${detail}${payload.notified ? ` ${payload.notified} alert sent.` : ""}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Balance check failed.", true);
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      notify("Account address copied.");
    } catch {
      notify("Could not copy the account address.", true);
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
            onClick={() => setWalletDraft(newWalletDraft(data?.networks[0]?.chainId || 1))}
          >
            <span>＋</span> Add wallet
          </button>
        </section>

        <section className="summary-grid" aria-label="Monitoring summary">
          <div className="summary-item">
            <span className="summary-label">Addresses watched</span>
            <span className="summary-value">{data?.wallets.length ?? "—"}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Assets watched</span>
            <span className="summary-value">{data ? assets.length : "—"}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Below threshold</span>
            <span className={`summary-value ${lowCount ? "alert-text" : ""}`}>{data ? lowCount : "—"}</span>
          </div>
        </section>

        <section>
          <div className="toolbar">
            <div className="section-title">
              <h2>Watched wallets</h2>
              <span className="count-pill">{data?.wallets.length || 0}</span>
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
          ) : data.wallets.length === 0 ? (
            <div className="empty-state">
              <div className="empty-mark">＋</div>
              <h3>No wallets yet</h3>
              <p>Add your first wallet, choose its assets, and set their alert thresholds.</p>
              <button
                className="button button-primary"
                onClick={() => setWalletDraft(newWalletDraft(data.networks[0]?.chainId || 1))}
              >
                Add your first wallet
              </button>
            </div>
          ) : (
            grouped.map(({ network, wallets }) => (
              <div
                className={`network-section ${network?.environment === "testnet" ? "network-testnet" : "network-mainnet"}`}
                key={wallets[0].chain_id}
              >
                <div className="network-header">
                  <div className="network-label">
                    <span className="network-glyph" style={{ "--network-color": network?.color } as React.CSSProperties}>
                      {network?.name.slice(0, 2).toUpperCase() || "EV"}
                    </span>
                    {network?.name || wallets[0].chain_name}
                    <span className="chain-id">#{wallets[0].chain_id}</span>
                    <span className={`network-kind ${network?.environment || "mainnet"}`}>
                      {network?.environment === "testnet" ? "Testnet" : "Mainnet"}
                    </span>
                  </div>
                  <span className="chain-id">
                    {wallets.length} address{wallets.length === 1 ? "" : "es"} ·{" "}
                    {wallets.reduce((total, wallet) => total + wallet.assets.length, 0)} assets
                  </span>
                </div>
                <div className="account-grid">
                  {wallets.map((wallet) => {
                    const overallStatus = walletStatus(wallet);
                    return (
                    <article className="account-card wallet-card" key={wallet.id}>
                      <div className="account-head">
                        <div>
                          <div className="account-name">{wallet.name}</div>
                          {network?.explorerUrl ? (
                            <a
                              className="account-address account-address-action"
                              href={explorerAddressUrl(network.explorerUrl, wallet.address)}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open ${wallet.address} in ${network.name} explorer`}
                            >
                              {shortenAddress(wallet.address)} <span aria-hidden="true">↗</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              className="account-address account-address-action"
                              title={`Copy ${wallet.address}`}
                              onClick={() => void copyAddress(wallet.address)}
                            >
                              {shortenAddress(wallet.address)} <span aria-hidden="true">⧉</span>
                            </button>
                          )}
                        </div>
                        <span className={`status-pill ${overallStatus}`}>
                          {statusLabel(overallStatus)}
                        </span>
                      </div>
                      <div className="wallet-assets">
                        {wallet.assets.map((asset) => (
                          <div className="wallet-asset-row" key={asset.id}>
                            <div className="asset-main">
                              <strong>
                                {asset.asset_type === "native"
                                  ? `${asset.symbol} · Native`
                                  : `${asset.token_name || asset.symbol} · ${asset.symbol}`}
                              </strong>
                              {asset.token_address && (
                                <span title={asset.token_address}>{shortenAddress(asset.token_address)}</span>
                              )}
                              <span className="checked">{formatChecked(asset.last_checked_at)}</span>
                            </div>
                            <div className="asset-balance">
                              {displayBalance(asset.balance)} <span>{asset.symbol}</span>
                            </div>
                            <div className="asset-threshold">
                              Alert below <strong>{asset.threshold} {asset.symbol}</strong>
                            </div>
                            <span className={`status-pill asset-status ${asset.status}`}>
                              {statusLabel(asset.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="account-meta wallet-footer">
                        <span className="checked">{wallet.assets.length} asset{wallet.assets.length === 1 ? "" : "s"} monitored</span>
                        <div className="account-actions">
                          <button
                            className="tiny-button"
                            onClick={() =>
                              setDuplicate({
                                wallet,
                                chainId: String(data.networks.find((item) => item.chainId !== wallet.chain_id)?.chainId || wallet.chain_id),
                              })
                            }
                          >
                            Duplicate
                          </button>
                          <button
                            className="tiny-button"
                            onClick={() => setWalletDraft(walletToDraft(wallet))}
                          >
                            Edit
                          </button>
                          <button
                            className="tiny-button"
                            onClick={() => {
                              if (window.confirm(`Stop watching ${wallet.name} and all its assets on ${wallet.chain_name}?`)) {
                                mutate({ action: "delete", id: wallet.id }, "Wallet removed.").catch(() => undefined);
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  )})}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {walletDraft && data && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setWalletDraft(null);
        }}>
          <form className="modal modal-wallet" onSubmit={saveWallet}>
            <h2>{walletDraft.id ? "Edit wallet" : "Add a wallet"}</h2>
            <p className="modal-intro">
              Configure the address once, then add or remove every asset you want to monitor.
            </p>
            <div className="form-grid">
              <div className="field field-full">
                <label htmlFor="wallet-name">Name tag</label>
                <input
                  id="wallet-name"
                  value={walletDraft.name}
                  onChange={(event) => setWalletDraft({ ...walletDraft, name: event.target.value })}
                  placeholder="e.g. Production relayer"
                  autoFocus
                  required
                />
              </div>
              <div className="field field-full">
                <label htmlFor="wallet-address">Account address</label>
                <input
                  id="wallet-address"
                  value={walletDraft.address}
                  onChange={(event) => setWalletDraft({ ...walletDraft, address: event.target.value })}
                  placeholder="0x…"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="field field-full">
                <label htmlFor="wallet-network">Network</label>
                <select
                  id="wallet-network"
                  value={walletDraft.chainId}
                  onChange={(event) =>
                    setWalletDraft({
                      ...walletDraft,
                      chainId: event.target.value,
                      assets: walletDraft.assets.map((asset) => ({
                        ...asset,
                        token: asset.assetType === "erc20" ? null : asset.token,
                      })),
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
            </div>

            <div className="asset-editor-heading">
              <div>
                <h3>Watched assets</h3>
                <p>Add a native balance or validated ERC-20 contracts.</p>
              </div>
              <div className="asset-editor-actions">
                {!walletDraft.assets.some((asset) => asset.assetType === "native") && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setWalletDraft({
                      ...walletDraft,
                      assets: [...walletDraft.assets, {
                        assetType: "native",
                        tokenAddress: "",
                        token: null,
                        threshold: "0.05",
                      }],
                    })}
                  >
                    ＋ Native
                  </button>
                )}
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setWalletDraft({
                    ...walletDraft,
                    assets: [...walletDraft.assets, {
                      assetType: "erc20",
                      tokenAddress: "",
                      token: null,
                      threshold: "1",
                    }],
                  })}
                >
                  ＋ ERC-20
                </button>
              </div>
            </div>

            <div className="asset-editor-list">
              {walletDraft.assets.map((asset, index) => (
                <div className="asset-editor" key={asset.id || `new-${index}`}>
                  <div className="asset-editor-title">
                    <strong>{asset.assetType === "native" ? "Native gas token" : `ERC-20 token ${index + 1}`}</strong>
                    <button
                      type="button"
                      className="tiny-button"
                      disabled={walletDraft.assets.length === 1}
                      onClick={() => setWalletDraft({
                        ...walletDraft,
                        assets: walletDraft.assets.filter((_, assetIndex) => assetIndex !== index),
                      })}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="form-grid">
                    {asset.assetType === "erc20" && (
                      <div className="field field-full">
                        <label htmlFor={`token-address-${index}`}>Token contract</label>
                        <div className="field-action-row">
                          <input
                            id={`token-address-${index}`}
                            value={asset.tokenAddress}
                            onChange={(event) => {
                              const nextAssets = [...walletDraft.assets];
                              nextAssets[index] = { ...asset, tokenAddress: event.target.value, token: null };
                              setWalletDraft({ ...walletDraft, assets: nextAssets });
                            }}
                            placeholder="0x…"
                            spellCheck={false}
                            required
                          />
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => validateToken(index)}
                            disabled={busy || !asset.tokenAddress}
                          >
                            Validate
                          </button>
                        </div>
                        {asset.token ? (
                          <div className="validation-result">
                            <strong>✓ {asset.token.name}</strong>
                            <span>{asset.token.symbol} · {asset.token.decimals} decimals</span>
                          </div>
                        ) : (
                          <span className="helper">Validate this contract on the selected network before saving.</span>
                        )}
                      </div>
                    )}
                    <div className="field field-full">
                      <label htmlFor={`asset-threshold-${index}`}>Low-balance threshold</label>
                      <input
                        id={`asset-threshold-${index}`}
                        type="number"
                        min="0"
                        step="any"
                        value={asset.threshold}
                        onChange={(event) => {
                          const nextAssets = [...walletDraft.assets];
                          nextAssets[index] = { ...asset, threshold: event.target.value };
                          setWalletDraft({ ...walletDraft, assets: nextAssets });
                        }}
                        required
                      />
                      <span className="helper">
                        In {asset.assetType === "erc20"
                          ? asset.token?.symbol || "the token’s units"
                          : "the network’s native token"}.
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setWalletDraft(null)}>Cancel</button>
              <button
                type="submit"
                className="button button-primary"
                disabled={
                  busy ||
                  walletDraft.assets.length === 0 ||
                  walletDraft.assets.some((asset) => asset.assetType === "erc20" && !asset.token)
                }
              >
                {walletDraft.id ? "Save wallet" : "Start watching"}
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
              Copy {duplicate.wallet.name} and all {duplicate.wallet.assets.length} watched assets to another chain. ERC-20 contracts will be validated on the target network.
            </p>
            <div className="field">
              <label htmlFor="duplicate-network">Target network</label>
              <select
                id="duplicate-network"
                value={duplicate.chainId}
                onChange={(event) => setDuplicate({ ...duplicate, chainId: event.target.value })}
              >
                {data.networks
                  .filter((network) => network.chainId !== duplicate.wallet.chain_id)
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
                      { action: "duplicate", id: duplicate.wallet.id, chainId: Number(duplicate.chainId) },
                      "Wallet duplicated."
                    );
                    setDuplicate(null);
                  } catch {
                    // Toast already shown.
                  }
                }}
              >
                Duplicate wallet
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
                          explorerUrl: network.explorerUrl || "",
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
                  <div className="field field-full">
                    <label htmlFor="network-explorer">Explorer URL (optional)</label>
                    <input
                      id="network-explorer"
                      type="url"
                      value={networkDraft.explorerUrl}
                      onChange={(event) =>
                        setNetworkDraft({ ...networkDraft, explorerUrl: event.target.value })
                      }
                      placeholder="https://explorer.example"
                      spellCheck={false}
                    />
                    <span className="helper">
                      Used to open account pages. Without one, clicking an address copies it.
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
