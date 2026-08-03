import type { AppKit } from "@reown/appkit";

const HEDERA_NAMESPACE = "hedera";
const CONNECTION_TIMEOUT_MS = 120_000;

type WalletProvider = NonNullable<Awaited<ReturnType<AppKit["getUniversalProvider"]>>>;

type WalletKit = {
  appKit: AppKit;
};

export type HederaWalletSession = {
  accountId: string;
  appKit: AppKit;
  provider: WalletProvider;
};

let walletKitPromise: Promise<WalletKit> | null = null;

export function accountIdForNetwork(accounts: string[], network: string) {
  const prefix = `${network}:`;
  const account = accounts.find((candidate) => candidate.startsWith(prefix));
  return account?.slice(prefix.length) ?? null;
}

function connectedAccountId(provider: WalletProvider, network: string) {
  const accounts = provider.session?.namespaces?.[HEDERA_NAMESPACE]?.accounts ?? [];
  return accountIdForNetwork(accounts, network);
}

async function getWalletKit(projectId: string): Promise<WalletKit> {
  if (!walletKitPromise) {
    walletKitPromise = Promise.all([
      import("@hashgraph/hedera-wallet-connect"),
      import("@reown/appkit"),
    ]).then(([hedera, reown]) => {
      const networks = [
        hedera.HederaChainDefinition.Native.Mainnet,
        hedera.HederaChainDefinition.Native.Testnet,
      ] as const;
      const adapter = new hedera.HederaAdapter({
        projectId,
        networks: [...networks],
        namespace: hedera.hederaNamespace,
      });
      const appKit = reown.createAppKit({
        adapters: [adapter],
        projectId,
        metadata: {
          name: "AgentPay Control",
          description: "Connect a Hedera payment identity to AgentPay Control.",
          url: window.location.origin,
          icons: [`${window.location.origin}/brand/agentpay-mark.png`],
        },
        networks: [...networks],
        defaultNetwork: hedera.HederaChainDefinition.Native.Testnet,
        featuredWalletIds: [
          "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // HashPack
        ],
        includeWalletIds: [
          "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // HashPack
        ],
        features: {
          analytics: false,
          email: false,
          socials: false,
        },
      });

      return { appKit };
    }).catch((error) => {
      walletKitPromise = null;
      throw error;
    });
  }

  return walletKitPromise;
}

function waitForAccount(appKit: AppKit, provider: WalletProvider, network: string, modalOpened: boolean) {
  const existingAccount = connectedAccountId(provider, network);
  if (existingAccount) return Promise.resolve(existingAccount);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let cancellationTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      unsubscribeState();
      provider.removeListener("connect", checkAccount);
      provider.removeListener("accountsChanged", checkAccount);
      clearTimeout(timeoutTimer);
      if (cancellationTimer) clearTimeout(cancellationTimer);
    };
    const finish = (accountId?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (accountId) resolve(accountId);
      else reject(error ?? new Error("Wallet connection was cancelled."));
    };
    const checkAccount = () => {
      const accountId = connectedAccountId(provider, network);
      if (accountId) finish(accountId);
    };
    const unsubscribeState = appKit.subscribeState((state) => {
      checkAccount();
      if (modalOpened && !state.open && !settled && !cancellationTimer) {
        cancellationTimer = setTimeout(() => {
          checkAccount();
          if (!settled) finish(undefined, new Error("Wallet connection was cancelled."));
        }, 500);
      }
    });
    const timeoutTimer = setTimeout(() => {
      finish(undefined, new Error("Wallet connection did not finish. Close the wallet modal and try again."));
    }, CONNECTION_TIMEOUT_MS);

    provider.on("connect", checkAccount);
    provider.on("accountsChanged", checkAccount);
    checkAccount();
  });
}

export async function openHederaWallet(projectId: string, network: string): Promise<HederaWalletSession> {
  const { appKit } = await getWalletKit(projectId);
  const { HederaChainDefinition } = await import("@hashgraph/hedera-wallet-connect");
  const targetNetwork = network === "hedera:mainnet"
    ? HederaChainDefinition.Native.Mainnet
    : HederaChainDefinition.Native.Testnet;

  await appKit.switchNetwork(targetNetwork, { throwOnFailure: true });
  let provider = appKit.getIsConnectedState()
    ? await appKit.getUniversalProvider()
    : undefined;
  const existingAccount = provider ? connectedAccountId(provider, network) : null;
  if (provider && existingAccount) return { accountId: existingAccount, appKit, provider };

  await appKit.open({ view: "Connect" });
  provider ??= await appKit.getUniversalProvider();
  if (!provider) throw new Error("WalletConnect could not initialize its provider.");

  const accountId = await waitForAccount(appKit, provider, network, true);
  return { accountId, appKit, provider };
}

export async function disconnectHederaWallet(projectId: string) {
  const { appKit } = await getWalletKit(projectId);
  await appKit.disconnect(HEDERA_NAMESPACE as never);
}
