"use client";

import { cardanoAddressFromHex } from "@/lib/cardano-address";

export const supportedCardanoWallets = ["eternl", "lace", "vespr", "nami"] as const;
export type SupportedCardanoWallet = (typeof supportedCardanoWallets)[number];

type DataSignature = { key: string; signature: string };
type Cip30Api = {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  signData(address: string, payload: string): Promise<DataSignature>;
  signTx(transaction: string, partialSign?: boolean): Promise<string>;
  submitTx(transaction: string): Promise<string>;
};
type Cip30Provider = { name?: string; icon?: string; apiVersion?: string; enable(): Promise<Cip30Api> };
type CardanoWindow = Window & { cardano?: Record<string, Cip30Provider | undefined> };

export type CardanoWalletOption = { id: SupportedCardanoWallet; name: string; icon: string; version: string };
export type CardanoWalletSession = { api: Cip30Api; walletId: SupportedCardanoWallet; address: string; addressHex: string; networkId: number };

let activeSession: CardanoWalletSession | null = null;

function provider(walletId: SupportedCardanoWallet) {
  const candidate = (window as CardanoWindow).cardano?.[walletId];
  if (!candidate || typeof candidate.enable !== "function") throw new Error(`${walletId} is not installed or does not expose CIP-30.`);
  return candidate;
}

function utf8ToHex(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function installedCardanoWallets(): Promise<CardanoWalletOption[]> {
  if (typeof window === "undefined") return [];
  return supportedCardanoWallets.flatMap((id) => {
    const candidate = (window as CardanoWindow).cardano?.[id];
    return candidate ? [{ id, name: candidate.name ?? id[0].toUpperCase() + id.slice(1), icon: candidate.icon ?? "", version: candidate.apiVersion ?? "CIP-30" }] : [];
  });
}

export async function openCardanoWallet(walletId: SupportedCardanoWallet, network: "cardano:preprod" | "cardano:mainnet"): Promise<CardanoWalletSession> {
  if (!supportedCardanoWallets.includes(walletId)) throw new Error("This Cardano wallet is not supported.");
  const api = await provider(walletId).enable();
  const [networkId, addressHex] = await Promise.all([api.getNetworkId(), api.getChangeAddress()]);
  const expectedNetworkId = network === "cardano:mainnet" ? 1 : 0;
  if (networkId !== expectedNetworkId) throw new Error(`Switch ${walletId} to ${network === "cardano:mainnet" ? "Cardano Mainnet" : "Cardano Preprod"} and try again.`);
  const address = cardanoAddressFromHex(addressHex);
  activeSession = { api, walletId, address, addressHex, networkId };
  return activeSession;
}

export function currentCardanoWallet() { return activeSession; }

export async function signCardanoData(session: CardanoWalletSession, payload: string): Promise<DataSignature> {
  return session.api.signData(session.addressHex, utf8ToHex(payload));
}

export async function signAndSubmitCardanoTransaction(unsignedTx: string): Promise<string> {
  if (!activeSession) throw new Error("Connect the verified Cardano wallet before signing a transaction.");
  const signedTx = await activeSession.api.signTx(unsignedTx, false);
  return activeSession.api.submitTx(signedTx);
}

export async function signCardanoTransaction(walletId: SupportedCardanoWallet, network: "cardano:preprod" | "cardano:mainnet", expectedAddress: string, unsignedTx: string): Promise<string> {
  const session = activeSession?.walletId === walletId ? activeSession : await openCardanoWallet(walletId, network);
  if (session.address !== expectedAddress) throw new Error(`Connect the verified wallet ${expectedAddress} to approve this payment.`);
  return session.api.signTx(unsignedTx, false);
}

export function disconnectCardanoWallet() { activeSession = null; }
