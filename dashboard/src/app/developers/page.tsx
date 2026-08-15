import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing-site";

export const metadata: Metadata = {
  title: "Developers",
  description: "Connect AgentPay payment and policy capabilities to agent environments and custom applications.",
};

export default function DevelopersPage() {
  return <MarketingSite page="developers" />;
}
