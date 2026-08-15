import { getAddress, isAddress, verifyMessage } from "ethers";
import { decodeCardanoAddress } from "@/lib/cardano-address";
import { verifyCardanoDataSignature } from "@/lib/cardano-data-signature";

export const walletNetworks = [
  "hedera:testnet",
  "hedera:mainnet",
  "eip155:5042002",
  "cardano:preprod",
  "cardano:mainnet",
] as const;

export type WalletNetwork = (typeof walletNetworks)[number];

export function isWalletNetwork(value: string): value is WalletNetwork {
  return (walletNetworks as readonly string[]).includes(value);
}

export function normalizeWalletAccount(network: WalletNetwork, accountId: string): string {
  const value = accountId.trim();
  if (network.startsWith("hedera:")) {
    if (!/^0\.0\.\d+$/.test(value)) throw new Error("HEDERA_ACCOUNT_ID_INVALID");
    return value;
  }
  if (network.startsWith("eip155:")) {
    if (!isAddress(value)) throw new Error("EVM_ACCOUNT_ADDRESS_INVALID");
    return getAddress(value).toLowerCase();
  }
  const decoded = decodeCardanoAddress(value);
  const mainnet = network === "cardano:mainnet";
  if (decoded.hrp !== (mainnet ? "addr" : "addr_test") || decoded.networkId !== (mainnet ? 1 : 0)) {
    throw new Error("CARDANO_ADDRESS_NETWORK_MISMATCH");
  }
  return value;
}

export function walletChallengeMessage(network: WalletNetwork, accountId: string, nonce: string): string {
  return `AgentPay Control wallet link\nNetwork: ${network}\nAccount: ${accountId}\nNonce: ${nonce}`;
}

export function verifyEvmWalletSignature(message: string, signature: string, accountId: string): boolean {
  try {
    return verifyMessage(message, signature).toLowerCase() === accountId.toLowerCase();
  } catch {
    return false;
  }
}

export async function verifyCardanoWalletSignature(
  message: string,
  signature: { key: string; signature: string },
  accountId: string,
): Promise<boolean> {
  try {
    return verifyCardanoDataSignature(message, signature, accountId);
  } catch {
    return false;
  }
}
