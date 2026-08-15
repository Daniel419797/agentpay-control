import Image from "next/image";
import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="route-state-page">
      <section className="route-state-shell">
        <Image className="route-state-brand" src="/brand/agentpay-lockup.png" alt="AgentPay" width={168} height={35} priority />
        <div className="route-state-symbol"><SearchX size={31} aria-hidden="true" /></div>
        <p className="route-state-code">404 · Page not found</p>
        <h1>This page is not part of AgentPay.</h1>
        <p className="route-state-copy">The address may be incorrect, or the page may have moved. Return to the site or open the payment operations dashboard.</p>
        <div className="route-state-actions">
          <Link className="route-state-primary" href="/">Go to home</Link>
          <Link className="route-state-secondary" href="/sign-in">Open AgentPay</Link>
        </div>
      </section>
    </div>
  );
}
