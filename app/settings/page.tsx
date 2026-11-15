export const dynamic = "force-dynamic";

import { SettingsForm } from "@/components/forms/SettingsForm";
import { ChangePasswordForm } from "@/components/forms/ChangePasswordForm";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { ReceiptInboxCard } from "@/components/settings/ReceiptInboxCard";
import { TeamCard } from "@/components/team/TeamCard";
import { asNumber } from "@/lib/accounting/math";
import { listPendingInvitations } from "@/lib/auth/invitations";
import { listMembers } from "@/lib/auth/members";
import { ensureBusiness, getBusinessAccess } from "@/lib/data/business";
import { mergeBusinessWithLocalSettings, readLocalSettings } from "@/lib/data/localSettings";
import { getFiscalYearStartMonth } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { type Jurisdiction } from "@/lib/domain/enums";
import { isEmailConfigured } from "@/lib/email/send";
import { getRequestLocale } from "@/lib/i18n/locale";
import { isReceiptInboxConfigured, receiptInboxAddress } from "@/lib/receipts/inbox";

export default async function SettingsPage() {
  const locale = await getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Inställningar",
          subtitle: "Konfigurera registreringsuppgifter, bokföringsmetod, moms och skatteprognosnivåer."
        }
      : {
          title: "Settings",
          subtitle: "Configure registration details, bookkeeping method, VAT settings and tax projection rates."
        };

  const business = await ensureBusiness();
  const fresh = await prisma.business.findUnique({
    where: { id: business.id },
    include: { taxConfig: true }
  });
  if (!fresh) return null;
  const localSettings = await readLocalSettings();
  const effective = mergeBusinessWithLocalSettings(fresh, localSettings);

  // Team card: everyone sees who has access; invitations are for the owner.
  const access = await getBusinessAccess();
  const [members, invitations] = await Promise.all([
    listMembers(access.businessId),
    access.isOwner ? listPendingInvitations(access.businessId) : Promise.resolve([])
  ]);

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
              name: effective.name,
              jurisdiction: effective.jurisdiction as Jurisdiction,
              locale: effective.locale,
              baseCurrency: effective.baseCurrency,
              bookkeepingMethod: effective.bookkeepingMethod,
              vatRegistered: effective.vatRegistered,
              vatFrequency: effective.vatFrequency,
              fiscalYearStartMonth: getFiscalYearStartMonth(effective.fiscalYearStart),
              sniCode: (effective as { sniCode?: string | null }).sniCode ?? "",
              vatNumber: (effective as { vatNumber?: string | null }).vatNumber ?? "",
              fSkattRegistered: (effective as { fSkattRegistered?: boolean }).fSkattRegistered ?? true,
              personnummer: (effective as { personnummer?: string | null }).personnummer ?? "",
              invoiceNumberPattern: effective.invoiceNumberPattern,
              invoiceSenderName: effective.invoiceSenderName ?? "",
              invoiceSenderAddress: effective.invoiceSenderAddress ?? "",
              invoiceSenderOrgNumber: effective.invoiceSenderOrgNumber ?? "",
              invoiceSenderEmail: effective.invoiceSenderEmail ?? "",
              invoiceSenderPhone: effective.invoiceSenderPhone ?? "",
              invoiceSenderWebsite: effective.invoiceSenderWebsite ?? "",
              invoiceEmailFrom: effective.invoiceEmailFrom ?? "",
              invoiceDefaultLogo: effective.invoiceDefaultLogo ?? "",
              invoiceDefaultSignature: effective.invoiceDefaultSignature ?? "",
              taxConfig: effective.taxConfig
                ? {
                    municipalTaxRate: asNumber(effective.taxConfig.municipalTaxRate as unknown as number | string),
                    socialContributionRate: asNumber(
                      effective.taxConfig.socialContributionRate as unknown as number | string
                    ),
                    generalDeductionRate: asNumber(
                      effective.taxConfig.generalDeductionRate as unknown as number | string
                    )
                  }
                : null
            }}
          />
        </div>
      </article>

      <article className="card" id="receipt-inbox">
        <ReceiptInboxCard
          locale={locale}
          initialAddress={receiptInboxAddress(fresh.receiptInboxToken)}
          available={isReceiptInboxConfigured()}
        />
      </article>

      <article className="card" id="team">
        <TeamCard
          locale={locale}
          role={access.role}
          currentUserId={access.userId}
          businessName={fresh.name}
          initialMembers={members.map((m) => ({ ...m, since: m.since.toISOString() }))}
          initialInvitations={invitations.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            expiresAt: i.expiresAt.toISOString(),
            expired: i.expired
          }))}
          emailAvailable={isEmailConfigured() || process.env.NODE_ENV !== "production"}
        />
      </article>

      <article className="card" id="security">
        <ChangePasswordForm locale={locale} />
      </article>
    </section>
  );
}
