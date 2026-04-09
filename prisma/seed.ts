import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { swedishSoleTraderDefaultAccounts } from "../lib/accounting/chartOfAccounts";
import { Jurisdictions } from "../lib/domain/enums";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.business.findFirst();
  if (existing) {
    console.log(`Business already exists: ${existing.name} (${existing.id})`);
    return;
  }

  const business = await prisma.business.create({
    data: {
      name: "My Sole Trader Business",
      orgType: "sole_trader",
      jurisdiction: Jurisdictions.SWEDEN,
      bookkeepingMethod: "kontantmetoden",
      vatRegistered: true,
      vatFrequency: "yearly",
      fiscalYearStart: new Date("2026-01-01T00:00:00.000Z"),
      baseCurrency: "SEK",
      locale: "en",
      invoiceNumberPattern: "INV-{YYYY}-{SEQ:4}",
      nextInvoiceSequence: 1,
      taxConfig: {
        create: {
          municipalTaxRate: 0.32,
          socialContributionRate: 0.2897,
          generalDeductionRate: 0.25,
          vatStandardRate: 0.25,
          vatReducedRateFood: 0.12,
          vatReducedRateCulture: 0.06
        }
      },
      accounts: {
        create: swedishSoleTraderDefaultAccounts.map((account) => ({
          code: account.code,
          name: account.name,
          type: account.type,
          vatCode: account.vatCode,
          isSystem: account.isSystem ?? false
        }))
      }
    }
  });

  console.log(`Seeded business ${business.name} (${business.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
