import { PricingPageClient } from "@/components/public/PricingPageClient";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "See Akunta pricing for Swedish sole traders. One subscription includes receipts, invoicing, VAT, payroll, reports, and compliance tools.",
  path: "/pricing"
});

export default function PricingPage() {
  return <PricingPageClient />;
}
