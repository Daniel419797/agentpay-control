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
const secretName = z.enum(["CARD_NUMBER", "CVC", "EXP_MONTH", "EXP_YEAR"]);
const secretStep = z.object({ op: z.literal("secret"), selector, secret: secretName }).strict();
const frameSecretStep = z.object({ op: z.literal("frame_secret"), frameSelector: selector, selector, secret: secretName }).strict();
const assertStep = z.object({ op: z.literal("assert"), selector, contains: z.string().min(1).max(500), timeoutMs }).strict();

export const checkoutStepSchema = z.discriminatedUnion("op", [fillStep, selectStep, clickStep, submitStep, checkStep, waitStep, secretStep, frameSecretStep, assertStep]);

export const checkoutPlanSchema = z.object({
  steps: z.array(checkoutStepSchema).min(1).max(40),
  successUrlPrefix: z.string().url().max(2_000).optional(),
  successText: z.object({ selector, contains: z.string().min(1).max(500) }).strict().optional(),
}).strict().superRefine((plan, ctx) => {
  const sensitiveSteps = plan.steps.filter((step) => step.op === "secret" || step.op === "frame_secret");
  const required = new Set(["CARD_NUMBER", "CVC", "EXP_MONTH", "EXP_YEAR"]);
  for (const step of sensitiveSteps) required.delete(step.secret);
  if (required.size) ctx.addIssue({ code: "custom", message: `Checkout plan is missing required card fields: ${[...required].join(", ")}`, path: ["steps"] });

  const submitIndexes = plan.steps.map((step, index) => step.op === "submit" ? index : -1).filter((index) => index >= 0);
  if (submitIndexes.length !== 1) ctx.addIssue({ code: "custom", message: "Checkout plan must contain exactly one explicit submit step.", path: ["steps"] });
  const submitIndex = submitIndexes[0] ?? Number.MAX_SAFE_INTEGER;
  const firstSecret = plan.steps.findIndex((step) => step.op === "secret" || step.op === "frame_secret");
  if (firstSecret >= 0 && submitIndex < firstSecret) ctx.addIssue({ code: "custom", message: "The submit step must occur after card credentials are injected.", path: ["steps"] });
  plan.steps.forEach((step, index) => {
    if (firstSecret >= 0 && index > firstSecret && index < submitIndex && step.op === "click") ctx.addIssue({ code: "custom", message: "Use the explicit submit operation for the payment-triggering click after card credentials are present.", path: ["steps", index] });
    if (index > submitIndex && ["fill", "select", "check", "click", "secret", "frame_secret", "submit"].includes(step.op)) ctx.addIssue({ code: "custom", message: "Only wait/assert verification steps may run after checkout submission.", path: ["steps", index] });
  });

  const plainBytes = plan.steps.reduce((total, step) => step.op === "fill" || step.op === "select" ? total + Buffer.byteLength(step.value, "utf8") : total, 0);
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
  return { steps: plan.steps.map((step) => ({ op: step.op, secret: "secret" in step ? step.secret : undefined })), hasSuccessUrl: Boolean(plan.successUrlPrefix), hasSuccessText: Boolean(plan.successText) };
}
