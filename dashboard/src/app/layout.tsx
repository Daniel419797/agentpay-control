import type { Metadata } from "next";
import { Toaster } from "sonner";
import "@/app/globals.css";
import "@/app/sidebar.css";
import "@/app/accessibility.css";
import "@/app/marketing.css";
import "@/app/marketing-hero.css";
import "@/app/responsive.css";

export const metadata: Metadata = {
  title: { default: "AgentPay", template: "%s · AgentPay" },
  description: "Policy-controlled payments and financial operations for autonomous software across configured payment rails."
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
