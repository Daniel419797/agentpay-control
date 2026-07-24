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
          {/* <span>Control</span> */}
        </div>
        <h1>Operator sign in</h1>
        <p>Manage agent policy, approvals, and Hedera settlements. A wallet is optional and connected separately after sign-in.</p>
        <SignInForm googleEnabled={Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY)} />
      </section>
    </main>
  );
}
