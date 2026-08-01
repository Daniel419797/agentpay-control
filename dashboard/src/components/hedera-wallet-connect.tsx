"use client";

import type { DAppConnector } from "@hashgraph/hedera-wallet-connect";
import { CheckCircle2, Link2, LoaderCircle, Unplug, WalletCards, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { extractTransactionId, parseHbarToTinybars } from "@/lib/hedera-payment";
import { extractSignatureMap } from "@/lib/wallet-signature-response";
import { useNetwork } from "@/domain/network-context";

type WalletIdentity = { id: string; accountId: string; network: string; walletProvider: string };
type Challenge = { accountId: string; message: string; challengeToken: string };
type PaymentReceipt = { transactionId: string; hashscanUrl: string };
type WalletConnectorState = { instance: DAppConnector; network: string };

export function networkToLedgerIdName(network: string) {
  return network === "hedera:mainnet" ? "mainnet" : "testnet";
}

function networkToSignerPrefix(network: string) {
  return network === "hedera:mainnet" ? "hedera:mainnet" : "hedera:testnet";
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

export function HederaWalletConnect() {
  const { network } = useNetwork();
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const connector = useRef<WalletConnectorState | null>(null);
  const connectorPromise = useRef<Promise<DAppConnector> | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payeeAccountId, setPayeeAccountId] = useState("");
  const [amountHbar, setAmountHbar] = useState("");
  const [purpose, setPurpose] = useState("");

  useEffect(() => {
    void fetch("/api/v1/wallet").then((response) => response.ok ? response.json() : null)
      .then((body: { data?: { identities?: WalletIdentity[] } } | null) => setIdentity(body?.data?.identities?.[0] ?? null));
  }, []);

  const openWalletSession = useCallback(async () => {
    const instance = connector.current?.network === network ? connector.current.instance : null;
    let DAppConnectorClass: typeof DAppConnector;
    let HederaJsonRpcMethod: Record<string, string>;
    let ledgerId: unknown;

    if (!instance && !connectorPromise.current) connectorPromise.current = (async () => {
      try {
        const [wcMod, sdkMod] = await Promise.all([
          import("@hashgraph/hedera-wallet-connect"),
          import("@hiero-ledger/sdk"),
        ]);
        DAppConnectorClass = wcMod.DAppConnector;
        HederaJsonRpcMethod = wcMod.HederaJsonRpcMethod;
        ledgerId = sdkMod.LedgerId.fromString(networkToLedgerIdName(network));
      } catch {
        throw new Error("Failed to load WalletConnect libraries. Check your network connection.");
      }
      const created = new DAppConnectorClass({
        name: "AgentPay Control",
        description: "Connect a Hedera payment identity to AgentPay Control.",
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.svg`],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, ledgerId as any, projectId!, Object.values(HederaJsonRpcMethod));

      try {
        await Promise.race([
          created.init({ logger: "error" }),
          timeout(10_000, "WalletConnect relay timed out. Check your internet connection."),
        ]);
      } catch (initErr) {
        throw new Error(`WalletConnect initialization failed: ${initErr instanceof Error ? initErr.message : "unknown error"}`);
      }
      connector.current = { instance: created, network };
      return created;
    })().finally(() => { connectorPromise.current = null; });

    const activeConnector = instance ?? await connectorPromise.current!;

    try {
      await Promise.race([
        activeConnector.openModal(undefined, true),
        timeout(15_000, `WalletConnect could not create a pairing. Confirm ${window.location.origin} is allowed in Reown Project Domains.`),
      ]);
    } catch (modalErr) {
      throw new Error(`Could not open wallet modal: ${modalErr instanceof Error ? modalErr.message : "unknown error"}`);
    }

    const signer = activeConnector.signers[0];
    if (!signer) throw new Error("The wallet did not share a Hedera account. Open HashPack and approve the connection.");
    return { instance: activeConnector, accountId: signer.getAccountId().toString() };
  }, [network, projectId]);

  async function connectWallet() {
    if (!projectId) { setError("WalletConnect project ID is not configured yet."); return; }
    setBusy(true); setError(null);
    try {
      const { instance, accountId } = await openWalletSession();
      const challengeResponse = await fetch(`/api/v1/wallet/challenge?accountId=${encodeURIComponent(accountId)}&network=${encodeURIComponent(network)}`);
      if (!challengeResponse.ok) throw new Error("Could not create the wallet verification challenge.");
      const challengeBody = await challengeResponse.json() as { data: Challenge };
      const signed = await instance.signMessage({ signerAccountId: `${networkToSignerPrefix(network)}:${accountId}`, message: challengeBody.data.message });
      const signatureMap = extractSignatureMap(signed);
      if (!signatureMap) throw new Error("HashPack did not return a valid signature.");
      const linkResponse = await fetch("/api/v1/wallet", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: challengeBody.data.challengeToken, signatureMap, walletProvider: "HashPack via WalletConnect" })
      });
      const linkBody = await linkResponse.json();
      if (!linkResponse.ok) throw new Error(linkBody.detail ?? "Wallet verification failed.");
      setIdentity(linkBody.data.identity as WalletIdentity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet connection was cancelled.");
    } finally { setBusy(false); }
  }

  async function sendPayment() {
    if (!projectId || !identity) return;
    const amountTinybar = parseHbarToTinybars(amountHbar);
    if (!/^0\.0\.\d+$/.test(payeeAccountId)) { setError("Enter a valid Hedera account such as 0.0.1234."); return; }
    if (!amountTinybar) { setError("Enter an HBAR amount greater than zero with no more than 8 decimal places."); return; }
    if (purpose.trim().length < 2) { setError("Describe the purpose of this payment."); return; }
    setBusy(true); setError(null); setReceipt(null);
    try {
      const activeConnector = connector.current;
      const session = activeConnector?.network === network
        ? { instance: activeConnector.instance, accountId: identity.accountId }
        : await openWalletSession();
      if (session.accountId !== identity.accountId) {
        throw new Error(`Connect the verified wallet ${identity.accountId} to send this payment.`);
      }
      const [{ TransferTransaction, Hbar }, { transactionToBase64String }] = await Promise.all([
        import("@hiero-ledger/sdk"),
        import("@hashgraph/hedera-wallet-connect"),
      ]);
      const transaction = new TransferTransaction()
        .addHbarTransfer(session.accountId, Hbar.fromTinybars(-amountTinybar))
        .addHbarTransfer(payeeAccountId, Hbar.fromTinybars(amountTinybar))
        .setTransactionMemo(`AgentPay: ${purpose.trim().slice(0, 90)}`);
      const result = await session.instance.signAndExecuteTransaction({
        signerAccountId: `${networkToSignerPrefix(network)}:${session.accountId}`,
        transactionList: transactionToBase64String(transaction),
      });
      const transactionId = extractTransactionId(result);
      if (!transactionId) throw new Error("HashPack did not return a Hedera transaction ID.");

      let response: Response | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        response = await fetch("/api/v1/wallet/payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transactionId, payeeAccountId, amountTinybar, purpose: purpose.trim() }),
        });
        if (response.status !== 409) break;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      const body = await response!.json();
      if (!response!.ok) throw new Error(body.detail ?? "The Hedera payment could not be verified.");
      setReceipt(body.data as PaymentReceipt);
      window.dispatchEvent(new CustomEvent("agentpay:payment-settled"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payment was cancelled.");
    } finally { setBusy(false); }
  }

  async function disconnectWallet() {
    setBusy(true); setError(null);
    try {
      await connector.current?.instance.disconnectAll().catch(() => undefined);
      const response = await fetch(`/api/v1/wallet?network=${encodeURIComponent(network)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not unlink the wallet.");
      setIdentity(null); connector.current = null;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not unlink the wallet."); }
    finally { setBusy(false); }
  }

  return (
    <div className="wallet-control">
      <button className={`wallet-trigger${identity ? " connected" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <WalletCards size={16} />{identity ? identity.accountId : "Connect wallet"}
      </button>
      {open && <section className="wallet-popover" aria-label="Hedera wallet connection">
        <div className="wallet-popover-heading"><div><strong>Hedera payment identity</strong><span>{networkToSignerPrefix(network) === "hedera:mainnet" ? "Self custody · Mainnet" : "Self custody · Testnet"}</span></div>{identity ? <CheckCircle2 size={18} className="wallet-ok" /> : <XCircle size={18} className="wallet-muted" />}</div>
        {identity ? <div className="wallet-identity"><span>HashPack / WalletConnect</span><strong>{identity.accountId}</strong><small>Ownership signature verified</small></div> : <p>Connect HashPack through WalletConnect, then approve a message signature. This does not sign in to AgentPay or authorize a payment.</p>}
        {error && <div className="wallet-error" role="alert">{error}</div>}
        {receipt && <div className="wallet-receipt"><strong>Payment confirmed</strong><a href={receipt.hashscanUrl} target="_blank" rel="noreferrer">View on HashScan</a></div>}
        {identity
          ? <><div className="wallet-payment-form"><label>Recipient<input value={payeeAccountId} onChange={(event) => setPayeeAccountId(event.target.value)} placeholder="0.0.1234" /></label><label>Amount (HBAR)<input value={amountHbar} onChange={(event) => setAmountHbar(event.target.value)} inputMode="decimal" placeholder="0.01" /></label><label>Purpose<input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="What is this payment for?" /></label></div><button className="primary-button wallet-action" type="button" disabled={busy} onClick={() => void sendPayment()}><Link2 size={15} />Review payment in HashPack</button><button className="secondary-button wallet-action" type="button" disabled={busy} onClick={() => void disconnectWallet()}><Unplug size={15} />Unlink wallet</button></>
          : <button className="primary-button wallet-action" type="button" disabled={busy || !projectId} onClick={() => void connectWallet()}>{busy ? <LoaderCircle className="wallet-spin" size={15} /> : <Link2 size={15} />}Connect HashPack</button>}
        {!projectId && <small className="wallet-setup-note">WalletConnect setup is awaiting its public project ID.</small>}
      </section>}
    </div>
  );
}
