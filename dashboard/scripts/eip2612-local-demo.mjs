import {
  Contract,
  JsonRpcProvider,
  Signature,
  Wallet,
  formatUnits,
  getAddress,
  parseUnits,
} from "ethers";

const ERC20_PERMIT_ABI = [
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function nonces(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function transferFrom(address from,address to,uint256 value) returns (bool)",
];

const LOCAL_CHAIN_IDS = new Set([1337n, 31337n]);
const MAX_DEMO_TOKENS = "10";
const DEFAULT_TRANSFER_TOKENS = "1";
const DEFAULT_DEADLINE_SECONDS = 15 * 60;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveTokenAmount(value, decimals, label) {
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }
  return parsed;
}

function assertLocalDevelopmentChain(chainId) {
  if (!LOCAL_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `Refusing to run on chain ${chainId}. This demo is restricted to local development chains 1337 and 31337.`,
    );
  }
}

function buildPermitTypedData({ tokenName, tokenVersion, chainId, tokenAddress, owner, spender, value, nonce, deadline }) {
  return {
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: tokenAddress,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      owner,
      spender,
      value,
      nonce,
      deadline,
    },
  };
}

async function signPermit({ ownerWallet, token, tokenAddress, tokenVersion, chainId, spender, value, deadline }) {
  const owner = await ownerWallet.getAddress();
  const [tokenName, nonce] = await Promise.all([
    token.name(),
    token.nonces(owner),
  ]);

  const typedData = buildPermitTypedData({
    tokenName,
    tokenVersion,
    chainId,
    tokenAddress,
    owner,
    spender,
    value,
    nonce,
    deadline,
  });

  const serializedSignature = await ownerWallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message,
  );

  return {
    owner,
    nonce,
    signature: Signature.from(serializedSignature),
  };
}

async function executePermit({ token, caller, owner, spender, value, deadline, signature }) {
  const writableToken = token.connect(caller);
  const tx = await writableToken.permit(
    owner,
    spender,
    value,
    deadline,
    signature.v,
    signature.r,
    signature.s,
  );
  return tx.wait();
}

async function executeTransferFrom({ token, spenderWallet, owner, recipient, value }) {
  const writableToken = token.connect(spenderWallet);
  const tx = await writableToken.transferFrom(owner, recipient, value);
  return tx.wait();
}

async function main() {
  const rpcUrl = process.env.LOCAL_RPC_URL?.trim() || "http://127.0.0.1:8545";
  const ownerPrivateKey = requiredEnv("TEST_OWNER_PRIVATE_KEY");
  const spenderPrivateKey = requiredEnv("TEST_SPENDER_PRIVATE_KEY");
  const tokenAddress = getAddress(requiredEnv("TEST_TOKEN_ADDRESS"));
  const recipientAddress = getAddress(requiredEnv("TEST_RECIPIENT_ADDRESS"));
  const tokenVersion = process.env.TEST_TOKEN_VERSION?.trim() || "1";

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  assertLocalDevelopmentChain(network.chainId);

  const ownerWallet = new Wallet(ownerPrivateKey, provider);
  const spenderWallet = new Wallet(spenderPrivateKey, provider);
  const owner = await ownerWallet.getAddress();
  const spender = await spenderWallet.getAddress();

  if (owner === spender) {
    throw new Error("Owner and spender must be separate test accounts");
  }

  const token = new Contract(tokenAddress, ERC20_PERMIT_ABI, provider);
  const decimals = Number(await token.decimals());

  const permitTokens = process.env.DEMO_PERMIT_TOKENS?.trim() || MAX_DEMO_TOKENS;
  const transferTokens = process.env.DEMO_TRANSFER_TOKENS?.trim() || DEFAULT_TRANSFER_TOKENS;
  const permitValue = parsePositiveTokenAmount(permitTokens, decimals, "Permit amount");
  const transferValue = parsePositiveTokenAmount(transferTokens, decimals, "Transfer amount");
  const maxPermitValue = parseUnits(MAX_DEMO_TOKENS, decimals);

  if (permitValue > maxPermitValue) {
    throw new Error(`Permit amount exceeds the ${MAX_DEMO_TOKENS}-token safety cap`);
  }
  if (transferValue > permitValue) {
    throw new Error("Transfer amount cannot exceed the permitted amount");
  }

  const ownerBalance = await token.balanceOf(owner);
  if (ownerBalance < transferValue) {
    throw new Error(
      `Owner balance is insufficient: ${formatUnits(ownerBalance, decimals)} tokens available`,
    );
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS);
  const { nonce, signature } = await signPermit({
    ownerWallet,
    token,
    tokenAddress,
    tokenVersion,
    chainId: network.chainId,
    spender,
    value: permitValue,
    deadline,
  });

  console.log("Local EIP-2612 demo");
  console.log(`chainId: ${network.chainId}`);
  console.log(`token: ${tokenAddress}`);
  console.log(`owner: ${owner}`);
  console.log(`spender: ${spender}`);
  console.log(`recipient: ${recipientAddress}`);
  console.log(`nonce: ${nonce}`);
  console.log(`permit: ${formatUnits(permitValue, decimals)} tokens`);
  console.log(`transfer: ${formatUnits(transferValue, decimals)} tokens`);

  const permitReceipt = await executePermit({
    token,
    caller: spenderWallet,
    owner,
    spender,
    value: permitValue,
    deadline,
    signature,
  });

  const allowance = await token.allowance(owner, spender);
  if (allowance < transferValue) {
    throw new Error("Permit transaction succeeded but the resulting allowance is insufficient");
  }

  console.log(`permit tx: ${permitReceipt.hash}`);
  console.log(`allowance: ${formatUnits(allowance, decimals)} tokens`);

  const transferReceipt = await executeTransferFrom({
    token,
    spenderWallet,
    owner,
    recipient: recipientAddress,
    value: transferValue,
  });

  console.log(`transferFrom tx: ${transferReceipt.hash}`);
  console.log("Demo completed successfully");
}

main().catch((error) => {
  console.error("EIP-2612 local demo failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
