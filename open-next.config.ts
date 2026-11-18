import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Pages render per request and nothing uses Next's incremental cache yet, so no R2/KV cache is set up.
export default defineCloudflareConfig({});
