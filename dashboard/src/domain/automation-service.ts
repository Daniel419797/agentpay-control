import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { keccak256 } from "ethers";
import { AccountId, TransactionId } from "@hiero-ledger/sdk";

import { createInvoice, sendInvoice } from "@/domain/invoice-service";
import { createPaidRequest } from "@/domain/payment-service";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { normalizeTransactionId } from "@/lib/hedera-payment";

export const contractActionSchema = z.object({ allowlistEntryId: z.string().uuid(), functionSelector: z.string().regex(/^0x[0-9a-fA-F]{8}$/), calldata: z.string().regex(/^0x[0-9a-fA-F]*$/), gas: z.number().int().min(21_000).max(15_000_000), payableAtomic: z.string().regex(/^\d+$/) });
export const paymentActionSchema = z.object({ resourceUrl: z.string().url(), maxAmountAtomic: z.string().regex(/^\d+$/).optional(), purpose: z.string().max(300).optional() });
export const invoiceActionSchema = z.object({ recipientAgentId: z.string().uuid(), assetId: z.string().uuid(), title: z.string().min(3).max(140), memo: z.string().max(2_000).optional(), dueInHours: z.number().int().min(1).max(8_760), items: z.array(z.object({ description: z.string().min(2).max(500), quantity: z.number().int().min(1).max(1_000_000), unitAmountAtomic: z.string().regex(/^\d+$/) })).min(1).max(100) });

export type AutomationActionInput = z.infer<typeof contractActionSchema> | z.infer<typeof paymentActionSchema> | z.infer<typeof invoiceActionSchema>;

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function automationApproverIsIndependent(ruleCreatedBy: string, triggeredByUserId: string | null, approverId: string) {
  return ruleCreatedBy !== approverId && triggeredByUserId !== approverId;
}

export function automationPaymentOutcome(status: string): "DEFER" | "SUCCEED" | "FAIL" {
  if (status === "APPROVAL_PENDING") return "DEFER";
  if (status === "SETTLED") return "SUCCEED";
  return "FAIL";
}

export function contractCodeHashMatches(bytecode: string, expectedCodeHash: string) {
  return keccak256(bytecode).toLowerCase() === expectedCodeHash.toLowerCase();
}

export function contractMirrorOutcome(transactions: Array<{ transaction_id: string; result: string }>, expectedTransactionId: string) {
  const expected = normalizeTransactionId(expectedTransactionId);
  const match = transactions.find((transaction) => normalizeTransactionId(transaction.transaction_id) === expected);
  if (!match) return "UNKNOWN" as const;
  return match.result === "SUCCESS" ? "SUCCEEDED" as const : "FAILED" as const;
}

class ContractSubmissionUnknownError extends Error {
  constructor() {
    super("CONTRACT_SUBMISSION_UNKNOWN");
  }
}

