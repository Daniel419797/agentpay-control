import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Product",
  description: "Explore AgentPay's policy, payment, approval, credential and audit control plane for autonomous software.",
};

export default function ProductPage() {
  return <MarketingSite page="product" />;
}
