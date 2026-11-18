import type { NextConfig } from "next";

// In production the browser talks only to this Next.js server. Requests to /api/* are passed on
// to the API (which is never exposed itself), so the dashboard, the API and the widget share one
// address and the login cookie stays first-party. Set when building: BACKEND_INTERNAL_URL=http://api:8000
const backend = process.env.BACKEND_INTERNAL_URL;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  // Compression would hold back the streamed chat answers (Server-Sent Events) until a buffer fills.
  compress: false,
  experimental: {
    // Dashboard pages load their data in the browser after login (on purpose: the session is
    // checked by the API), so only validate instant navigation where a segment opts in.
    instantInsights: { validationLevel: "manual-warning" },
    // An agent turn with tools can be quiet for a while before streaming; the default is 30 s.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return backend ? [{ source: "/api/:path*", destination: `${backend}/api/:path*` }] : [];
  },
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      // The dashboard must never be framed (clickjacking); the widget script is loaded by other sites.
      { source: "/((?!widget\\.js).*)", headers: [...security, { key: "X-Frame-Options", value: "DENY" }] },
      { source: "/widget.js", headers: [...security, { key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
