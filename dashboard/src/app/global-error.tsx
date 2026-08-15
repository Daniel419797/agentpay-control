"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("AgentPay global error", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#eef0f8", color: "#111a2b" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, boxSizing: "border-box" }}>
          <section role="alert" style={{ width: "min(560px, 100%)", padding: 32, boxSizing: "border-box", border: "1px solid #d8deea", borderRadius: 18, background: "#fff", textAlign: "center", boxShadow: "0 18px 50px rgba(25,36,70,.08)" }}>
            <img src="/brand/agentpay-lockup.png" alt="AgentPay" style={{ width: 160, maxWidth: "55%", height: "auto", marginBottom: 32 }} />
            <div style={{ width: 68, height: 68, margin: "0 auto 20px", border: "1px solid #d8deea", borderRadius: 18, display: "grid", placeItems: "center", color: "#2539a8", fontSize: 30 }}>!</div>
            <p style={{ margin: "0 0 10px", color: "#2539a8", fontSize: 12, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>Application error</p>
            <h1 style={{ margin: 0, fontSize: "clamp(30px, 7vw, 46px)", lineHeight: 1.05, letterSpacing: "-.04em" }}>AgentPay could not start correctly.</h1>
            <p style={{ margin: "18px auto 0", maxWidth: 440, color: "#657287", fontSize: 14, lineHeight: 1.65 }}>Retry the application. If the issue continues, return later rather than repeating a financial action whose state is uncertain.</p>
            <button type="button" onClick={reset} style={{ minHeight: 44, marginTop: 26, padding: "0 20px", border: 0, borderRadius: 999, background: "#2539a8", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Retry AgentPay</button>
            {error.digest && <div style={{ marginTop: 18, color: "#9299a8", fontSize: 10 }}>Reference: {error.digest}</div>}
          </section>
        </main>
      </body>
    </html>
  );
}
