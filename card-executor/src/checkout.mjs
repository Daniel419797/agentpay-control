import { chromium } from "playwright";

import { assertAllowedUrl, buildPinnedNetworkPolicy, parseTrustedHosts } from "./security.mjs";

export class ChallengeRequiredError extends Error {
  constructor(challengeType = "OTHER") {
    super("CHECKOUT_REQUIRES_HUMAN");
    this.name = "ChallengeRequiredError";
    this.challengeType = challengeType;
  }
}

export class SubmissionUnknownError extends Error {
  constructor(code = "SUBMISSION_UNKNOWN") {
    super(code);
    this.name = "SubmissionUnknownError";
  }
}

function secretValue(secrets, name) {
  if (name === "CARD_NUMBER") return secrets.number;
  if (name === "CVC") return secrets.cvc;
  if (name === "EXP_MONTH") return String(secrets.expMonth).padStart(2, "0");
  if (name === "EXP_YEAR") return String(secrets.expYear);
  throw new Error("CHECKOUT_SECRET_UNSUPPORTED");
}

function fieldLooksSafe(meta, secret) {
  const haystack = [meta.name, meta.id, meta.placeholder, meta.autocomplete, meta.ariaLabel].filter(Boolean).join(" ").toLowerCase();
  if (secret === "CARD_NUMBER") return meta.autocomplete === "cc-number" || /card.?number|cc.?number/.test(haystack);
  if (secret === "CVC") return meta.autocomplete === "cc-csc" || /cvc|cvv|security.?code|card.?code/.test(haystack);
  if (secret === "EXP_MONTH") return meta.autocomplete === "cc-exp-month" || /(exp|expiry|expiration).*(month|mm)|month.*(exp|expiry)/.test(haystack);
  if (secret === "EXP_YEAR") return meta.autocomplete === "cc-exp-year" || /(exp|expiry|expiration).*(year|yy)|year.*(exp|expiry)/.test(haystack);
  return false;
}

async function inspectField(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  return await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    type: element.getAttribute("type") ?? "",
    name: element.getAttribute("name") ?? "",
    id: element.getAttribute("id") ?? "",
    placeholder: element.getAttribute("placeholder") ?? "",
    autocomplete: element.getAttribute("autocomplete") ?? "",
    ariaLabel: element.getAttribute("aria-label") ?? "",
  }));
}

async function injectSecret(locator, secret, value) {
  const meta = await inspectField(locator);
  if (!["input", "select"].includes(meta.tag) || !fieldLooksSafe(meta, secret)) throw new Error(`CHECKOUT_SECRET_TARGET_REJECTED_${secret}`);
  if (meta.tag === "select") {
    try { await locator.selectOption(value); }
    catch {
      const numeric = String(Number(value));
      await locator.selectOption(numeric);
    }
  } else {
    await locator.fill(value);
  }
}

