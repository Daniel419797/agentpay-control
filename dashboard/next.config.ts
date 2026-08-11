import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  rewrites: async () => ({
    beforeFiles: [
      { source: "/api/v1/organization/export", destination: "/api/v1/organization/export-complete" },
      { source: "/api/v1/organization/export-stream", destination: "/api/v1/organization/export-complete" },
    ],
    afterFiles: [],
    fallback: [],
  }),
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src https://verify.walletconnect.com https://verify.walletconnect.org; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests" }
      ]
    }
  ]
};

export default nextConfig;
