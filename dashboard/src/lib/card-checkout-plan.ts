import { z } from "zod";

const selector = z.string().min(1).max(500);
const shortValue = z.string().max(2_000);
const timeoutMs = z.number().int().min(100).max(15_000).optional();

const fillStep = z.object({ op: z.literal("fill"), selector, value: shortValue }).strict();
const selectStep = z.object({ op: z.literal("select"), selector, value: shortValue }).strict();
const clickStep = z.object({ op: z.literal("click"), selector, timeoutMs }).strict();
const submitStep = z.object({ op: z.literal("submit"), selector, timeoutMs }).strict();
const checkStep = z.object({ op: z.literal("check"), selector }).strict();
const waitStep = z.object({ op: z.literal("wait"), selector, timeoutMs }).strict();

const secretName = z.enum(["CARD_NUMBER", "CVC", "CARD_EXPIRY", "EXP_MONTH", "EXP_YEAR"]);
const secretStep = z.object({ op: z.literal("secret"), selector, secret: secretName }).strict();
const frameSecretStep = z.object({ op: z.literal("frame_secret"), frameSelector: selector, selector, secret: secretName }).strict();
const assertStep = z.object({ op: z.literal("assert"), selector, contains: z.string().min(1).max(500), timeoutMs }).strict();

export const checkoutStepSchema = z.discriminatedUnion("op", [
  fillStep,
  selectStep,
  clickStep,
  submitStep,
  checkStep,
  waitStep,
  secretStep,
  frameSecretStep,
  assertStep,
]);

export const checkoutPlanSchema = z.object({
  steps: z.array(checkoutStepSchema).min(1).max(40),
  successUrlPrefix: z.string().url().max(2_000).optional(),
  successText: z.object({ selector, contains: z.string().min(1).max(500) }).strict().optional(),
}).strict().superRefine((plan, ctx) => {
  const sensitiveSteps = plan.steps.filter((step) => step.op === "secret" || step.op === "frame_secret");
  const secrets = new Set(sensitiveSteps.map((step) => step.secret));
  const missing: string[] = [];
  if (!secrets.has("CARD_NUMBER")) missing.push("CARD_NUMBER");
  if (!secrets.has("CVC")) missing.push("CVC");
  if (!secrets.has("CARD_EXPIRY") && !(secrets.has("EXP_MONTH") && secrets.has("EXP_YEAR"))) missing.push("CARD_EXPIRY or EXP_MONTH + EXP_YEAR");
  if (missing.length) ctx.addIssue({ code: "custom", message: `Checkout plan is missing required card fields: ${missing.join(", ")}`, path: ["steps"] });

  const submitCount = plan.steps.filter((step) => step.op === "submit").length;
  if (submitCount > 1) ctx.addIssue({ code: "custom", message: "Checkout plan can contain at most one explicit submit step.", path: ["steps"] });

  const plainBytes = plan.steps.reduce((total, step) => {
    if (step.op === "fill" || step.op === "select") return total + Buffer.byteLength(step.value, "utf8");
    return total;
  }, 0);
  if (plainBytes > 16 * 1024) ctx.addIssue({ code: "custom", message: "Checkout plan contains too much non-sensitive form data.", path: ["steps"] });
  if (!plan.successUrlPrefix && !plan.successText) ctx.addIssue({ code: "custom", message: "Provide successUrlPrefix or successText so checkout completion can be verified.", path: [] });
});

export type CheckoutPlan = z.infer<typeof checkoutPlanSchema>;
export type CheckoutStep = z.infer<typeof checkoutStepSchema>;

export function normalizeHostPattern(value: string) {
  const input = value.trim().toLowerCase();
  const wildcard = input.startsWith("*.");
  const host = wildcard ? input.slice(2) : input;
  if (!host || host.length > 253 || host.includes("/") || host.includes(":") || host.includes("@") || host.includes("..")) throw new Error("CARD_AUTONOMY_HOST_INVALID");
  const labels = host.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("CARD_AUTONOMY_HOST_INVALID");
  return wildcard ? `*.${host}` : host;
}

export function hostMatchesPattern(hostname: string, pattern: string) {
  const host = hostname.toLowerCase();
  const normalized = normalizeHostPattern(pattern);
  if (!normalized.startsWith("*.")) return host === normalized;
  const suffix = normalized.slice(1);
  return host.endsWith(suffix) && host.length > suffix.length;
}

export function planSummary(plan: CheckoutPlan) {
  return {
    steps: plan.steps.map((step) => ({ op: step.op, secret: "secret" in step ? step.secret : undefined })),
    hasExplicitSubmit: plan.steps.some((step) => step.op === "submit"),
    hasSuccessUrl: Boolean(plan.successUrlPrefix),
    hasSuccessText: Boolean(plan.successText),
  };
}
