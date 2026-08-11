import Image from "next/image";
import { getConfig } from "@/lib/config";
import { SignInForm } from "@/components/sign-in-form";

export default function SignInPage() {
  const config = getConfig();
  return (
    <main className="auth-page">
      <section className="auth-card auth-card-wide">
        <div className="auth-brand">
          <Image
            src="/brand/agentpay-lockup.png"
            alt="AgentPay"
            width={192}
            height={38}
            priority
          />
        </div>
        <h1>Operator sign in</h1>
        <p>Manage agent policies, approvals, and x402 payment operations across the configured Hedera and Arc rails. Hedera wallets are connected separately after sign-in when required.</p>
        <SignInForm googleEnabled={Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY)} />
      </section>
    </main>
  );
}
