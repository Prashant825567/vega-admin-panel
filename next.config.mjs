/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The panel is a thin, private UI over its own API routes. Nothing here is
  // meant to be embedded anywhere, so it does not need frame or image hosts:
  // screenshots travel through /api/file, never straight from ZentraGrid.
  poweredByHeader: false,
};

export default nextConfig;
