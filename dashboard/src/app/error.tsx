"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("AgentPay route error", error);
  }, [error]);

  return (
    <div className="route-state-page">
      <section className="route-state-shell" role="alert">
        <Image className="route-state-brand" src="/brand/agentpay-lockup.png" alt="AgentPay" width={168} height={35} priority />
        <div className="route-state-symbol"><AlertTriangle size={31} aria-hidden="true" /></div>
        <p className="route-state-code">Something went wrong</p>
        <h1>AgentPay could not load this page.</h1>
        <p className="route-state-copy">The request did not complete successfully. You can retry the page or return to the AgentPay home page.</p>
        <div className="route-state-actions">
          <button className="route-state-primary" type="button" onClick={reset}><RefreshCcw size={15} aria-hidden="true" />Try again</button>
          <Link className="route-state-secondary" href="/">Back to home</Link>
        </div>
        {error.digest && <div className="route-state-digest">Reference: {error.digest}</div>}
      </section>
    </div>
  );
}
