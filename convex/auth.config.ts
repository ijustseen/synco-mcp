declare const process: { env: Record<string, string | undefined> };

// JWT issuer is CONVEX_SITE_URL (*.convex.site). SITE_URL is the website origin
// (https://synco-mcp-demo.vercel.app) and is set on the deployment, not here.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL || "https://little-raven-61.eu-west-1.convex.site",
      applicationID: "convex",
    },
  ],
};
