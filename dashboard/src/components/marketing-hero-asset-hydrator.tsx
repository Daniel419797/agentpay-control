"use client";

import { useEffect } from "react";

const HERO_ASSET_PATH = "/marketing/agentpay-hero-dashboard.webp";

export function MarketingHeroAssetHydrator() {
  useEffect(() => {
    let cancelled = false;

    void fetch(HERO_ASSET_PATH, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("HERO_ASSET_UNAVAILABLE");
        return response.text();
      })
      .then((payload) => {
        if (cancelled) return;
        const encoded = payload.trim();
        if (!encoded.startsWith("UklG")) throw new Error("HERO_ASSET_INVALID");

        document.documentElement.style.setProperty(
          "--agentpay-hero-image",
          `url("data:image/webp;base64,${encoded}")`,
        );
        document.documentElement.dataset.agentpayHeroReady = "true";
      })
      .catch(() => {
        if (!cancelled) document.documentElement.dataset.agentpayHeroReady = "error";
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
