import { SplashLanding } from "@/components/public/SplashLanding";
import { getLatestBlogPosts } from "@/lib/content/blog";
import { getRequestLocale } from "@/lib/i18n/locale";

export default function LandingPage() {
  const latestPosts = getLatestBlogPosts(4);
  const locale = getRequestLocale();
  return <SplashLanding latestPosts={latestPosts} locale={locale} />;
}
