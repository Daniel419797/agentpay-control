import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Agent Commerce",
  description: "Govern agent-to-agent commerce with identity checks, budgets, job context and verified settlement.",
};

export default function AgentCommercePage() {
  return <MarketingSite page="agent-commerce" />;
}
