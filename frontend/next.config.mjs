/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/", destination: "/landing.html" },
      { source: "/landing", destination: "/landing.html" },
    ];
  },
  async headers() {
    // SharedArrayBuffer (required by @cofhe/sdk WASM) needs cross-origin isolation.
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
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@x402/evm/upto/client": false,
      "@x402/evm": false,
      "@coinbase/cdp-sdk": false,
      "@react-native-async-storage/async-storage": false,
    };
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
