import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Security",
  description: "Learn how AgentPay uses scoped access, fail-closed controls, policy enforcement and auditable settlement evidence.",
};

export default function SecurityPage() {
  return <MarketingSite page="security" />;
}
