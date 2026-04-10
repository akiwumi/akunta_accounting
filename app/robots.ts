import type { MetadataRoute } from "next";

import { absoluteUrl, siteUrl } from "@/lib/seo";

const disallow = [
  "/api/",
  "/dashboard",
  "/receipts",
  "/invoices",
  "/imports",
  "/transactions",
  "/ledger",
  "/review",
  "/reports",
  "/settings",
  "/assets",
  "/audit",
  "/compliance",
  "/mileage",
  "/salaries",
  "/periodiseringsfond",
  "/welcome",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password"
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl
  };
}
