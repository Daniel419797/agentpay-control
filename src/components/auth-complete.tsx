"use client";

import { useEffect, useState } from "react";

export function AuthComplete() {
  const [message, setMessage] = useState("Completing secure sign-in…");
  useEffect(() => {
    const accessToken = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
    if (!accessToken) {
      void Promise.resolve().then(() => setMessage("This sign-in link is invalid or expired."));
      return;
    }
    void fetch("/api/v1/auth/session", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken })
    }).then((response) => {
      if (!response.ok) throw new Error();
      window.location.replace(response.url.includes("/app/") ? response.url : "/app/overview");
    }).catch(() => setMessage("We could not complete sign-in. Request a new link."));
  }, []);
  return <main className="auth-page"><section className="auth-card auth-complete-card"><span className="auth-spinner" aria-hidden="true" /><h1>{message}</h1><a className="ghost-link" href="/sign-in">Return to sign in</a></section></main>;
}