export async function validateAutomationAction(organizationId: string, actionType: "CONTRACT_CALL" | "X402_PAYMENT" | "CREATE_INVOICE", action: unknown) {
  if (actionType === "CONTRACT_CALL") {
    const parsed = contractActionSchema.parse(action);
    if (!parsed.calldata.toLowerCase().startsWith(parsed.functionSelector.toLowerCase())) throw new Error("CONTRACT_SELECTOR_CALLDATA_MISMATCH");
    const entry = await db.contractAllowlistEntry.findFirst({ where: { id: parsed.allowlistEntryId, organizationId, active: true }, include: { network: true } });
    if (!entry || entry.network.family !== "HEDERA" || !entry.network.enabled || !entry.network.supportsContracts) throw new Error("CONTRACT_NOT_ALLOWLISTED");
    if (!entry.allowedFunctionSelectors.map((selector) => selector.toLowerCase()).includes(parsed.functionSelector.toLowerCase())) throw new Error("CONTRACT_FUNCTION_NOT_ALLOWLISTED");
    if (parsed.gas > entry.maxGas || BigInt(parsed.payableAtomic) > BigInt(entry.maxPayableAtomic.toString())) throw new Error("CONTRACT_CALL_LIMIT_EXCEEDED");
    if (entry.expectedCodeHash) {
      const response = await fetch(`${getConfig().HEDERA_MIRROR_NODE_URL}/api/v1/contracts/${encodeURIComponent(entry.contractAddress)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("CONTRACT_CODE_UNAVAILABLE");
      const contract = z.object({ bytecode: z.string().regex(/^0x[0-9a-fA-F]*$/) }).parse(await response.json());
      if (!contractCodeHashMatches(contract.bytecode, entry.expectedCodeHash)) throw new Error("CONTRACT_CODE_HASH_MISMATCH");
    }
    return parsed;
  }
  if (actionType === "X402_PAYMENT") return paymentActionSchema.parse(action);
  return invoiceActionSchema.parse(action);
}

export async function executeAutomation(executionId: string) {
  const claimed = await db.automationExecution.updateMany({ where: { id: executionId, status: "PENDING" }, data: { status: "EXECUTING", startedAt: new Date() } });
  if (claimed.count !== 1) return db.automationExecution.findUniqueOrThrow({ where: { id: executionId } });
  const execution = await db.automationExecution.findUniqueOrThrow({ where: { id: executionId }, include: { rule: true } });
  try {
    const action = await validateAutomationAction(execution.organizationId, execution.rule.actionType, JSON.parse(decryptSecret(execution.rule.actionConfigEncrypted)));
    let result: unknown;
    let transactionId: string | undefined;
    if (execution.rule.actionType === "CONTRACT_CALL") {
      const call = contractActionSchema.parse(action);
      const entry = await db.contractAllowlistEntry.findUniqueOrThrow({ where: { id: call.allowlistEntryId } });
      const config = getConfig();
      if (!config.FACILITATOR_URL || !config.FACILITATOR_API_KEY || !config.HEDERA_PAYER_ACCOUNT_ID) throw new Error("FACILITATOR_UNAVAILABLE");
      const candidateTransactionId = execution.transactionId ?? TransactionId.generate(AccountId.fromString(config.HEDERA_PAYER_ACCOUNT_ID)).toString();
      if (!execution.transactionId) {
        await db.automationExecution.update({ where: { id: execution.id }, data: { transactionId: candidateTransactionId } });
      }
      let response: Response;
      try {
        response = await fetch(`${config.FACILITATOR_URL}/contract-execute`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.FACILITATOR_API_KEY}`, "idempotency-key": execution.id }, body: JSON.stringify({ contractId: entry.contractAddress, functionSelector: call.functionSelector, calldata: call.calldata, gas: call.gas, payableAtomic: call.payableAtomic, transactionId: candidateTransactionId }), signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new ContractSubmissionUnknownError();
      }
      let payload: { success: boolean; transactionId?: string; status?: string; error?: string };
      try {
        payload = z.object({ success: z.boolean(), transactionId: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).parse(await response.json());
      } catch {
        if (response.status >= 500 || response.ok) throw new ContractSubmissionUnknownError();
        throw new Error(`CONTRACT_EXECUTION_${response.status}`);
      }
      if (response.status >= 500) throw new ContractSubmissionUnknownError();
      if (!response.ok || !payload.success || !payload.transactionId) throw new Error(payload.error ?? `CONTRACT_EXECUTION_${response.status}`);
      if (normalizeTransactionId(payload.transactionId) !== normalizeTransactionId(candidateTransactionId)) throw new Error("CONTRACT_TRANSACTION_ID_MISMATCH");
      transactionId = payload.transactionId;
      result = { status: payload.status ?? "SUCCESS" };
    } else if (execution.rule.actionType === "X402_PAYMENT") {
      const payment = paymentActionSchema.parse(action);
      const intent = await createPaidRequest(execution.rule.agentId, `automation:${execution.id}`, payment);
      result = { paymentIntentId: intent.id, status: intent.status };
      const outcome = automationPaymentOutcome(intent.status);
      if (outcome === "DEFER") {
        return db.automationExecution.update({
          where: { id: execution.id },
          data: {
            status: "PENDING",
            errorCode: "PAYMENT_APPROVAL_PENDING",
            result: JSON.parse(JSON.stringify(result)),
          },
        });
      }
      if (outcome === "FAIL") throw new Error(`PAYMENT_${intent.status}`);
      transactionId = intent.attempts.find((attempt) => attempt.settlement)?.settlement?.transactionId ?? undefined;
    } else {
      const invoice = invoiceActionSchema.parse(action);
      const created = await createInvoice(execution.organizationId, execution.rule.createdBy, { issuerAgentId: execution.rule.agentId, recipientAgentId: invoice.recipientAgentId, assetId: invoice.assetId, title: invoice.title, memo: invoice.memo, dueAt: new Date(Date.now() + invoice.dueInHours * 3_600_000), items: invoice.items });
      await sendInvoice(created.id, execution.organizationId, execution.rule.createdBy);
      result = { invoiceId: created.id, number: created.number };
    }
    return await db.$transaction(async (tx) => {
      const completed = await tx.automationExecution.update({ where: { id: execution.id }, data: { status: "SUCCEEDED", transactionId, result: JSON.parse(JSON.stringify(result)), completedAt: new Date() } });
      await tx.outboxEvent.create({ data: { organizationId: execution.organizationId, eventType: "AUTOMATION_EXECUTION_SUCCEEDED", aggregateType: "AUTOMATION_EXECUTION", aggregateId: execution.id, payload: { ruleId: execution.ruleId, transactionId: transactionId ?? null } } });
      return completed;
    });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "AUTOMATION_FAILED";
    if (error instanceof ContractSubmissionUnknownError) {
      return db.automationExecution.update({
        where: { id: execution.id },
        data: { status: "SUBMISSION_UNKNOWN", errorCode: code },
      });
    }
    return db.$transaction(async (tx) => {
      const failed = await tx.automationExecution.update({ where: { id: execution.id }, data: { status: "FAILED", errorCode: code, completedAt: new Date() } });
      await tx.outboxEvent.create({ data: { organizationId: execution.organizationId, eventType: "AUTOMATION_EXECUTION_FAILED", aggregateType: "AUTOMATION_EXECUTION", aggregateId: execution.id, payload: { ruleId: execution.ruleId, errorCode: code } } });
      return failed;
    });
  }
}

