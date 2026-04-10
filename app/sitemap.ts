import type { MetadataRoute } from "next";

import { blogPosts } from "@/lib/content/blog";
import { helpArticles } from "@/lib/content/help";
import { absoluteUrl } from "@/lib/seo";

const now = new Date();

const publicRoutes: Array<{
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  lastModified?: Date;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
  { path: "/help", changeFrequency: "weekly", priority: 0.8 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.8 },
  { path: "/resources", changeFrequency: "monthly", priority: 0.7 },
  { path: "/support", changeFrequency: "monthly", priority: 0.7 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 }
];

export default function sitemap(): MetadataRoute.Sitemap {
  const routeEntries = publicRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: route.lastModified ?? now,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));

  const blogEntries = blogPosts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.date),
    changeFrequency: "monthly" as const,
    priority: 0.7
  }));

  const helpEntries = helpArticles.map((article) => ({
    url: absoluteUrl(`/help/${article.slug}`),
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6
  }));

  return [...routeEntries, ...blogEntries, ...helpEntries];
}
