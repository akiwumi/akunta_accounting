import { SettingsForm } from "@/components/forms/SettingsForm";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { type Jurisdiction } from "@/lib/domain/enums";
import { getRequestLocale } from "@/lib/i18n/locale";

export default async function SettingsPage() {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Inställningar",
          subtitle: "Konfigurera standardvärden för skatteprognos och landslogik."
        }
      : {
          title: "Settings",
          subtitle: "Configure tax projection defaults and jurisdiction behavior."
        };

  const business = await ensureBusiness();
  const fresh = await prisma.business.findUnique({
    where: { id: business.id },
    include: { taxConfig: true }
  });

  if (!fresh) return null;

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <SectionExportBar locale={locale} section="settings" />

      <article className="card" id="business-settings">
        <div id="tax-config">
          <SettingsForm
            locale={locale}
            initial={{
              name: fresh.name,
              jurisdiction: fresh.jurisdiction as Jurisdiction,
              locale: fresh.locale,
              baseCurrency: fresh.baseCurrency,
              invoiceNumberPattern: fresh.invoiceNumberPattern,
              invoiceSenderName: fresh.invoiceSenderName ?? "",
              invoiceSenderAddress: fresh.invoiceSenderAddress ?? "",
              invoiceSenderOrgNumber: fresh.invoiceSenderOrgNumber ?? "",
              invoiceSenderEmail: fresh.invoiceSenderEmail ?? "",
              invoiceSenderPhone: fresh.invoiceSenderPhone ?? "",
              invoiceSenderWebsite: fresh.invoiceSenderWebsite ?? "",
              invoiceEmailFrom: fresh.invoiceEmailFrom ?? "",
              invoiceDefaultLogo: fresh.invoiceDefaultLogo ?? "",
              invoiceDefaultSignature: fresh.invoiceDefaultSignature ?? "",
              taxConfig: fresh.taxConfig
                ? {
                    municipalTaxRate: asNumber(fresh.taxConfig.municipalTaxRate as unknown as number | string),
                    socialContributionRate: asNumber(
                      fresh.taxConfig.socialContributionRate as unknown as number | string
                    ),
                    generalDeductionRate: asNumber(
                      fresh.taxConfig.generalDeductionRate as unknown as number | string
                    )
                  }
                : null
            }}
          />
        </div>
      </article>
    </section>
  );
}
