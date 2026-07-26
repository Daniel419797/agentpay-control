import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getConfig } from "@/lib/config";

export type CardProviderName = "SANDBOX" | "STRIPE";

export type CreateCardholderInput = {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: { day: number; month: number; year: number };
  address: { line1: string; line2?: string; city: string; state?: string; postalCode: string; country: string };
};

export type IssueCardInput = {
  cardholderId: string;
  currency: string;
  spendingLimitMinor?: string;
  spendingInterval?: string;
  allowedCategories: string[];
  blockedCategories: string[];
  allowedCountries: string[];
  idempotencyKey: string;
};

export type ProviderCard = {
  id: string;
  status: "ACTIVE" | "INACTIVE" | "FROZEN" | "CANCELED";
  currency: string;
  last4: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
};

export type ProviderFiatAccount = { id: string; status: "PENDING" | "ACTIVE" | "RESTRICTED" | "CLOSED"; availableMinor: string; pendingMinor: string };
export type ProviderFiatTransfer = { id: string; status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED" };

export interface CardProviderAdapter {
  readonly name: CardProviderName;
  createCardholder(input: CreateCardholderInput, idempotencyKey: string): Promise<{ id: string; status: "ACTIVE" | "PENDING" | "INACTIVE" | "REJECTED" }>;
  issueVirtualCard(input: IssueCardInput): Promise<ProviderCard>;
  updateCardStatus(externalCardId: string, status: "ACTIVE" | "INACTIVE" | "CANCELED", idempotencyKey: string): Promise<ProviderCard>;
  createFiatAccount(input: { currency: string; displayName: string }, idempotencyKey: string): Promise<ProviderFiatAccount>;
  createFiatTransfer(input: { direction: "DEPOSIT" | "WITHDRAWAL"; financialAccountId: string; instrumentId: string; amountMinor: string; currency: string; description?: string }, idempotencyKey: string): Promise<ProviderFiatTransfer>;
  retrieveFiatAccount(externalAccountId: string): Promise<ProviderFiatAccount>;
  retrieveFiatTransfer(externalTransferId: string, direction: "DEPOSIT" | "WITHDRAWAL"): Promise<ProviderFiatTransfer>;
  createCardDisplayKey(externalCardId: string, nonce: string): Promise<{ secret: string }>;
}

const stripeCardholder = z.object({ id: z.string(), status: z.enum(["active", "inactive", "blocked"]).optional() });
const stripeCard = z.object({
  id: z.string(),
  status: z.enum(["active", "inactive", "canceled"]),
  currency: z.string(),
  last4: z.string().length(4),
  brand: z.string().optional(),
  exp_month: z.number().optional(),
  exp_year: z.number().optional(),
});

function addArray(params: URLSearchParams, key: string, values: string[]) {
  values.forEach((value, index) => params.set(`${key}[${index}]`, value));
}

async function stripeRequest<T>(path: string, body: URLSearchParams, idempotencyKey: string, schema: z.ZodType<T>): Promise<T> {
  const config = getConfig();
  if (!config.STRIPE_RESTRICTED_KEY) throw new Error("STRIPE_RESTRICTED_KEY_NOT_CONFIGURED");
  const response = await fetch(`${config.STRIPE_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.STRIPE_RESTRICTED_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": idempotencyKey,
      "stripe-version": "2026-06-24.dahlia",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = z.object({ error: z.object({ code: z.string().optional() }).optional() }).safeParse(payload);
    throw new Error(`CARD_PROVIDER_ERROR:${response.status}:${message.success ? message.data.error?.code ?? "unknown" : "invalid_response"}`);
  }
  return schema.parse(payload);
}

async function stripeV2Request<T>(path: string, body: unknown, idempotencyKey: string, schema: z.ZodType<T>): Promise<T> {
  const config = getConfig();
  if (!config.STRIPE_RESTRICTED_KEY) throw new Error("STRIPE_RESTRICTED_KEY_NOT_CONFIGURED");
  const response = await fetch(`${config.STRIPE_API_BASE_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.STRIPE_RESTRICTED_KEY}`, "content-type": "application/json", "idempotency-key": idempotencyKey, "stripe-version": config.STRIPE_MONEY_MANAGEMENT_VERSION },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = z.object({ error: z.object({ code: z.string().optional() }).optional() }).safeParse(payload);
    throw new Error(`FIAT_PROVIDER_ERROR:${response.status}:${message.success ? message.data.error?.code ?? "unknown" : "invalid_response"}`);
  }
  return schema.parse(payload);
}

async function stripeV2Get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const config = getConfig();
  if (!config.STRIPE_RESTRICTED_KEY) throw new Error("STRIPE_RESTRICTED_KEY_NOT_CONFIGURED");
  const response = await fetch(`${config.STRIPE_API_BASE_URL}${path}`, { headers: { authorization: `Bearer ${config.STRIPE_RESTRICTED_KEY}`, "stripe-version": config.STRIPE_MONEY_MANAGEMENT_VERSION }, signal: AbortSignal.timeout(10_000) });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`FIAT_PROVIDER_READ_ERROR:${response.status}`);
  return schema.parse(payload);
}

const financialAccountSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "open", "closed"]),
  balance: z.object({
    available: z.record(z.string(), z.object({ value: z.number().int() })).default({}),
    inbound_pending: z.record(z.string(), z.object({ value: z.number().int() })).default({}),
    outbound_pending: z.record(z.string(), z.object({ value: z.number().int() })).default({}),
  }).optional(),
});
const moneyMovementSchema = z.object({ id: z.string(), status: z.string().optional() });

function mapFinancialAccount(account: z.infer<typeof financialAccountSchema>, currencyHint?: string): ProviderFiatAccount {
  const currency = currencyHint?.toLowerCase() ?? Object.keys(account.balance?.available ?? {})[0] ?? "usd";
  return { id: account.id, status: account.status === "open" ? "ACTIVE" : account.status === "closed" ? "CLOSED" : "PENDING", availableMinor: String(account.balance?.available[currency]?.value ?? 0), pendingMinor: String((account.balance?.inbound_pending[currency]?.value ?? 0) + (account.balance?.outbound_pending[currency]?.value ?? 0)) };
}

function mapMoneyMovement(transfer: z.infer<typeof moneyMovementSchema>): ProviderFiatTransfer {
  const status = transfer.status === "succeeded" || transfer.status === "posted" ? "SUCCEEDED" : transfer.status === "failed" || transfer.status === "returned" ? "FAILED" : transfer.status === "canceled" ? "CANCELED" : transfer.status === "pending" ? "PENDING" : "PROCESSING";
  return { id: transfer.id, status };
}

class StripeCardProvider implements CardProviderAdapter {
  readonly name = "STRIPE" as const;

  async createCardholder(input: CreateCardholderInput, idempotencyKey: string) {
    const body = new URLSearchParams({
      type: "individual",
      name: input.name,
      email: input.email,
      "billing[address][line1]": input.address.line1,
      "billing[address][city]": input.address.city,
      "billing[address][postal_code]": input.address.postalCode,
      "billing[address][country]": input.address.country,
      "individual[first_name]": input.firstName,
      "individual[last_name]": input.lastName,
    });
    if (input.phone) body.set("phone_number", input.phone);
    if (input.address.line2) body.set("billing[address][line2]", input.address.line2);
    if (input.address.state) body.set("billing[address][state]", input.address.state);
    if (input.dateOfBirth) {
      body.set("individual[dob][day]", String(input.dateOfBirth.day));
      body.set("individual[dob][month]", String(input.dateOfBirth.month));
      body.set("individual[dob][year]", String(input.dateOfBirth.year));
    }
    const cardholder = await stripeRequest("/v1/issuing/cardholders", body, idempotencyKey, stripeCardholder);
    return { id: cardholder.id, status: cardholder.status === "active" ? "ACTIVE" as const : cardholder.status === "blocked" ? "REJECTED" as const : "PENDING" as const };
  }

  async issueVirtualCard(input: IssueCardInput) {
    const body = new URLSearchParams({ type: "virtual", cardholder: input.cardholderId, currency: input.currency.toLowerCase(), status: "active" });
    if (input.spendingLimitMinor && input.spendingInterval) {
      body.set("spending_controls[spending_limits][0][amount]", input.spendingLimitMinor);
      body.set("spending_controls[spending_limits][0][interval]", input.spendingInterval);
    }
    addArray(body, "spending_controls[allowed_categories]", input.allowedCategories);
    addArray(body, "spending_controls[blocked_categories]", input.blockedCategories);
    addArray(body, "spending_controls[allowed_merchant_countries]", input.allowedCountries);
    return mapStripeCard(await stripeRequest("/v1/issuing/cards", body, input.idempotencyKey, stripeCard));
  }

  async updateCardStatus(externalCardId: string, status: "ACTIVE" | "INACTIVE" | "CANCELED", idempotencyKey: string) {
    const body = new URLSearchParams({ status: status.toLowerCase() });
    return mapStripeCard(await stripeRequest(`/v1/issuing/cards/${encodeURIComponent(externalCardId)}`, body, idempotencyKey, stripeCard));
  }

  async createFiatAccount(input: { currency: string; displayName: string }, idempotencyKey: string) {
    const currency = input.currency.toLowerCase();
    const account = await stripeV2Request("/v2/money_management/financial_accounts", { type: "storage", display_name: input.displayName, storage: { holds_currencies: [currency] } }, idempotencyKey, financialAccountSchema);
    return mapFinancialAccount(account, currency);
  }

  async createFiatTransfer(input: { direction: "DEPOSIT" | "WITHDRAWAL"; financialAccountId: string; instrumentId: string; amountMinor: string; currency: string; description?: string }, idempotencyKey: string) {
    const currency = input.currency.toLowerCase();
    const path = input.direction === "DEPOSIT" ? "/v2/money_management/inbound_transfers" : "/v2/money_management/outbound_transfers";
    const endpoints = input.direction === "DEPOSIT"
      ? { from: { payment_method: input.instrumentId }, to: { financial_account: input.financialAccountId, currency } }
      : { from: { financial_account: input.financialAccountId, currency }, to: { payout_method: input.instrumentId, currency } };
    const transfer = await stripeV2Request(path, { ...endpoints, amount: { value: Number(input.amountMinor), currency }, description: input.description }, idempotencyKey, moneyMovementSchema);
    return mapMoneyMovement(transfer);
  }

  async retrieveFiatAccount(externalAccountId: string) {
    return mapFinancialAccount(await stripeV2Get(`/v2/money_management/financial_accounts/${encodeURIComponent(externalAccountId)}`, financialAccountSchema));
  }

  async retrieveFiatTransfer(externalTransferId: string, direction: "DEPOSIT" | "WITHDRAWAL") {
    const collection = direction === "DEPOSIT" ? "inbound_transfers" : "outbound_transfers";
    return mapMoneyMovement(await stripeV2Get(`/v2/money_management/${collection}/${encodeURIComponent(externalTransferId)}`, moneyMovementSchema));
  }

  async createCardDisplayKey(externalCardId: string, nonce: string) {
    const config = getConfig();
    if (!config.STRIPE_RESTRICTED_KEY) throw new Error("STRIPE_RESTRICTED_KEY_NOT_CONFIGURED");
    const response = await fetch(`${config.STRIPE_API_BASE_URL}/v1/ephemeral_keys`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.STRIPE_RESTRICTED_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2026-02-25.clover" },
      body: new URLSearchParams({ issuing_card: externalCardId, nonce }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`CARD_DISPLAY_KEY_ERROR:${response.status}`);
    return z.object({ secret: z.string().min(1) }).parse(payload);
  }
}

function mapStripeCard(card: z.infer<typeof stripeCard>): ProviderCard {
  return { id: card.id, status: card.status.toUpperCase() as ProviderCard["status"], currency: card.currency.toUpperCase(), last4: card.last4, brand: card.brand, expMonth: card.exp_month, expYear: card.exp_year };
}

class SandboxCardProvider implements CardProviderAdapter {
  readonly name = "SANDBOX" as const;
  async createCardholder() { return { id: `ich_sandbox_${randomUUID()}`, status: "ACTIVE" as const }; }
  async issueVirtualCard(input: IssueCardInput): Promise<ProviderCard> {
    const year = new Date().getUTCFullYear() + 3;
    return { id: `ic_sandbox_${randomUUID()}`, status: "ACTIVE", currency: input.currency, last4: String(randomInt(0, 10_000)).padStart(4, "0"), brand: "Visa", expMonth: 12, expYear: year };
  }
  async updateCardStatus(externalCardId: string, status: "ACTIVE" | "INACTIVE" | "CANCELED"): Promise<ProviderCard> {
    return { id: externalCardId, status, currency: "USD", last4: "0000" };
  }
  async createFiatAccount() { return { id: `fa_sandbox_${randomUUID()}`, status: "ACTIVE" as const, availableMinor: "0", pendingMinor: "0" }; }
  async createFiatTransfer(input: { direction: "DEPOSIT" | "WITHDRAWAL" }) { return { id: `${input.direction === "DEPOSIT" ? "ibt" : "obt"}_sandbox_${randomUUID()}`, status: "SUCCEEDED" as const }; }
  async retrieveFiatAccount(externalAccountId: string) { return { id: externalAccountId, status: "ACTIVE" as const, availableMinor: "0", pendingMinor: "0" }; }
  async retrieveFiatTransfer(externalTransferId: string) { return { id: externalTransferId, status: "SUCCEEDED" as const }; }
  async createCardDisplayKey(): Promise<{ secret: string }> { throw new Error("CARD_DETAILS_UNAVAILABLE_IN_SANDBOX"); }
}

export function getCardProvider(): CardProviderAdapter {
  return getConfig().CARD_PROVIDER === "STRIPE" ? new StripeCardProvider() : new SandboxCardProvider();
}

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!header) return false;
  const fields = header.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(fields.find(([key]) => key === "t")?.[1]);
  const signatures = fields.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds || signatures.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  return signatures.some((signature) => {
    const actual = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
