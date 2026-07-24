import { z } from "zod";

export const atomicAmountSchema = z.string().regex(/^[0-9]+$/, "Must be a non-negative atomic integer");

export type AtomicAmount = string;

export function parseAtomic(value: string): bigint {
  return BigInt(atomicAmountSchema.parse(value));
}

export function addAtomic(...values: string[]): string {
  return values.reduce((sum, value) => sum + parseAtomic(value), 0n).toString();
}

export function formatAtomic(value: string, decimals: number, maximumFractionDigits = decimals): string {
  const atomic = parseAtomic(value);
  if (decimals === 0) return atomic.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = atomic / divisor;
  const fraction = (atomic % divisor).toString().padStart(decimals, "0").slice(0, maximumFractionDigits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function isPositiveAtomic(value: string): boolean {
  return parseAtomic(value) > 0n;
}
