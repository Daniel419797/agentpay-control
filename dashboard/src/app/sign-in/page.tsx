import Image from "next/image";
import { getConfig } from "@/lib/config";
import { SignInForm } from "@/components/sign-in-form";

const signInErrors: Record<string, string> = {
  auth_config: "Sign-in is not fully configured for this deployment. Check the Supabase authentication settings and try again.",
  database_busy: "The AgentPay database is temporarily at its connection limit. Please try signing in again in a moment.",
  google_failed: "Google sign-in could not be completed. Please retry or use email sign-in instead.",
  oauth_state: "The sign-in session expired or could not be verified. Start the Google sign-in flow again.",
  sign_in_failed: "Sign-in could not be completed. Please retry or use email sign-in instead.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const config = getConfig();
  const { error } = await searchParams;
  const message = error ? signInErrors[error] ?? signInErrors.sign_in_failed : null;

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
        <p>Manage agent policies, approvals, and x402 payment operations across the configured payment rails. Wallets are connected separately after sign-in when required.</p>
        {message && <div className="auth-notice error" role="alert">{message}</div>}
        <SignInForm googleEnabled={Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY)} />
      </section>
    </main>
  );
}
