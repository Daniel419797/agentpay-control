import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Controls & Approvals",
  description: "Set agent budgets, transaction limits, payee rules, approval thresholds and emergency controls.",
};

export default function ControlsPage() {
  return <MarketingSite page="controls" />;
}
