"use client";

import type { AppKit } from "@reown/appkit";
import type { Eip1193Provider, TypedDataField } from "ethers";

const ARC_CHAIN_ID = 5_042_002;
const ARC_CHAIN_HEX = "0x4cee12";
const CONNECTION_TIMEOUT_MS = 120_000;

let appKitPromise: Promise<AppKit> | null = null;

async function getArcAppKit(projectId: string): Promise<AppKit> {
  appKitPromise ??= Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit/networks"),
    import("@reown/appkit-adapter-ethers"),
  ]).then(([reown, networks, ethersAdapter]) => {
    const arcTestnet = networks.defineChain({
      id: ARC_CHAIN_ID,
      caipNetworkId: "eip155:5042002",
      chainNamespace: "eip155",
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
      blockExplorers: { default: { name: "Arc Explorer", url: "https://testnet.arcscan.app" } },
    });
    return reown.createAppKit({
      adapters: [new ethersAdapter.EthersAdapter()],
      networks: [arcTestnet],
      defaultNetwork: arcTestnet,
      projectId,
      metadata: {
        name: "AgentPay Control",
        description: "Connect an Arc wallet to AgentPay Control.",
        url: window.location.origin,
        icons: [`${window.location.origin}/brand/agentpay-mark.png`],
      },
      allWallets: "SHOW",
      enableInjected: true,
      enableEIP6963: true,
      enableMobileFullScreen: true,
      features: { analytics: false, email: false, socials: false },
    });
  }).catch((error) => {
    appKitPromise = null;
    throw error;
  });
  return appKitPromise;
}

async function waitForConnectedProvider(appKit: AppKit): Promise<Eip1193Provider> {
  const existing = appKit.getWalletProvider() as Eip1193Provider | undefined;
  if (appKit.getIsConnectedState() && existing) return existing;
  await appKit.open({ view: "Connect" });
  return new Promise((resolve, reject) => {
    let settled = false;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (provider?: Eip1193Provider, error?: Error) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timeout);
      if (closeTimer) clearTimeout(closeTimer);
      if (provider) resolve(provider);
      else reject(error ?? new Error("Wallet connection was cancelled."));
    };
    const check = () => {
      const provider = appKit.getWalletProvider() as Eip1193Provider | undefined;
      if (appKit.getIsConnectedState() && provider) finish(provider);
    };
    const unsubscribe = appKit.subscribeState((state) => {
      check();
      if (!state.open && !settled && !closeTimer) closeTimer = setTimeout(() => finish(undefined, new Error("Wallet connection was cancelled.")), 500);
    });
    const timeout = setTimeout(() => finish(undefined, new Error("Wallet connection timed out.")), CONNECTION_TIMEOUT_MS);
    check();
  });
}

export async function openArcWallet(projectId: string) {
  const appKit = await getArcAppKit(projectId);
  const provider = await waitForConnectedProvider(appKit);
  const currentChain = await provider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(currentChain, 16) !== ARC_CHAIN_ID) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
      if (code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: ARC_CHAIN_HEX,
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: ["https://rpc.testnet.arc.network"],
          blockExplorerUrls: ["https://testnet.arcscan.app"],
        }],
      });
    }
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts[0]) throw new Error("The wallet did not provide an Arc account.");
  return { appKit, provider, accountId: accounts[0].toLowerCase() };
}

export async function disconnectArcWallet(projectId: string) {
  await (await getArcAppKit(projectId)).disconnect("eip155");
}

export async function createArcEip3009Payload(projectId: string, expectedAccount: string, requirement: unknown) {
  const session = await openArcWallet(projectId);
  if (session.accountId !== expectedAccount.toLowerCase()) throw new Error(`Connect the verified wallet ${expectedAccount} to approve this payment.`);
  const [{ BrowserProvider }, { ExactEvmScheme }] = await Promise.all([
    import("ethers"),
    import("@x402/evm/exact/client"),
  ]);
  const signer = await new BrowserProvider(session.provider).getSigner();
  const clientSigner = {
    address: session.accountId as `0x${string}`,
    signTypedData: async (typed: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) =>
      signer.signTypedData(typed.domain, typed.types as Record<string, TypedDataField[]>, typed.message) as Promise<`0x${string}`>,
  };
  const scheme = new ExactEvmScheme(clientSigner, { rpcUrl: "https://rpc.testnet.arc.network" });
  return scheme.createPaymentPayload(2, requirement as Parameters<typeof scheme.createPaymentPayload>[1]);
}
