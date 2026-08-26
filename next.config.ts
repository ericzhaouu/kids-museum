import type { NextConfig } from "next";

function toOrigin(value: string | undefined) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const allowedConnectOrigins = [
  toOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL),
  toOrigin(process.env.OPENAI_BASE_URL),
].filter((value): value is string => Boolean(value));
const scriptSrc = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' ${allowedConnectOrigins.join(" ")}`.trim(),
      `img-src 'self' data: blob: ${allowedConnectOrigins.join(" ")}`.trim(),
      `media-src 'self' data: blob: ${allowedConnectOrigins.join(" ")}`.trim(),
      "font-src 'self' data:",
    ].join("; "),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
