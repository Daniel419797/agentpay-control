import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import {
  normalizeWalletAccount,
  verifyCardanoWalletSignature,
  verifyEvmWalletSignature,
  walletChallengeMessage,
} from "@/lib/wallet-identity";
import { cardanoAddressFromHex, decodeCardanoAddress } from "@/lib/cardano-address";

const PREPROD_ADDRESS = "addr_test1qzj8e3xsl4pk6k5hsdtsd0zahfcfsqjq0x6c25pcrsr7gpwvmfgfdlwkq3mkwqdqw569ghrrhyacd56u9lekvxrdujlq97kaac";

describe("wallet identity", () => {
  it("normalizes valid network-specific accounts", () => {
    expect(normalizeWalletAccount("hedera:testnet", " 0.0.123 ")).toBe("0.0.123");
    expect(normalizeWalletAccount("eip155:5042002", "0x8ba1f109551bD432803012645Ac136ddd64DBA72"))
      .toBe("0x8ba1f109551bd432803012645ac136ddd64dba72");
    expect(normalizeWalletAccount("cardano:preprod", PREPROD_ADDRESS)).toBe(PREPROD_ADDRESS);
  });

  it("rejects an address on the wrong Cardano network", () => {
    expect(() => normalizeWalletAccount("cardano:mainnet", PREPROD_ADDRESS))
      .toThrow("CARDANO_ADDRESS_NETWORK_MISMATCH");
  });

  it("round-trips a CIP-30 hex change address to bech32", () => {
    const bytes = decodeCardanoAddress(PREPROD_ADDRESS).bytes;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(cardanoAddressFromHex(hex)).toBe(PREPROD_ADDRESS);
  });

  it("verifies an Arc ownership signature only for its signer and exact challenge", async () => {
    const signer = Wallet.createRandom();
    const other = Wallet.createRandom();
    const account = normalizeWalletAccount("eip155:5042002", signer.address);
    const message = walletChallengeMessage("eip155:5042002", account, "single-use-nonce");
    const signature = await signer.signMessage(message);

    expect(verifyEvmWalletSignature(message, signature, account)).toBe(true);
    expect(verifyEvmWalletSignature(`${message}!`, signature, account)).toBe(false);
    expect(verifyEvmWalletSignature(message, signature, other.address)).toBe(false);
  });

  it("verifies a real CIP-30 signData COSE signature", async () => {
    const message = "Augusta Ada King, Countess of Lovelace";
    const address = "stake1uyvfslqkzgrf6syq5r4jg7pqewv8l65phh024lw5r7vk9qgznhyty";
    const signature = {
      key: "a4010103272006215820b89526fd6bf4ba737c55ea90670d16a27f8de6cc1982349b3b676705a2f420c6",
      signature: "84582aa201276761646472657373581de118987c1612069d4080a0eb247820cb987fea81bddeaafdd41f996281a166686173686564f458264175677573746120416461204b696e672c20436f756e74657373206f66204c6f76656c61636558401712458b19f606b322982f6290c78529a235b56c0f1cec4f24b12a8660b40cd37f4c5440a465754089c462ed4b0d613bffaee3d1833516569fda4852f42a4a0f",
    };

    expect(await verifyCardanoWalletSignature(message, signature, address)).toBe(true);
    expect(await verifyCardanoWalletSignature(`${message}!`, signature, address)).toBe(false);
  });
});
