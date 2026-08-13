import { describe, expect, it } from "vitest";
import { automationApproverIsIndependent, automationOrganizationError, automationPaymentOutcome, contractCodeHashMatches, contractMirrorOutcome } from "./automation-service";
import { keccak256 } from "ethers";
import { destinationTransferMatches, sourceTransactionMatches } from "./cross-chain-service";
import { fiatSubmissionFailureStatus, isRetryableFiatSubmission } from "./fiat-reconciliation-service";

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const address = "0x1111111111111111111111111111111111111111";

describe("production financial security invariants", () => {
  it("requires automation approval to be independent of creator and manual trigger actor", () => {
    expect(automationApproverIsIndependent("creator", null, "creator")).toBe(false);
    expect(automationApproverIsIndependent("creator", "trigger", "trigger")).toBe(false);
    expect(automationApproverIsIndependent("creator", "trigger", "approver")).toBe(true);
  });

  it("blocks new automation side effects when the organization is stopped", () => {
    expect(automationOrganizationError("ACTIVE", false)).toBeNull();
    expect(automationOrganizationError("ACTIVE", true)).toBe("ORGANIZATION_KILL_SWITCH_ENABLED");
    expect(automationOrganizationError("SUSPENDED", false)).toBe("ORGANIZATION_NOT_ACTIVE");
    expect(automationOrganizationError(undefined, undefined)).toBe("ORGANIZATION_NOT_ACTIVE");
  });

  it("defers an automation payment while policy approval is pending", () => {
    expect(automationPaymentOutcome("APPROVAL_PENDING")).toBe("DEFER");
    expect(automationPaymentOutcome("SETTLED")).toBe("SUCCEED");
    expect(automationPaymentOutcome("DENIED")).toBe("FAIL");
  });

  it("binds allowlisted contract execution to the expected runtime bytecode", () => {
    const bytecode = "0x6001600055";
    expect(contractCodeHashMatches(bytecode, keccak256(bytecode))).toBe(true);
    expect(contractCodeHashMatches(bytecode, `0x${"0".repeat(64)}`)).toBe(false);
  });

  it("reconciles only the exact pre-recorded contract transaction id", () => {
    const transactionId = "0.0.1234@1750000000.000000001";
    expect(contractMirrorOutcome([{ transaction_id: transactionId, result: "SUCCESS" }], transactionId)).toBe("SUCCEEDED");
    expect(contractMirrorOutcome([{ transaction_id: transactionId, result: "CONTRACT_REVERT_EXECUTED" }], transactionId)).toBe("FAILED");
    expect(contractMirrorOutcome([{ transaction_id: "0.0.1234@1750000000.000000002", result: "SUCCESS" }], transactionId)).toBe("UNKNOWN");
  });

  it("retries only unresolved fiat submissions with a local placeholder id", () => {
    expect(isRetryableFiatSubmission("SUBMISSION_UNKNOWN", "pending_123")).toBe(true);
    expect(isRetryableFiatSubmission("PENDING", "pending_123")).toBe(true);
    expect(isRetryableFiatSubmission("SUCCEEDED", "pending_123")).toBe(false);
    expect(isRetryableFiatSubmission("SUBMISSION_UNKNOWN", "obt_live_123")).toBe(false);
  });

  it("keeps ambiguous provider rejections reconcilable and only terminalizes definite pre-submission failures", () => {
    expect(fiatSubmissionFailureStatus(new Error("FIAT_PROVIDER_ERROR:400:invalid_request"))).toBe("SUBMISSION_UNKNOWN");
    expect(fiatSubmissionFailureStatus(new Error("FIAT_PROVIDER_ERROR:429:rate_limited"))).toBe("SUBMISSION_UNKNOWN");
    expect(fiatSubmissionFailureStatus(new Error("FIAT_PROVIDER_ERROR:401:access_denied"))).toBe("FAILED");
    expect(fiatSubmissionFailureStatus(new Error("FIAT_PROVIDER_ERROR:500:provider_error"))).toBe("SUBMISSION_UNKNOWN");
    expect(fiatSubmissionFailureStatus(new TypeError("network timeout"))).toBe("SUBMISSION_UNKNOWN");
  });

  it("requires an exact ERC-20 transfer recipient, token, and minimum amount", () => {
    const receipt = { transactionHash: `0x${"a".repeat(64)}`, status: "0x1", blockNumber: "0x10", to: null, logs: [{ address: "0x2222222222222222222222222222222222222222", topics: [transferTopic, `0x${"0".repeat(64)}`, `0x${"0".repeat(24)}${address.slice(2)}`], data: "0x64" }] };
    const transaction = { to: "0x3333333333333333333333333333333333333333", value: "0x0" };
    expect(destinationTransferMatches(receipt.logs[0]!.address, address, "100", receipt, transaction)).toBe(true);
    expect(destinationTransferMatches(receipt.logs[0]!.address, address, "101", receipt, transaction)).toBe(false);
    expect(destinationTransferMatches("0x4444444444444444444444444444444444444444", address, "1", receipt, transaction)).toBe(false);
  });

  it("requires native value to reach the exact destination", () => {
    const receipt = { transactionHash: `0x${"b".repeat(64)}`, status: "0x1", blockNumber: "0x10", to: address, logs: [] };
    expect(destinationTransferMatches("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", address, "10", receipt, { to: address, value: "0xa" })).toBe(true);
    expect(destinationTransferMatches("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", address, "11", receipt, { to: address, value: "0xa" })).toBe(false);
  });

  it("binds a bridge source hash to the quoted signer, target, calldata, and value", () => {
    const expected = { to: "0x2222222222222222222222222222222222222222", data: "0xabcdef", value: "10", chainId: 11155111 };
    const transaction = { hash: `0x${"c".repeat(64)}`, from: address, to: expected.to, input: expected.data, value: "0xa" };
    expect(sourceTransactionMatches(address, expected, transaction)).toBe(true);
    expect(sourceTransactionMatches("0x3333333333333333333333333333333333333333", expected, transaction)).toBe(false);
    expect(sourceTransactionMatches(address, { ...expected, data: "0xdeadbeef" }, transaction)).toBe(false);
    expect(sourceTransactionMatches(address, { ...expected, value: "11" }, transaction)).toBe(false);
  });
});
