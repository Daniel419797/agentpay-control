"use client";

import { useState } from "react";

export function CopyTextButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return <button className="secondary-button" type="button" onClick={() => void copy()}>{copied ? "Copied" : label}</button>;
}
