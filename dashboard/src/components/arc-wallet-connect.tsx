"use client";

import { BrowserProvider } from "ethers";
import { CheckCircle2, Link2, LoaderCircle, Unplug, WalletCards, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { disconnectArcWallet, openArcWallet } from "@/lib/arc-wallet-appkit";

type WalletIdentity = { id: string; accountId: string; network: string; walletProvider: string };
type Challenge = { message: string; challengeToken: string };

export function ArcWalletConnect() {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/wallet", { cache: "no-store" }).then(async (response) => {
      const body = response.ok ? await response.json() as { data?: { identities?: WalletIdentity[] } } : null;
      if (active) setIdentity(body?.data?.identities?.find((item) => item.network === "eip155:5042002") ?? null);
    }).catch(() => { if (active) setIdentity(null); });
    return () => { active = false; };
  }, []);

  async function connect() {
    if (!projectId) return setError("WalletConnect project ID is not configured yet.");
    setBusy(true); setError(null);
    try {
      const session = await openArcWallet(projectId);
      const response = await fetch(`/api/v1/wallet/challenge?network=eip155%3A5042002&accountId=${encodeURIComponent(session.accountId)}`);
      const body = await response.json() as { data?: Challenge; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail ?? "Could not create the wallet challenge.");
      const signature = await new BrowserProvider(session.provider).getSigner().then((signer) => signer.signMessage(body.data!.message));
      const linkedResponse = await fetch("/api/v1/wallet", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ proofType: "evm", challengeToken: body.data.challengeToken, signature, walletProvider: "EVM wallet via Reown" }),
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
      if (projectId) await disconnectArcWallet(projectId).catch(() => undefined);
      const response = await fetch("/api/v1/wallet?network=eip155%3A5042002", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not unlink the wallet.");
      setIdentity(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not unlink the wallet."); }
    finally { setBusy(false); }
  }

  return <div className="wallet-control">
    <button className={`wallet-trigger${identity ? " connected" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <WalletCards size={16} />{identity ? identity.accountId : "Connect wallet"}
    </button>
    {open && <section className="wallet-popover" aria-label="Arc wallet connection">
      <div className="wallet-popover-heading"><div><strong>Arc payment identity</strong><span>Self custody · Testnet</span></div>{identity ? <CheckCircle2 size={18} className="wallet-ok" /> : <XCircle size={18} className="wallet-muted" />}</div>
      {identity ? <div className="wallet-identity"><span>MetaMask, Rabby, Coinbase or Reown</span><strong>{identity.accountId}</strong><small>Ownership signature verified for Arc Testnet</small></div> : <p>Connect an injected or Reown wallet, switch to Arc Testnet, and sign a one-time ownership challenge. This does not authorize a payment.</p>}
      {error && <div className="wallet-error" role="alert">{error}</div>}
      {identity
        ? <button className="secondary-button wallet-action" type="button" disabled={busy} onClick={() => void disconnect()}><Unplug size={15} />Unlink wallet</button>
        : <button className="primary-button wallet-action" type="button" disabled={busy || !projectId} onClick={() => void connect()}>{busy ? <LoaderCircle className="wallet-spin" size={15} /> : <Link2 size={15} />}Connect Arc wallet</button>}
    </section>}
  </div>;
}
