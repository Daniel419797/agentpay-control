"use client";

import { useEffect } from "react";

const HERO_ASSET_PARTS = Array.from(
  { length: 10 },
  (_, index) => `/marketing/hero-exact/part-${String(index).padStart(2, "0")}.txt`,
);

export function MarketingHeroAssetHydrator() {
  useEffect(() => {
    let cancelled = false;

    void Promise.all(
      HERO_ASSET_PARTS.map(async (path) => {
        const response = await fetch(path, { cache: "force-cache" });
        if (!response.ok) throw new Error("HERO_ASSET_UNAVAILABLE");
        return response.text();
      }),
    )
      .then((parts) => {
        if (cancelled) return;
        const encoded = parts.join("").replace(/\s+/g, "");
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
