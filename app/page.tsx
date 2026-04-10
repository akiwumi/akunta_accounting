import { cookies } from "next/headers";

import { SplashLanding } from "@/components/public/SplashLanding";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { getLatestBlogPosts } from "@/lib/content/blog";
import { getRequestLocale } from "@/lib/i18n/locale";
import { buildPageMetadata, getOrganizationJsonLd, getSoftwareApplicationJsonLd, jsonLd } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Bookkeeping software for Swedish sole traders",
  description:
    "Akunta helps Swedish sole traders handle receipts, invoicing, VAT, payroll, and bookkeeping reports in one app.",
  path: "/"
});

export default function LandingPage() {
  const latestPosts = getLatestBlogPosts(4);
  const locale = getRequestLocale();
  const isLoggedIn = Boolean(cookies().get(AUTH_COOKIE_NAME)?.value);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(getOrganizationJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(getSoftwareApplicationJsonLd()) }}
      />
      <SplashLanding latestPosts={latestPosts} locale={locale} isLoggedIn={isLoggedIn} />
    </>
  );
}