async function detectChallenge(page) {
  const frameUrls = page.frames().map((frame) => frame.url().toLowerCase());
  if (frameUrls.some((url) => /3ds|three.?d.?secure|challenge/.test(url))) return "3DS";
  if (frameUrls.some((url) => /captcha|recaptcha|hcaptcha|turnstile/.test(url))) return "CAPTCHA";
  let text = "";
  try { text = (await page.locator("body").innerText({ timeout: 1_000 })).slice(0, 20_000).toLowerCase(); } catch { /* no readable body */ }
  if (/captcha|verify you are human|i am not a robot/.test(text)) return "CAPTCHA";
  if (/one[- ]time (code|password)|verification code|enter.*otp|security code sent/.test(text)) return "OTP";
  if (/3d secure|verify (it'?s|its) you|confirm this purchase/.test(text)) return "3DS";
  return null;
}

async function verifySuccess(page, plan) {
  if (plan.successUrlPrefix && page.url().startsWith(plan.successUrlPrefix)) return "URL_PREFIX";
  if (plan.successText) {
    try {
      const locator = page.locator(plan.successText.selector);
      await locator.waitFor({ state: "visible", timeout: 5_000 });
      const text = await locator.innerText();
      if (text.includes(plan.successText.contains)) return "TEXT_ASSERTION";
    } catch { /* verified below */ }
  }
  return null;
}

export async function executeCheckout({ task, secrets, heartbeat, checkpointSubmission }) {
  const trustedHosts = parseTrustedHosts(process.env.CARD_EXECUTOR_TRUSTED_EGRESS_HOSTS ?? "");
  const network = await buildPinnedNetworkPolicy(task.merchantUrl, trustedHosts);
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--host-resolver-rules=${network.resolverRules}`,
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
    ],
  });
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block",
    permissions: [],
    ignoreHTTPSErrors: false,
  });
  context.setDefaultTimeout(Math.min(15_000, task.maxCheckoutSeconds * 1_000));
  const page = await context.newPage();
  const deadline = Date.now() + task.maxCheckoutSeconds * 1_000;
  let submitted = false;
  try {
    await page.route("**/*", async (route) => {
      try {
        assertAllowedUrl(route.request().url(), network.allowedHosts);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(task.merchantUrl, { waitUntil: "domcontentloaded", timeout: Math.min(20_000, task.maxCheckoutSeconds * 1_000) });
    assertAllowedUrl(page.url(), network.allowedHosts);

    for (const step of task.checkoutPlan.steps) {
      if (Date.now() >= deadline) throw new Error("CHECKOUT_DEADLINE_EXCEEDED");
      const timeout = step.timeoutMs ?? Math.min(10_000, Math.max(500, deadline - Date.now()));
      if (step.op === "fill") await page.locator(step.selector).fill(step.value, { timeout });
      else if (step.op === "select") await page.locator(step.selector).selectOption(step.value, { timeout });
      else if (step.op === "check") await page.locator(step.selector).check({ timeout });
      else if (step.op === "click") await page.locator(step.selector).click({ timeout });
      else if (step.op === "wait") await page.locator(step.selector).waitFor({ state: "visible", timeout });
      else if (step.op === "assert") {
        const locator = page.locator(step.selector);
        await locator.waitFor({ state: "visible", timeout });
        const text = await locator.innerText({ timeout });
        if (!text.includes(step.contains)) throw new Error("CHECKOUT_ASSERTION_FAILED");
      } else if (step.op === "secret") {
        await heartbeat();
        await injectSecret(page.locator(step.selector), step.secret, secretValue(secrets, step.secret));
      } else if (step.op === "frame_secret") {
        await heartbeat();
        await injectSecret(page.frameLocator(step.frameSelector).locator(step.selector), step.secret, secretValue(secrets, step.secret));
      } else if (step.op === "submit") {
        await heartbeat();
        await checkpointSubmission();
        submitted = true;
        try { await page.locator(step.selector).click({ timeout }); }
        catch { throw new SubmissionUnknownError("SUBMISSION_CLICK_OUTCOME_UNKNOWN"); }
      }

      if (submitted) {
        await heartbeat();
        const challenge = await detectChallenge(page);
        const verification = await verifySuccess(page, task.checkoutPlan);
        if (verification) return { status: "CHECKOUT_SUCCEEDED", resultCode: "CHECKOUT_SUCCESS_VERIFIED", verification, finalUrl: page.url() };
        if (challenge) throw new ChallengeRequiredError(challenge);
      }
    }

    const verification = await verifySuccess(page, task.checkoutPlan);
    if (verification) return { status: "CHECKOUT_SUCCEEDED", resultCode: "CHECKOUT_SUCCESS_VERIFIED", verification, finalUrl: page.url() };
    const challenge = await detectChallenge(page);
    if (challenge) throw new ChallengeRequiredError(challenge);
    if (submitted) throw new SubmissionUnknownError("SUBMISSION_RESULT_UNVERIFIED");
    throw new Error("CHECKOUT_SUCCESS_NOT_VERIFIED");
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
