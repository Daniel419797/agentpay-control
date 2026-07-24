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
  amountAtomic: string;
  balanceAtomic: string;
  settledTodayAtomic: string;
  reservedTodayAtomic: string;
  perTransactionLimitAtomic: string;
  dailyLimitAtomic: string;
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
  if (denied.has(host)) return deny("MERCHANT_DENIED");
  if (input.merchantMode === "ALLOWLIST_ONLY" && !allowed.has(host)) return deny("MERCHANT_NOT_ALLOWED");
  if (amount <= 0n) return deny("INVALID_AMOUNT");
  if (amount > parseAtomic(input.balanceAtomic)) return deny("INSUFFICIENT_BALANCE");

  const breaches: string[] = [];
  if (amount > parseAtomic(input.perTransactionLimitAtomic)) breaches.push("PER_TRANSACTION_LIMIT_EXCEEDED");
  if (projected > parseAtomic(input.dailyLimitAtomic)) breaches.push("DAILY_LIMIT_EXCEEDED");
  if (breaches.length > 0) {
    return {
      decision: input.overLimitAction,
      reasonCodes: breaches,
      projectedSpendAtomic: projected.toString()
    };
  }

  return { decision: "ALLOW", reasonCodes: ["WITHIN_POLICY"], projectedSpendAtomic: projected.toString() };
}
