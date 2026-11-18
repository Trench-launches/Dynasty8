import path from "node:path";
import type { NextConfig } from "next";

// This app's own folder. Pinned because the parent folder holds an unrelated project with its own
// package-lock.json, which Next.js would otherwise consider when inferring the workspace root.
// Turbopack's root and the output file tracing root must be the same directory.
const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  // Cache Components ("use cache", partial prerendering) stays off: the Cloudflare adapter does not yet
  // run it reliably on Next 16.4 (opennextjs-cloudflare issues #1450, #1464). Pages render per request.
  // Prisma ships a separate build for Cloudflare Workers; keep it out of the Next bundle so both resolve.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
