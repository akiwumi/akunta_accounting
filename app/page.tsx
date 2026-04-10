import { cookies } from "next/headers";

import { SplashLanding } from "@/components/public/SplashLanding";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { getLatestBlogPosts } from "@/lib/content/blog";
import { getRequestLocale } from "@/lib/i18n/locale";

export default function LandingPage() {
  const latestPosts = getLatestBlogPosts(4);
  const locale = getRequestLocale();
  const isLoggedIn = Boolean(cookies().get(AUTH_COOKIE_NAME)?.value);
  return <SplashLanding latestPosts={latestPosts} locale={locale} isLoggedIn={isLoggedIn} />;
}
