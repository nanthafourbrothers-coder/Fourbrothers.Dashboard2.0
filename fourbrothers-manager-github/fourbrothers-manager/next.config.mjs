/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // pdfjs-dist and exceljs reference node-only modules that are not needed in the browser
    config.resolve.alias = { ...config.resolve.alias, canvas: false, encoding: false };
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, stream: false };
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
