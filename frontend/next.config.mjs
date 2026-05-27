/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/", destination: "/landing.html" },
      // Proxy Fhenix CoFHE testnet endpoints so they're served same-origin
      // (sidesteps CORS + COEP CORP requirements that block browser POSTs).
      { source: "/cofhe-proxy/main/:path*", destination: "https://testnet-cofhe.fhenix.zone/:path*" },
      { source: "/cofhe-proxy/vrf/:path*", destination: "https://testnet-cofhe-vrf.fhenix.zone/:path*" },
      { source: "/cofhe-proxy/tn/:path*", destination: "https://testnet-cofhe-tn.fhenix.zone/:path*" },
    ];
  },
  async headers() {
    // SharedArrayBuffer (required by cofhejs WASM) needs cross-origin isolation.
    // `credentialless` lets cross-origin resources (RainbowKit icons, etc) still load.
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/cofhe-proxy/(.*)",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      net: false,
      tls: false,
      path: false,
      crypto: false,
      stream: false,
      os: false,
      child_process: false,
    };
    return config;
  },
};

export default nextConfig;
