import type { Metadata } from "next";

const DEFAULT_SITE_URL = "https://akuntaaccounts.com";

export const siteConfig = {
  name: "Akunta",
  description:
    "Bookkeeping software for Swedish sole traders with receipts, invoices, VAT, payroll, reports, and compliance in one workspace.",
  keywords: [
    "Akunta",
    "bookkeeping software Sweden",
    "accounting software Sweden",
    "sole trader accounting Sweden",
    "enskild firma bokforing",
    "VAT reporting Sweden",
    "Swedish payroll software",
    "receipt OCR accounting",
    "invoice software Sweden"
  ],
  ogImage: {
    path: "/akunta_logo.png",
    width: 610,
    height: 614,
    alt: "Akunta bookkeeping software"
  }
} as const;

function normalizeSiteUrl(value?: string): string {
  const candidate = value?.trim() || DEFAULT_SITE_URL;

  try {
    return new URL(candidate).origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export const siteUrl = normalizeSiteUrl(process.env.NEXT_PUBLIC_APP_URL);
export const metadataBase = new URL(siteUrl);

export function absoluteUrl(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, metadataBase).toString();
}

type PageMetadataOptions = {
  title?: string;
  description?: string;
  path?: string;
  keywords?: readonly string[];
  noIndex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  section?: string;
  authors?: string[];
};

export function buildPageMetadata({
  title,
  description = siteConfig.description,
  path = "/",
  keywords = siteConfig.keywords,
  noIndex = false,
  type = "website",
  publishedTime,
  modifiedTime,
  section,
  authors
}: PageMetadataOptions = {}): Metadata {
  const canonicalPath = path === "/" ? "/" : path.replace(/\/+$/, "") || "/";
  const fullTitle = title ? `${title} | ${siteConfig.name}` : siteConfig.name;
  const robots = noIndex
    ? {
        index: false,
        follow: false,
        nocache: true,
        googleBot: {
          index: false,
          follow: false,
          noimageindex: true,
          "max-image-preview": "none" as const,
          "max-snippet": -1,
          "max-video-preview": -1
        }
      }
    : {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-image-preview": "large" as const,
          "max-snippet": -1,
          "max-video-preview": -1
        }
      };

  const openGraph =
    type === "article"
      ? {
          type: "article" as const,
          title: fullTitle,
          description,
          url: absoluteUrl(canonicalPath),
          siteName: siteConfig.name,
          images: [
            {
              url: absoluteUrl(siteConfig.ogImage.path),
              width: siteConfig.ogImage.width,
              height: siteConfig.ogImage.height,
              alt: siteConfig.ogImage.alt
            }
          ],
          publishedTime,
          modifiedTime,
          section,
          authors
        }
      : {
          type: "website" as const,
          title: fullTitle,
          description,
          url: absoluteUrl(canonicalPath),
          siteName: siteConfig.name,
          images: [
            {
              url: absoluteUrl(siteConfig.ogImage.path),
              width: siteConfig.ogImage.width,
              height: siteConfig.ogImage.height,
              alt: siteConfig.ogImage.alt
            }
          ]
        };

  return {
    metadataBase,
    title: fullTitle,
    description,
    applicationName: siteConfig.name,
    keywords: [...keywords],
    alternates: {
      canonical: canonicalPath
    },
    authors: [{ name: siteConfig.name }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    robots,
    openGraph,
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [absoluteUrl(siteConfig.ogImage.path)]
    }
  };
}

export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

export function getOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: siteUrl,
    logo: absoluteUrl(siteConfig.ogImage.path),
    email: "support@akunta.se"
  };
}

export function getSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: siteConfig.description,
    url: siteUrl,
    image: absoluteUrl(siteConfig.ogImage.path),
    offers: {
      "@type": "Offer",
      price: "125",
      priceCurrency: "SEK"
    },
    areaServed: "SE"
  };
}
