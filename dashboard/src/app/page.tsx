import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "AgentPay: Financial controls for autonomous software",
  description: "Govern how autonomous software pays, purchases resources and transacts through budgets, policies, approvals and auditable payment rails.",
};

export default function Home() {
  return <MarketingSite page="home" />;
}
