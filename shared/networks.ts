export const ARCTestnet = {
  caip2: "eip155:5042002",
  chainId: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  displayDecimals: 6,
  rpcUrl: "https://rpc.testnet.arc.network",
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorer: "https://testnet.arcscan.app",
  explorerTxUrlTemplate: "https://testnet.arcscan.app/tx/{txHash}",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  usdcDecimals: 6,
  finalitySeconds: 1,
  confirmationsRequired: 1,
  cctpDomain: 26,
} as const;

export const HederaTestnet = {
  caip2: "hedera:testnet",
  explorerTxUrlTemplate: "https://hashscan.io/testnet/transaction/{transactionId}",
  nativeSymbol: "HBAR",
  usdcTokenId: "0.0.429274",
} as const;

export type SupportedNetwork = typeof ARCTestnet | typeof HederaTestnet;

export const SUPPORTED_NETWORKS: Record<string, SupportedNetwork> = {
  [ARCTestnet.caip2]: ARCTestnet,
  [HederaTestnet.caip2]: HederaTestnet,
};
