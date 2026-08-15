import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "AgentPay product packaging for developers, teams and enterprise agent operations.",
};

export default function PricingPage() {
  return <MarketingSite page="pricing" />;
}
