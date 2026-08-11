import { AsyncLocalStorage } from "node:async_hooks";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme as ExactEvmClientScheme } from "@x402/evm/exact/client";
import { toFacilitatorEvmSigner, verifyTypedDataSignature } from "@x402/evm";
import { createWalletClient, createPublicClient, http, defineChain, type WalletClient, type PublicClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const privateKeySchema = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "Must be a 64-char hex private key");
const optionalPrivateKeySchema = z.preprocess(
  (value) => value === "" ? undefined : value,
  privateKeySchema.optional(),
);

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

export const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  ARC_PAYER_PRIVATE_KEY: privateKeySchema,
  ARC_RELAYER_PRIVATE_KEY: optionalPrivateKeySchema,
  ARC_CONTRACT_EXECUTION_PRIVATE_KEY: optionalPrivateKeySchema,
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_USDC_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0x3600000000000000000000000000000000000000"),
  ARC_PROVIDER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  FACILITATOR_API_KEY: z.string().min(32).optional(),
  MANAGED_SIGNING_API_KEY: z.string().min(32).optional(),
  SETTLEMENT_API_KEY: z.string().min(32).optional(),
  CONTRACT_EXECUTION_API_KEY: z.string().min(32).optional(),
  CONTRACT_ALLOWLIST_JSON: z.string().default("[]"),
  PORT: z.coerce.number().default(8788),
});

export type ArcConfig = z.infer<typeof envSchema>;

type SettlementEvidence = { transactionId?: Hex };
export type SettlementCapture<T> =
  | { result: T; error?: never; transactionId?: Hex }
  | { result?: never; error: unknown; transactionId?: Hex };

export class SettlementEvidenceScope {
  private readonly storage = new AsyncLocalStorage<SettlementEvidence>();

  async capture<T>(operation: () => Promise<T>): Promise<SettlementCapture<T>> {
    const evidence: SettlementEvidence = {};
    return this.storage.run(evidence, async () => {
      try {
        return { result: await operation(), transactionId: evidence.transactionId };
      } catch (error) {
        return { error, transactionId: evidence.transactionId };
      }
    });
  }

  record(transactionId: Hex) {
    const evidence = this.storage.getStore();
    if (evidence && !evidence.transactionId) evidence.transactionId = transactionId;
  }
}

function toAccount(value: string) {
  const key = value.startsWith("0x") ? value as Hex : `0x${value}` as Hex;
  return privateKeyToAccount(key);
}

export class EvmFacilitator {
  private readonly config: ArcConfig;
  private readonly payerAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly relayerAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly contractAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly settlementEvidence = new SettlementEvidenceScope();
  readonly walletClient: WalletClient;
  private readonly contractWalletClient: WalletClient;
  readonly publicClient: PublicClient;
  readonly scheme: ExactEvmScheme;
  readonly clientScheme: ExactEvmClientScheme;
  readonly network: string;
  readonly usdcAddress: Hex;

  constructor(config: ArcConfig) {
    this.config = config;
    this.payerAccount = toAccount(config.ARC_PAYER_PRIVATE_KEY);
    this.relayerAccount = toAccount(config.ARC_RELAYER_PRIVATE_KEY ?? config.ARC_PAYER_PRIVATE_KEY);
    this.contractAccount = toAccount(config.ARC_CONTRACT_EXECUTION_PRIVATE_KEY ?? config.ARC_PAYER_PRIVATE_KEY);
    this.usdcAddress = config.ARC_USDC_ADDRESS as Hex;

    const chain = defineChain({
      ...arcTestnet,
      rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
    });

    this.walletClient = createWalletClient({
      account: this.relayerAccount,
      chain,
      transport: http(config.ARC_RPC_URL),
    });
    this.contractWalletClient = createWalletClient({
      account: this.contractAccount,
      chain,
      transport: http(config.ARC_RPC_URL),
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.ARC_RPC_URL),
    });

    const evmSigner = {
      address: this.relayerAccount.address,
      readContract: (args: any) => this.publicClient.readContract(args),
      sendTransaction: async (args: any) => {
        const transactionHash = await this.walletClient.sendTransaction({ ...args, account: this.relayerAccount, chain: this.walletClient.chain });
        this.settlementEvidence.record(transactionHash);
        return transactionHash;
      },
      writeContract: async (args: any) => {
        const transactionHash = await this.walletClient.writeContract({ ...args, account: this.relayerAccount, chain: this.walletClient.chain });
        this.settlementEvidence.record(transactionHash);
        return transactionHash;
      },
      waitForTransactionReceipt: (args: any) => this.publicClient.waitForTransactionReceipt(args),
      getCode: (args: any) => this.publicClient.getCode(args),
      verifyTypedData: (args: any) => verifyTypedDataSignature(evmSigner as any, args),
    };
    const signer = toFacilitatorEvmSigner(evmSigner);
    this.scheme = new ExactEvmScheme(signer);
    this.clientScheme = new ExactEvmClientScheme(this.payerAccount, { rpcUrl: config.ARC_RPC_URL });
    this.network = `eip155:${chain.id}`;
  }

  captureSettlementEvidence<T>(operation: () => Promise<T>) {
    return this.settlementEvidence.capture(operation);
  }

  get providerAddress(): string {
    return this.config.ARC_PROVIDER_ADDRESS;
  }

  get usdcContract(): { address: Hex; abi: readonly unknown[] } {
    return {
      address: this.usdcAddress,
      abi: [
        {
          type: "function",
          name: "transferWithAuthorization",
          stateMutability: "nonpayable",
          inputs: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
            { name: "v", type: "uint8" },
            { name: "r", type: "bytes32" },
            { name: "s", type: "bytes32" },
          ],
          outputs: [],
        },
      ] as const,
    };
  }

  async executeContractCall(
    contractAddress: Hex,
    calldata: Hex,
    gas: number,
    payableAtomic: bigint,
  ) {
    const tx = await this.contractWalletClient.sendTransaction({
      account: this.contractAccount,
      chain: this.contractWalletClient.chain,
      to: contractAddress,
      data: calldata,
      gas: BigInt(Math.min(gas, 15_000_000)),
      value: payableAtomic,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: tx,
      timeout: 30_000,
    });
    return { transactionHash: tx, status: receipt.status === "success", blockNumber: receipt.blockNumber };
  }
}
