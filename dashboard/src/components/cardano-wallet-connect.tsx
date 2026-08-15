"use client";

import { CheckCircle2, Link2, LoaderCircle, Unplug, WalletCards, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNetwork } from "@/domain/network-context";
import {
  disconnectCardanoWallet,
  installedCardanoWallets,
  openCardanoWallet,
  signCardanoData,
  type CardanoWalletOption,
  type SupportedCardanoWallet,
} from "@/lib/cardano-browser-wallet";

type WalletIdentity = { id: string; accountId: string; network: string; walletProvider: string };
type Challenge = { message: string; challengeToken: string };

function shortAddress(address: string) {
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

export function CardanoWalletConnect() {
  const { network } = useNetwork();
  const cardanoNetwork = network === "cardano:mainnet" ? "cardano:mainnet" : "cardano:preprod";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [wallets, setWallets] = useState<CardanoWalletOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/v1/wallet", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      installedCardanoWallets(),
    ]).then(([body, installed]) => {
      if (!active) return;
      setError(null);
      setIdentity((body as { data?: { identities?: WalletIdentity[] } } | null)?.data?.identities?.find((item) => item.network === cardanoNetwork) ?? null);
      setWallets(installed);
    }).catch(() => { if (active) setWallets([]); });
    return () => { active = false; };
  }, [cardanoNetwork]);

  async function connect(walletId: SupportedCardanoWallet) {
    setBusy(true); setError(null);
    try {
      const session = await openCardanoWallet(walletId, cardanoNetwork);
      const response = await fetch(`/api/v1/wallet/challenge?network=${encodeURIComponent(cardanoNetwork)}&accountId=${encodeURIComponent(session.address)}`);
      const body = await response.json() as { data?: Challenge; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail ?? "Could not create the wallet challenge.");
      const signature = await signCardanoData(session, body.data.message);
      const linkedResponse = await fetch("/api/v1/wallet", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ proofType: "cardano", challengeToken: body.data.challengeToken, signature, walletProvider: session.walletId }),
      });
      const linked = await linkedResponse.json();
      if (!linkedResponse.ok) throw new Error(linked.detail ?? "Wallet verification failed.");
      setIdentity(linked.data.identity as WalletIdentity);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Wallet connection was cancelled."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setError(null);
    try {
      disconnectCardanoWallet();
      const response = await fetch(`/api/v1/wallet?network=${encodeURIComponent(cardanoNetwork)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not unlink the wallet.");
      setIdentity(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not unlink the wallet."); }
    finally { setBusy(false); }
  }

  return <div className="wallet-control">
    <button className={`wallet-trigger${identity ? " connected" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <WalletCards size={16} />{identity ? <span title={identity.accountId}>{shortAddress(identity.accountId)}</span> : "Connect wallet"}
    </button>
    {open && <section className="wallet-popover" aria-label="Cardano wallet connection">
      <div className="wallet-popover-heading"><div><strong>Cardano payment identity</strong><span>Self custody · {cardanoNetwork === "cardano:mainnet" ? "Mainnet" : "Preprod"}</span></div>{identity ? <CheckCircle2 size={18} className="wallet-ok" /> : <XCircle size={18} className="wallet-muted" />}</div>
      {identity ? <div className="wallet-identity"><span>{identity.walletProvider}</span><strong title={identity.accountId}>{shortAddress(identity.accountId)}</strong><small>CIP-30 ownership signature verified for {cardanoNetwork}</small></div> : <p>Choose Eternl, Lace, Vespr, or Nami. AgentPay validates the wallet network and asks for a one-time CIP-30 ownership signature.</p>}
      {error && <div className="wallet-error" role="alert">{error}</div>}
      {identity
        ? <button className="secondary-button wallet-action" type="button" disabled={busy} onClick={() => void disconnect()}><Unplug size={15} />Unlink wallet</button>
        : <div className="wallet-provider-list">{wallets.length > 0 ? wallets.map((wallet) => <button key={wallet.id} className="secondary-button wallet-action" type="button" disabled={busy} onClick={() => void connect(wallet.id)}>{busy ? <LoaderCircle className="wallet-spin" size={15} /> : <Link2 size={15} />}Connect {wallet.name}</button>) : <small className="wallet-setup-note">Install Eternl, Lace, Vespr, or Nami, then reload this page.</small>}</div>}
    </section>}
  </div>;
}
