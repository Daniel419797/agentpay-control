import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Agent Payments",
  description: "Policy-controlled payment flows for software purchasing APIs, data, services and other paid resources.",
};

export default function AgentPaymentsPage() {
  return <MarketingSite page="agent-payments" />;
}
