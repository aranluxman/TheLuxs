import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The whole dashboard talks to Supabase straight from the browser, so there
  // is nothing to run on a server. A static export drops onto Cloudflare Pages
  // as plain files.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
