/**
 * The plain-language situations of the guided journal entry, in Swedish and
 * English. Each maps to a template in lib/accounting/journalTemplates.ts.
 */

export type SituationId =
  | "owner_withdrawal"
  | "owner_deposit"
  | "transfer"
  | "bank_fee"
  | "interest_received"
  | "interest_paid"
  | "loan_taken"
  | "loan_repayment"
  | "vat_paid"
  | "vat_refund"
  | "tax_payment"
  | "depreciation"
  | "year_end_receivables"
  | "year_end_payables";

export type SituationTemplate =
  | "owner_withdrawal"
  | "owner_deposit"
  | "transfer"
  | "bank_fee"
  | "interest_received"
  | "interest_paid"
  | "loan_taken"
  | "loan_repayment"
  | "vat_settlement"
  | "tax_payment"
  | "depreciation"
  | "year_end_receivables"
  | "year_end_payables";

export type Situation = {
  id: SituationId;
  template: SituationTemplate;
  /** What happened, in the user's words. */
  title: string;
  /** When to use it, with the bookkeeping term explained. */
  blurb: string;
  /** What the entry means for the business, shown with the preview. */
  effect: string;
};

export type SituationGroup = { id: string; title: string; situations: Situation[] };

const sv: SituationGroup[] = [
  {
    id: "own",
    title: "Dina egna pengar",
    situations: [
      {
        id: "owner_withdrawal",
        template: "owner_withdrawal",
        title: "Jag tog ut pengar till mig själv",
        blurb:
          "Eget uttag: pengar som du flyttar från företagskontot till dig privat. Det är så du tar ut lön i en enskild firma.",
        effect:
          "Uttaget är inte en kostnad och ändrar inte firmans resultat. Du skattar på firmans vinst, inte på det du tar ut. Bankkontot och ditt egna kapital i firman minskar lika mycket."
      },
      {
        id: "owner_deposit",
        template: "owner_deposit",
        title: "Jag satte in egna pengar",
        blurb: "Egen insättning: privata pengar som du sätter in på företagskontot.",
        effect:
          "Insättningen är inte en intäkt och du betalar ingen skatt på den. Bankkontot och ditt egna kapital i firman ökar lika mycket."
      },
      {
        id: "transfer",
        template: "transfer",
        title: "Jag flyttade pengar mellan mina konton",
        blurb: "Till exempel från företagskontot till firmans sparkonto, eller kontanter som du sätter in på banken.",
        effect: "Pengarna byter bara plats. Resultatet och ditt kapital i firman påverkas inte."
      }
    ]
  },
  {
    id: "bank",
    title: "Bank och lån",
    situations: [
      {
        id: "bank_fee",
        template: "bank_fee",
        title: "Banken tog en avgift",
        blurb: "Månadsavgift, kortavgift eller annan avgift som banken drar från kontot. Bankavgifter har ingen moms.",
        effect: "Avgiften blir en kostnad i firman och sänker resultatet."
      },
      {
        id: "interest_received",
        template: "interest_received",
        title: "Jag fick ränta",
        blurb: "Ränta som banken betalar in på företagskontot.",
        effect: "Räntan blir en intäkt i firman och höjer resultatet."
      },
      {
        id: "interest_paid",
        template: "interest_paid",
        title: "Jag betalade ränta",
        blurb:
          "Ränta på firmans lån eller kredit som dras från kontot. Betalade du amortering samtidigt, välj Jag betalade på ett lån. Ränta på skattekontot får inte dras av: bokför den som skatt från företagskontot.",
        effect: "Räntan blir en kostnad i firman och sänker resultatet."
      },
      {
        id: "loan_taken",
        template: "loan_taken",
        title: "Jag tog ett lån",
        blurb: "Ett lån till firman som betalas ut till företagskontot.",
        effect: "Lånet är inte en intäkt. Bankkontot ökar och firman får en skuld på samma belopp."
      },
      {
        id: "loan_repayment",
        template: "loan_repayment",
        title: "Jag betalade på ett lån",
        blurb:
          "Amortering är den del av betalningen som minskar skulden. Amortering och ränta står var för sig på bankens avi.",
        effect:
          "Amorteringen minskar skulden och är inte en kostnad. Räntan och avgiften är kostnader och sänker resultatet."
      }
    ]
  },
  {
    id: "tax",
    title: "Skatt och moms",
    situations: [
      {
        id: "vat_paid",
        template: "vat_settlement",
        title: "Jag betalade moms till Skatteverket",
        blurb:
          "När momsdeklarationen är inlämnad och du har betalat momsen. Momskontona töms för perioden och betalningen bokförs mot dem.",
        effect:
          "Momsen du betalar är inte en kostnad. Skulden till Skatteverket som har samlats på momskontona försvinner och bankkontot minskar."
      },
      {
        id: "vat_refund",
        template: "vat_settlement",
        title: "Jag fick tillbaka moms",
        blurb: "När Skatteverket har betalat ut moms till företagskontot, för en period där du hade mer moms att dra av än att betala.",
        effect:
          "Momsen du får tillbaka är inte en intäkt. Din fordran på Skatteverket försvinner och bankkontot ökar."
      },
      {
        id: "tax_payment",
        template: "tax_payment",
        title: "Jag betalade skatt från företagskontot",
        blurb:
          "Preliminärskatt (F-skatt), kvarskatt eller andra egna skatter som du betalar in till skattekontot från företagskontot.",
        effect:
          "I en enskild firma är inkomstskatt och egenavgifter dina egna, privata skatter. De är aldrig en kostnad i firman. Betalningen bokförs därför som ett eget uttag och sänker inte resultatet."
      }
    ]
  },
  {
    id: "yearEnd",
    title: "Bokslut",
    situations: [
      {
        id: "depreciation",
        template: "depreciation",
        title: "Bokför årets avskrivningar",
        blurb:
          "Avskrivning är värdeminskningen på inventarier som du har köpt, fördelad över flera år. Den bokförs en gång per år, den 31 december.",
        effect:
          "Avskrivningen blir en kostnad i år och sänker resultatet. Inventariernas bokförda värde minskar lika mycket. Inga pengar lämnar kontot."
      },
      {
        id: "year_end_receivables",
        template: "year_end_receivables",
        title: "Kundfakturor som var obetalda 31 december",
        blurb:
          "Med kontantmetoden bokför du när pengarna kommer in. Vid årets slut finns ett undantag: fakturor som du har skickat men inte fått betalt för ska ändå med i årets bokföring, med momsen.",
        effect:
          "Försäljningen och momsen hamnar i det år då du fakturerade. Den 1 januari vänds posten tillbaka, så att betalningen kan bokföras som vanligt när den kommer utan att räknas två gånger."
      },
      {
        id: "year_end_payables",
        template: "year_end_payables",
        title: "Leverantörsfakturor som var obetalda 31 december",
        blurb:
          "Fakturor som du har fått men inte hade betalat vid årets slut ska med i årets bokföring, med momsen. Det gäller även om du använder kontantmetoden.",
        effect:
          "Kostnaden och momsavdraget hamnar i det år fakturan gäller. Den 1 januari vänds posten tillbaka, så att betalningen kan bokföras som vanligt när du betalar."
      }
    ]
  }
];

