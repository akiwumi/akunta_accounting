import { SupportPageClient } from "@/components/public/SupportPageClient";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Support",
  description:
    "Contact Akunta support for help with bookkeeping, receipts, VAT reporting, invoicing, payroll, and account setup.",
  path: "/support"
});

export default function SupportPage() {
  return <SupportPageClient />;
}
