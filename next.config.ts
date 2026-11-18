import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Cache Components ("use cache", partial prerendering) stays off: the Cloudflare adapter does not yet
  // run it reliably on Next 16.4 (opennextjs-cloudflare issues #1450, #1464). Pages render per request.
  // Prisma ships a separate build for Cloudflare Workers; keep it out of the Next bundle so both resolve.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
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
