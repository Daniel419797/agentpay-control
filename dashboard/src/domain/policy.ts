import { parseAtomic } from "@/domain/money";

export type PolicyOutcome = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type PolicyInput = {
  agentStatus: "ACTIVE" | "PAUSED" | "PROVISIONING" | "ERROR" | "ARCHIVED";
  organizationKillSwitch: boolean;
  assetSupported: boolean;
  challengeExpired: boolean;
  merchantHost: string;
  merchantMode: "ANY" | "ALLOWLIST_ONLY";
  allowedHosts: string[];
  deniedHosts: string[];
  merchantCategory?: string;
  allowedMerchantCategories?: string[];
  evaluatedAt?: Date;
  activeFrom?: Date | null;
  activeUntil?: Date | null;
  allowedWeekdays?: number[];
  allowedStartMinute?: number | null;
  allowedEndMinute?: number | null;
  amountAtomic: string;
  balanceAtomic: string;
  settledTodayAtomic: string;
  reservedTodayAtomic: string;
  perTransactionLimitAtomic: string;
  dailyLimitAtomic: string;
  hourlySpendAtomic?: string;
  hourlyLimitAtomic?: string | null;
  monthlySpendAtomic?: string;
  monthlyLimitAtomic?: string | null;
  transactionsLastHour?: number;
  maxTransactionsPerHour?: number | null;
  lastTransactionAt?: Date | null;
  cooldownSeconds?: number | null;
  overLimitAction: "DENY" | "REQUIRE_APPROVAL";
};

export type PolicyResult = {
  decision: PolicyOutcome;
  reasonCodes: string[];
  projectedSpendAtomic: string;
};

function normalizedHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function policyScheduleViolation(input: Pick<PolicyInput, "evaluatedAt" | "activeFrom" | "activeUntil" | "allowedWeekdays" | "allowedStartMinute" | "allowedEndMinute">) {
  const now = input.evaluatedAt ?? new Date();
  if (input.activeFrom && now < input.activeFrom) return "POLICY_NOT_ACTIVE";
  if (input.activeUntil && now >= input.activeUntil) return "POLICY_EXPIRED";
  if (input.allowedWeekdays?.length && !input.allowedWeekdays.includes(now.getUTCDay())) return "OUTSIDE_POLICY_SCHEDULE";
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (input.allowedStartMinute != null && input.allowedEndMinute != null) {
    const inWindow = input.allowedStartMinute <= input.allowedEndMinute
      ? minute >= input.allowedStartMinute && minute < input.allowedEndMinute
      : minute >= input.allowedStartMinute || minute < input.allowedEndMinute;
    if (!inWindow) return "OUTSIDE_POLICY_SCHEDULE";
  }
  return null;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const host = normalizedHost(input.merchantHost);
  const allowed = new Set(input.allowedHosts.map(normalizedHost));
  const denied = new Set(input.deniedHosts.map(normalizedHost));
  const amount = parseAtomic(input.amountAtomic);
  const projected = parseAtomic(input.settledTodayAtomic) + parseAtomic(input.reservedTodayAtomic) + amount;
  const deny = (code: string): PolicyResult => ({ decision: "DENY", reasonCodes: [code], projectedSpendAtomic: projected.toString() });

  if (input.organizationKillSwitch) return deny("KILL_SWITCH_ACTIVE");
  if (input.agentStatus !== "ACTIVE") return deny("AGENT_INACTIVE");
  if (!input.assetSupported) return deny("ASSET_UNSUPPORTED");
  if (input.challengeExpired) return deny("CHALLENGE_EXPIRED");
  const now = input.evaluatedAt ?? new Date();
  const scheduleViolation = policyScheduleViolation(input);
  if (scheduleViolation) return deny(scheduleViolation);
  if (denied.has(host)) return deny("MERCHANT_DENIED");
  if (input.merchantMode === "ALLOWLIST_ONLY" && !allowed.has(host)) return deny("MERCHANT_NOT_ALLOWED");
  if (input.allowedMerchantCategories?.length && (!input.merchantCategory || !input.allowedMerchantCategories.includes(input.merchantCategory))) return deny("MERCHANT_CATEGORY_NOT_ALLOWED");
  if (amount <= 0n) return deny("INVALID_AMOUNT");
  if (amount > parseAtomic(input.balanceAtomic)) return deny("INSUFFICIENT_BALANCE");

  const breaches: string[] = [];
  if (amount > parseAtomic(input.perTransactionLimitAtomic)) breaches.push("PER_TRANSACTION_LIMIT_EXCEEDED");
  if (projected > parseAtomic(input.dailyLimitAtomic)) breaches.push("DAILY_LIMIT_EXCEEDED");
  if (input.hourlyLimitAtomic && parseAtomic(input.hourlySpendAtomic ?? "0") + amount > parseAtomic(input.hourlyLimitAtomic)) breaches.push("HOURLY_LIMIT_EXCEEDED");
  if (input.monthlyLimitAtomic && parseAtomic(input.monthlySpendAtomic ?? "0") + amount > parseAtomic(input.monthlyLimitAtomic)) breaches.push("MONTHLY_LIMIT_EXCEEDED");
  if (input.maxTransactionsPerHour != null && (input.transactionsLastHour ?? 0) >= input.maxTransactionsPerHour) breaches.push("HOURLY_VELOCITY_EXCEEDED");
  if (input.cooldownSeconds && input.lastTransactionAt && now.getTime() - input.lastTransactionAt.getTime() < input.cooldownSeconds * 1000) breaches.push("PAYMENT_COOLDOWN_ACTIVE");
  if (breaches.length > 0) {
    return {
      decision: input.overLimitAction,
      reasonCodes: breaches,
      projectedSpendAtomic: projected.toString()
    };
  }

  return { decision: "ALLOW", reasonCodes: ["WITHIN_POLICY"], projectedSpendAtomic: projected.toString() };
}
