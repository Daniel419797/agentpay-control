"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from "lucide-react";

type Notice = { kind: "error" | "success"; text: string } | null;

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function sendEmail(mode: "otp" | "magiclink") {
    if (!email) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/v1/auth/email", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, mode })
      });
      if (!response.ok) throw new Error("We could not send the email. Please try again.");
      if (mode === "otp") {
        setStep("otp");
        setNotice({ kind: "success", text: "Verification code sent. It expires shortly." });
      } else setNotice({ kind: "success", text: "Magic link sent. You can close this tab after opening it." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Sign-in email failed." });
    } finally { setBusy(false); }
  }

  function submitEmail(event: FormEvent) { event.preventDefault(); void sendEmail("otp"); }

  return (
    <div className="auth-options">
      <a className={`google-button${googleEnabled ? "" : " disabled"}`} href={googleEnabled ? "/api/v1/auth/oauth/google" : undefined} aria-disabled={!googleEnabled}>
        <span className="google-mark" aria-hidden="true">G</span>Continue with Google
      </a>
      <p className="auth-method-note">Fastest for judges and operators. No wallet required.</p>
      <div className="auth-divider"><span>or use email</span></div>

      {step === "email" ? (
        <form className="app-form auth-email-form" onSubmit={submitEmail}>
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required /></label>
          <button className="primary-button auth-action" type="submit" disabled={busy}><Mail size={16} />{busy ? "Sending…" : "Send 6-digit code"}</button>
          <button className="magic-link-button" type="button" disabled={busy || !email} onClick={() => void sendEmail("magiclink")}>Email me a sign-in link instead</button>
        </form>
      ) : (
        <form className="app-form auth-email-form" action="/api/v1/auth/otp/verify" method="post">
          <input type="hidden" name="email" value={email} />
          <div className="otp-heading"><ShieldCheck size={18} /><span>Enter the code sent to <strong>{email}</strong></span></div>
          <label>Verification code<input className="otp-input" type="text" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required autoFocus /></label>
          <button className="primary-button auth-action" type="submit">Verify and continue</button>
          <div className="auth-inline-actions">
            <button type="button" className="text-button" onClick={() => { setStep("email"); setNotice(null); }}><ArrowLeft size={14} />Change email</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => void sendEmail("otp")}>Resend code</button>
          </div>
        </form>
      )}

      {notice && <div className={`auth-notice ${notice.kind}`} role="status">{notice.kind === "success" && <CheckCircle2 size={16} />}{notice.text}</div>}
      <p className="auth-note">Wallet identity and transaction signing remain separate security layers. Connect HashPack after entering the console.</p>
    </div>
  );
}
