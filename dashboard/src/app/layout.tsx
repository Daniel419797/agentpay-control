import type { Metadata } from "next";
import { Toaster } from "sonner";
import "@/app/globals.css";
import "@/app/accessibility.css";

export const metadata: Metadata = {
  title: { default: "AgentPay Control", template: "%s · AgentPay Control" },
  description: "Policy-controlled x402 and financial operations for autonomous agents across configured Hedera and Arc rails."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
