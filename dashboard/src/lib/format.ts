export function formatAtomic(amount: string, decimals: number) {
  const negative = amount.startsWith("-");
  const digits = negative ? amount.slice(1) : amount;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
