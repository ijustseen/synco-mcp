declare const process: { env: Record<string, string | undefined> };

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL || "https://little-raven-61.eu-west-1.convex.site",
      applicationID: "convex",
    },
  ],
};