export async function reconcileUnknownContractExecutions(limit = 25, now = new Date()) {
  const executions = await db.automationExecution.findMany({
    where: { status: "SUBMISSION_UNKNOWN", transactionId: { not: null }, rule: { actionType: "CONTRACT_CALL" } },
    select: { id: true, organizationId: true, ruleId: true, transactionId: true, startedAt: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  const results = [];
  for (const execution of executions) {
    const transactionId = execution.transactionId!;
    try {
      const url = new URL(`/api/v1/transactions/${encodeURIComponent(normalizeTransactionId(transactionId))}`, getConfig().HEDERA_MIRROR_NODE_URL);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok && response.status !== 404) throw new Error(`MIRROR_NODE_${response.status}`);
      const body = response.ok ? z.object({ transactions: z.array(z.object({ transaction_id: z.string(), result: z.string() })).default([]) }).parse(await response.json()) : { transactions: [] };
      const outcome = contractMirrorOutcome(body.transactions, transactionId);
      if (outcome === "UNKNOWN" && now.getTime() - (execution.startedAt?.getTime() ?? now.getTime()) < 10 * 60_000) {
        results.push({ executionId: execution.id, outcome });
        continue;
      }
      const finalStatus = outcome === "SUCCEEDED" ? "SUCCEEDED" : "FAILED";
      const errorCode = outcome === "UNKNOWN" ? "CONTRACT_TRANSACTION_NOT_FOUND" : outcome === "FAILED" ? "CONTRACT_TRANSACTION_FAILED" : null;
      const changed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-execution:${execution.id}`}, 0))`;
        const updated = await tx.automationExecution.updateMany({
          where: { id: execution.id, status: "SUBMISSION_UNKNOWN" },
          data: { status: finalStatus, errorCode, result: outcome === "SUCCEEDED" ? { status: "SUCCESS", reconciled: true } : undefined, completedAt: now },
        });
        if (updated.count !== 1) return false;
        await tx.outboxEvent.create({ data: { organizationId: execution.organizationId, eventType: outcome === "SUCCEEDED" ? "AUTOMATION_EXECUTION_SUCCEEDED" : "AUTOMATION_EXECUTION_FAILED", aggregateType: "AUTOMATION_EXECUTION", aggregateId: execution.id, payload: { ruleId: execution.ruleId, transactionId, reconciled: true, errorCode } } });
        return true;
      });
      results.push({ executionId: execution.id, outcome: changed ? outcome : "ALREADY_RECONCILED" });
    } catch (error) {
      results.push({ executionId: execution.id, outcome: "ERROR", error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }
  return { scanned: executions.length, results };
}

export async function triggerAutomation(ruleId: string, organizationId: string, idempotencyKey: string, facts: unknown, triggeredByUserId?: string) {
  const execution = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation:${ruleId}`}, 0))`;
    const rule = await tx.automationRule.findFirst({ where: { id: ruleId, organizationId, status: "ACTIVE" } });
    if (!rule) throw new Error("AUTOMATION_RULE_NOT_ACTIVE");
    const existing = await tx.automationExecution.findUnique({ where: { ruleId_idempotencyKey: { ruleId, idempotencyKey } } });
    if (existing) return existing;
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const daily = await tx.automationExecution.count({ where: { ruleId, createdAt: { gte: dayStart }, status: { not: "CANCELED" } } });
    if (daily >= rule.maxExecutionsPerDay) throw new Error("AUTOMATION_DAILY_LIMIT_REACHED");
    const status = rule.approvalThreshold > 0 ? "AWAITING_APPROVAL" : "PENDING";
    const created = await tx.automationExecution.create({ data: { organizationId, ruleId, idempotencyKey, status, triggerFactsHash: hash(facts), requiredApprovals: rule.approvalThreshold, triggeredByUserId } });
    await tx.outboxEvent.create({ data: { organizationId, eventType: status === "AWAITING_APPROVAL" ? "AUTOMATION_APPROVAL_REQUIRED" : "AUTOMATION_EXECUTION_STARTED", aggregateType: "AUTOMATION_EXECUTION", aggregateId: created.id, payload: { ruleId } } });
    return created;
  }, { isolationLevel: "Serializable" });
  return execution.status === "PENDING" ? executeAutomation(execution.id) : execution;
}

export async function runScheduledAutomations(limit = 25, now = new Date()) {
  const rules = await db.automationRule.findMany({ where: { status: "ACTIVE", triggerType: "SCHEDULE", nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: limit });
  let triggered = 0;
  for (const rule of rules) {
    const config = z.object({ intervalMinutes: z.number().int().min(1).max(10_080) }).parse(rule.triggerConfig);
    const scheduledFor = rule.nextRunAt ?? now;
    const claimed = await db.automationRule.updateMany({ where: { id: rule.id, version: rule.version, nextRunAt: scheduledFor }, data: { nextRunAt: new Date(scheduledFor.getTime() + config.intervalMinutes * 60_000), version: { increment: 1 } } });
    if (claimed.count !== 1) continue;
    await triggerAutomation(rule.id, rule.organizationId, `schedule:${scheduledFor.toISOString()}`, { scheduledFor: scheduledFor.toISOString() });
    triggered += 1;
  }
  return { scanned: rules.length, triggered };
}

export async function resumeDeferredAutomationPayments(limit = 25) {
  const executions = await db.automationExecution.findMany({
    where: { status: "PENDING", errorCode: "PAYMENT_APPROVAL_PENDING", rule: { status: "ACTIVE", actionType: "X402_PAYMENT" } },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let resumed = 0;
  for (const execution of executions) {
    await executeAutomation(execution.id);
    resumed += 1;
  }
  return { scanned: executions.length, resumed };
}

export async function runEventDrivenAutomations(limit = 50) {
  const rules = await db.automationRule.findMany({ where: { status: "ACTIVE", triggerType: { in: ["BALANCE_THRESHOLD", "INVOICE_EVENT"] } }, orderBy: { updatedAt: "asc" }, take: limit });
  let evaluated = 0, matched = 0, triggered = 0;
  for (const rule of rules) {
    evaluated += 1;
    if (rule.triggerType === "BALANCE_THRESHOLD") {
      const config = z.object({ assetId: z.string().uuid(), comparison: z.enum(["BELOW", "ABOVE"]), amountAtomic: z.string().regex(/^\d+$/) }).parse(rule.triggerConfig);
      const snapshot = await db.balanceSnapshot.findFirst({ where: { assetId: config.assetId, paymentAccount: { agentId: rule.agentId } }, orderBy: { asOf: "desc" }, include: { asset: { select: { symbol: true } }, paymentAccount: { select: { accountId: true } } } });
      if (!snapshot) continue;
      const balance = BigInt(snapshot.spendableAtomic.toString()); const threshold = BigInt(config.amountAtomic); const isMatch = config.comparison === "BELOW" ? balance < threshold : balance > threshold;
      if (!isMatch) continue; matched += 1;
      const result = await triggerAutomation(rule.id, rule.organizationId, `balance:${snapshot.id}:${config.comparison}:${config.amountAtomic}`, { snapshotId: snapshot.id, accountId: snapshot.paymentAccount.accountId, assetId: config.assetId, asset: snapshot.asset.symbol, spendableAtomic: balance.toString(), comparison: config.comparison, thresholdAtomic: config.amountAtomic, asOf: snapshot.asOf.toISOString() });
      if (result.createdAt.getTime() >= Date.now() - 60_000) triggered += 1;
    } else {
      const config = z.object({ status: z.enum(["SENT", "PAID", "OVERDUE"]) }).parse(rule.triggerConfig);
      const action = `INVOICE_${config.status}`;
      const events = await db.invoiceEvent.findMany({ where: { action, invoice: { OR: [{ issuerOrganizationId: rule.organizationId }, { recipientOrganizationId: rule.organizationId }] } }, include: { invoice: { select: { number: true, status: true, issuerOrganizationId: true, recipientOrganizationId: true, totalAtomic: true, asset: { select: { symbol: true } } } } }, orderBy: { occurredAt: "desc" }, take: 10 });
      for (const event of events) {
        matched += 1;
        const result = await triggerAutomation(rule.id, rule.organizationId, `invoice-event:${event.id}`, { invoiceEventId: event.id, invoiceId: event.invoiceId, number: event.invoice.number, status: event.invoice.status, totalAtomic: event.invoice.totalAtomic.toString(), asset: event.invoice.asset.symbol, occurredAt: event.occurredAt.toISOString() });
        if (result.createdAt.getTime() >= Date.now() - 60_000) triggered += 1;
      }
    }
  }
  return { evaluated, matched, triggered };
}

export function newWebhookSecret() { return randomBytes(32).toString("base64url"); }
export function webhookSecretHash(secret: string) { return hash(secret); }
export function encryptAutomationAction(action: AutomationActionInput) { return encryptSecret(JSON.stringify(action)); }