const en: SituationGroup[] = [
  {
    id: "own",
    title: "Your own money",
    situations: [
      {
        id: "owner_withdrawal",
        template: "owner_withdrawal",
        title: "I took money out for myself",
        blurb:
          "Owner withdrawal (eget uttag): money you move from the business account to yourself. This is how a sole trader takes out pay.",
        effect:
          "The withdrawal is not a cost and does not change the result. You pay tax on the profit of the business, not on what you take out. The bank account and your own capital in the business go down by the same amount."
      },
      {
        id: "owner_deposit",
        template: "owner_deposit",
        title: "I put my own money in",
        blurb: "Owner deposit (egen insättning): private money you put into the business account.",
        effect:
          "The deposit is not income and you pay no tax on it. The bank account and your own capital in the business go up by the same amount."
      },
      {
        id: "transfer",
        template: "transfer",
        title: "I moved money between my own accounts",
        blurb: "For example from the business account to the business savings account, or cash you pay into the bank.",
        effect: "The money only changes place. The result and your capital in the business are not affected."
      }
    ]
  },
  {
    id: "bank",
    title: "Bank and loans",
    situations: [
      {
        id: "bank_fee",
        template: "bank_fee",
        title: "The bank charged a fee",
        blurb: "A monthly fee, card fee or other charge the bank takes from the account. Bank fees carry no VAT.",
        effect: "The fee becomes a cost in the business and lowers the result."
      },
      {
        id: "interest_received",
        template: "interest_received",
        title: "I received interest",
        blurb: "Interest the bank pays into the business account.",
        effect: "The interest becomes income in the business and raises the result."
      },
      {
        id: "interest_paid",
        template: "interest_paid",
        title: "I paid interest",
        blurb:
          "Interest on a business loan or credit taken from the account. If you repaid part of the loan at the same time, choose I paid on a loan. Interest on the tax account (skattekonto) is not deductible: book it as tax paid from the business account.",
        effect: "The interest becomes a cost in the business and lowers the result."
      },
      {
        id: "loan_taken",
        template: "loan_taken",
        title: "I took a loan",
        blurb: "A loan to the business that is paid out to the business account.",
        effect: "The loan is not income. The bank account goes up and the business gets a debt of the same amount."
      },
      {
        id: "loan_repayment",
        template: "loan_repayment",
        title: "I paid on a loan",
        blurb:
          "Repayment (amortering) is the part of the payment that reduces the debt. The bank's notice shows repayment and interest separately.",
        effect:
          "The repayment reduces the debt and is not a cost. The interest and the fee are costs and lower the result."
      }
    ]
  },
  {
    id: "tax",
    title: "Tax and VAT",
    situations: [
      {
        id: "vat_paid",
        template: "vat_settlement",
        title: "I paid VAT to Skatteverket",
        blurb:
          "When the VAT return is filed and you have paid the VAT. The VAT accounts are emptied for the period and the payment is booked against them.",
        effect:
          "The VAT you pay is not a cost. The debt to Skatteverket that has built up on the VAT accounts disappears and the bank account goes down."
      },
      {
        id: "vat_refund",
        template: "vat_settlement",
        title: "I got VAT back",
        blurb: "When Skatteverket has paid VAT out to the business account, for a period where you had more VAT to deduct than to pay.",
        effect:
          "The VAT you get back is not income. Your claim on Skatteverket disappears and the bank account goes up."
      },
      {
        id: "tax_payment",
        template: "tax_payment",
        title: "I paid tax from the business account",
        blurb:
          "Preliminary tax (F-skatt), back tax or other taxes of your own that you pay to the tax account from the business account.",
        effect:
          "For a sole trader, income tax and social contributions (egenavgifter) are your own, private taxes. They are never a cost in the business. The payment is therefore booked as an owner withdrawal and does not lower the result."
      }
    ]
  },
  {
    id: "yearEnd",
    title: "Year end",
    situations: [
      {
        id: "depreciation",
        template: "depreciation",
        title: "Book the year's depreciation",
        blurb:
          "Depreciation (avskrivning) is the loss of value on equipment you have bought, spread over several years. It is booked once a year, on 31 December.",
        effect:
          "The depreciation becomes a cost this year and lowers the result. The book value of the equipment goes down by the same amount. No money leaves the account."
      },
      {
        id: "year_end_receivables",
        template: "year_end_receivables",
        title: "Customer invoices unpaid on 31 December",
        blurb:
          "With the cash method (kontantmetoden) you book when the money arrives. The year end is the exception: invoices you have sent but not been paid for must still be in the year's books, with their VAT.",
        effect:
          "The sale and the VAT land in the year you invoiced. On 1 January the entry is turned back, so the payment can be booked as usual when it arrives without being counted twice."
      },
      {
        id: "year_end_payables",
        template: "year_end_payables",
        title: "Supplier bills unpaid on 31 December",
        blurb:
          "Bills you have received but had not paid at the end of the year must be in the year's books, with their VAT. This applies under the cash method (kontantmetoden) too.",
        effect:
          "The cost and the VAT deduction land in the year the bill belongs to. On 1 January the entry is turned back, so the payment can be booked as usual when you pay."
      }
    ]
  }
];

export const situationGroups = (swedish: boolean): SituationGroup[] => (swedish ? sv : en);
