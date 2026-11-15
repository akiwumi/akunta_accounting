/**
 * Labels and plain-language explanations for the boxes of the NE-bilaga.
 * Swedish labels follow the form (SKV 2161); the explanations summarise
 * Skatteverket's guidance at https://www.skatteverket.se/fyllainebilagan
 */

import type { NeWarning } from "@/lib/tax/neBilaga";

type Lang = "sv" | "en";
type BoxText = { label: string; help: string };

const sv: Record<string, BoxText> = {
  B1: { label: "Immateriella anläggningstillgångar", help: "Till exempel köpt goodwill, patent och licenser." },
  B2: { label: "Byggnader och markanläggningar", help: "Bokfört värde på byggnader och markanläggningar i verksamheten." },
  B3: { label: "Mark och andra tillgångar som inte får skrivas av", help: "Mark och annat som inte minskar i värde skattemässigt." },
  B4: { label: "Maskiner och inventarier", help: "Bokfört värde på inventarier, datorer, bilar och maskiner efter avskrivningar." },
  B5: { label: "Övriga anläggningstillgångar", help: "Till exempel andelar som hör till verksamheten." },
  B6: { label: "Varulager", help: "Värdet på varor du har kvar att sälja vid årets slut." },
  B7: { label: "Kundfordringar", help: "Fakturor som kunderna ännu inte har betalat vid årets slut." },
  B8: { label: "Övriga fordringar", help: "Andra pengar du har att få, till exempel moms att få tillbaka." },
  B9: { label: "Kassa och bank", help: "Pengar på företagskontot och i kassan vid årets slut." },
  B10: { label: "Eget kapital", help: "Tillgångar minus skulder. Beloppet räknas fram av de andra rutorna." },
  B11: { label: "Obeskattade reserver", help: "Används inte när du gör förenklat årsbokslut. Periodiseringsfond anges i R32 och R34, inte här." },
  B12: { label: "Avsättningar", help: "Används inte när du gör förenklat årsbokslut." },
  B13: { label: "Låneskulder", help: "Banklån och andra lån i verksamheten." },
  B14: { label: "Skatteskulder", help: "Moms och andra skatter som verksamheten är skyldig vid årets slut." },
  B15: { label: "Leverantörsskulder", help: "Fakturor från leverantörer som du ännu inte har betalat vid årets slut." },
  B16: { label: "Övriga skulder", help: "Andra skulder som inte passar i rutorna ovan." },
  R1: { label: "Försäljning och utfört arbete samt övriga momspliktiga intäkter", help: "Det du har sålt under året, utan moms." },
  R2: { label: "Momsfria intäkter", help: "Intäkter utan moms, till exempel bidrag, försäkringsersättning och momsfri försäljning." },
  R3: { label: "Bil- och bostadsförmån m.m.", help: "Värdet av att du privat har använt företagets bil eller bostad. Hämtas från konto 32xx." },
  R4: { label: "Ränteintäkter m.m.", help: "Ränta på företagskontot och liknande." },
  R5: { label: "Varor, material och tjänster", help: "Inköp av varor, material och underleverantörer." },
  R6: { label: "Övriga externa kostnader", help: "Hyra, telefon, program, resor, försäkringar och andra löpande kostnader." },
  R7: { label: "Anställd personal", help: "Löner och avgifter för anställda. Dina egna uttag räknas inte hit." },
  R8: { label: "Räntekostnader m.m.", help: "Ränta på lån och andra finansiella kostnader." },
  R9: { label: "Avskrivningar och nedskrivningar byggnader och markanläggningar", help: "Bokförda avskrivningar på byggnader." },
  R10: { label: "Avskrivningar och nedskrivningar maskiner och inventarier och immateriella tillgångar", help: "Bokförda avskrivningar på inventarier." },
  R11: { label: "Bokfört resultat", help: "Intäkter (R1 till R4) minus kostnader (R5 till R10). Samma siffra som resultatrapporten." },
  R12: { label: "Bokfört resultat", help: "Förs över från R11." },
  R13: { label: "Bokförda kostnader som inte ska dras av", help: "Kostnader du har bokfört men inte får dra av, till exempel representation över gränsen, föreningsavgifter, böter, ränta på skattekontot eller privata utgifter." },
  R14: { label: "Bokförda intäkter som inte ska tas upp", help: "Intäkter du har bokfört men som inte beskattas, till exempel intäktsränta på skattekontot." },
  R15: { label: "Intäkter som inte bokförts men som ska tas upp", help: "Inkomster som ska beskattas men inte finns i bokföringen." },
  R16: { label: "Kostnader som inte bokförts men som ska dras av", help: "Avdrag som inte finns i bokföringen. Akunta lägger hit årets avskrivningar från inventarieregistret och milersättningen från körjournalen när de inte är bokförda." },
  R17: { label: "Sammanlagt resultat av verksamheten", help: "Summan av R12 till R16." },
  R18: { label: "Gemensam verksamhet: överskott redovisat av annan eller min andel av underskott", help: "Bara om du driver verksamheten tillsammans med någon eller har en NEA-bilaga." },
  R19: { label: "Gemensam verksamhet: underskott redovisat av annan eller min andel av överskott", help: "Bara om du driver verksamheten tillsammans med någon eller har en NEA-bilaga." },
  R20a: { label: "Min andel som medhjälpande make", help: "Bara om du är medhjälpande make i någon annans verksamhet." },
  R20b: { label: "Andel till medhjälpande make", help: "Bara om din make eller sambo beskattas för en del av överskottet." },
  R21: { label: "Min andel av resultatet från verksamheten", help: "Summan av R12 till R20." },
  R22: { label: "Övriga skattemässiga justeringar, kostnader", help: "Andra avdrag som inte är bokförda, till exempel resor mellan bostaden och arbetsplatsen över 11 000 kr." },
  R23: { label: "Övriga skattemässiga justeringar, intäkter", help: "Andra belopp som ska läggas till och som inte har en egen ruta." },
  R24: { label: "Outnyttjat underskott från föregående beskattningsår", help: "Underskott från förra året. Du hittar det i R48 på förra årets NE-bilaga eller i specifikationen till deklarationen." },
  R25: { label: "Skogsavdrag och substansminskningsavdrag", help: "Bara för skogsbruk och utvinning. Kräver bilaga N8." },
  R26: { label: "Återföring av värdeminskningsavdrag vid försäljning av näringsfastighet", help: "Bara om du har sålt en näringsfastighet." },
  R27: { label: "Uttag från skogs-, skogsskade- eller upphovsmannakonto", help: "Bara om du har ett sådant konto." },
  R28: { label: "Insättning på skogs-, skogsskade- eller upphovsmannakonto", help: "Bara om du har ett sådant konto." },
  R29: { label: "Överskott eller underskott före räntefördelning", help: "Summan av R12 till R28." },
  R30: { label: "Positiv räntefördelning", help: "Frivilligt. Räknas fram på hjälpblankett SKV 2196. Samma belopp ska till punkt 11.1 i deklarationen." },
  R31: { label: "Negativ räntefördelning", help: "Tvingande om kapitalunderlaget är negativt. Räknas fram på hjälpblankett SKV 2196." },
  R32: { label: "Återföring av periodiseringsfond", help: "Tidigare avsättning som du nu tar upp till beskattning. Hämtas från sidan Periodiseringsfond." },
  R33: { label: "Överskott eller underskott före avsättning till periodiseringsfond", help: "Summan av R12 till R32. Du får sätta av högst 30 procent av det här beloppet." },
  R34: { label: "Avsättning till periodiseringsfond", help: "Det du väljer att skjuta upp skatten på i år, högst 30 procent av R33. Hämtas från sidan Periodiseringsfond." },
  R35: { label: "Överskott eller underskott före ökning av expansionsfond", help: "Summan av R12 till R34." },
  R36: { label: "Ökning av expansionsfond", help: "Hämtas från sidan Periodiseringsfond. Samma belopp ska till punkt 12.1 i deklarationen." },
  R37: { label: "Minskning av expansionsfond", help: "Hämtas från sidan Periodiseringsfond. Samma belopp ska till punkt 12.2 i deklarationen." },
  R38: { label: "Egna pensionspremier som dras av i näringsverksamheten", help: "Eget pensionssparande som du betalat privat och vill dra av här." },
  R39: { label: "Särskild löneskatt på pensionssparandet i R38", help: "24,26 procent av beloppet i R38. Räknas fram automatiskt." },
  R40: { label: "Medgivna avdrag för egenavgifter föregående år", help: "Beloppet i R43 på förra årets NE-bilaga. Första året du deklarerar verksamheten lämnar du rutan tom." },
  R41: { label: "Påförda egenavgifter enligt slutskattebesked", help: "De egenavgifter du faktiskt fick betala för förra året. Står i slutskattebeskedet och i specifikationen till deklarationen." },
  R42: { label: "Överskott eller underskott före årets avdrag för egenavgifter", help: "Summan av R12 till R41." },
  R43: { label: "Årets beräknade avdrag för egenavgifter", help: "Ett schablonavdrag så att du inte skattar på egenavgifterna (dina sociala avgifter). Normalt 25 procent av R42." },
  R44: { label: "Sjukpenning som hör till näringsverksamheten", help: "Sjukpenning från Försäkringskassan som grundas på inkomst av verksamheten." },
  R45: { label: "Allmänt avdrag för underskott", help: "Underskott i nystartad eller konstnärlig verksamhet som du drar av mot andra inkomster. Samma belopp ska till punkt 14.1." },
  R46: { label: "Underskott som utnyttjas i kapital", help: "Bara vid försäljning av näringsfastighet eller för andelshus." },
  R47: { label: "Överskott", help: "Verksamhetens skattemässiga vinst. Förs till punkt 10.1 i Inkomstdeklaration 1." },
  R48: { label: "Underskott", help: "Verksamhetens skattemässiga förlust. Förs till punkt 10.2 och till R24 nästa år." },
  O2: { label: "Bilkostnader enligt schablon", help: "Milersättning för tjänsteresor med egen bil, enligt körjournalen." }
};

const en: Record<string, BoxText> = {
  B1: { label: "Intangible fixed assets", help: "For example purchased goodwill, patents and licences." },
  B2: { label: "Buildings and land improvements", help: "Book value of buildings in the business." },
  B3: { label: "Land and other assets that cannot be depreciated", help: "Land and anything else that does not lose value for tax purposes." },
  B4: { label: "Machinery and equipment", help: "Book value of equipment, computers, cars and machines after depreciation." },
  B5: { label: "Other fixed assets", help: "For example shares that belong to the business." },
  B6: { label: "Stock", help: "Value of goods you still have to sell at year end." },
  B7: { label: "Trade receivables", help: "Invoices your customers had not paid at year end." },
  B8: { label: "Other receivables", help: "Other money owed to you, for example VAT to be refunded." },
  B9: { label: "Cash and bank", help: "Money in the business account and in cash at year end." },
  B10: { label: "Equity", help: "Assets minus liabilities. Worked out from the other boxes." },
  B11: { label: "Untaxed reserves", help: "Not used with simplified year-end accounts. Periodiseringsfond goes in R32 and R34, not here." },
  B12: { label: "Provisions", help: "Not used with simplified year-end accounts." },
  B13: { label: "Loans", help: "Bank loans and other loans in the business." },
  B14: { label: "Tax liabilities", help: "VAT and other taxes the business owed at year end." },
  B15: { label: "Trade payables", help: "Supplier invoices you had not paid at year end." },
  B16: { label: "Other liabilities", help: "Other debts that do not fit the boxes above." },
  R1: { label: "Sales and work done, and other income subject to VAT", help: "What you sold during the year, excluding VAT." },
  R2: { label: "Income exempt from VAT", help: "Income without VAT, for example grants, insurance payouts and VAT-free sales." },
  R3: { label: "Car and housing benefit", help: "The value of using the business's car or premises privately. Taken from accounts 32xx." },
  R4: { label: "Interest income", help: "Interest on the business account and similar." },
  R5: { label: "Goods, materials and services", help: "Purchases of goods, materials and subcontractors." },
  R6: { label: "Other external costs", help: "Rent, phone, software, travel, insurance and other running costs." },
  R7: { label: "Employees", help: "Wages and contributions for staff. Your own drawings do not belong here." },
  R8: { label: "Interest costs", help: "Interest on loans and other financial costs." },
  R9: { label: "Depreciation of buildings and land improvements", help: "Booked depreciation of buildings." },
  R10: { label: "Depreciation of machinery, equipment and intangible assets", help: "Booked depreciation of equipment." },
  R11: { label: "Booked result", help: "Income (R1 to R4) minus costs (R5 to R10). The same figure as the profit and loss report." },
  R12: { label: "Booked result", help: "Carried over from R11." },
  R13: { label: "Booked costs that are not deductible", help: "Costs in your books that you may not deduct, for example entertainment above the limit, membership fees, fines, interest on the tax account or private spending." },
  R14: { label: "Booked income that is not taxable", help: "Income in your books that is not taxed, for example interest received on the tax account." },
  R15: { label: "Income not booked that is taxable", help: "Taxable income that is not in your books." },
  R16: { label: "Costs not booked that are deductible", help: "Deductions that are not in your books. Akunta puts this year's depreciation from the asset register and the mileage allowance from the mileage log here when they are not booked." },
  R17: { label: "Total result of the business", help: "The sum of R12 to R16." },
  R18: { label: "Shared business: surplus reported by someone else, or my share of a deficit", help: "Only if you run the business with someone else or have an NEA form." },
  R19: { label: "Shared business: deficit reported by someone else, or my share of a surplus", help: "Only if you run the business with someone else or have an NEA form." },
  R20a: { label: "My share as assisting spouse", help: "Only if you are an assisting spouse in someone else's business." },
  R20b: { label: "Share to assisting spouse", help: "Only if your spouse or partner is taxed on part of the surplus." },
  R21: { label: "My share of the result", help: "The sum of R12 to R20." },
  R22: { label: "Other tax adjustments, costs", help: "Other deductions not in your books, for example travel between home and the workplace above SEK 11,000." },
  R23: { label: "Other tax adjustments, income", help: "Other amounts to add that have no box of their own." },
  R24: { label: "Unused deficit from the previous year", help: "Last year's loss. You find it in R48 on last year's NE-bilaga or in the specification sent with your tax return." },
  R25: { label: "Forestry and depletion deductions", help: "Only for forestry and extraction. Requires form N8." },
  R26: { label: "Reversal of depreciation when selling business property", help: "Only if you sold a business property." },
  R27: { label: "Withdrawal from a forestry or author's account", help: "Only if you have such an account." },
  R28: { label: "Deposit to a forestry or author's account", help: "Only if you have such an account." },
  R29: { label: "Surplus or deficit before interest allocation", help: "The sum of R12 to R28." },
  R30: { label: "Positive interest allocation (räntefördelning)", help: "Optional. Worked out on helper form SKV 2196. The same amount goes in item 11.1 of the tax return." },
  R31: { label: "Negative interest allocation (räntefördelning)", help: "Compulsory if the capital base is negative. Worked out on helper form SKV 2196." },
  R32: { label: "Reversal of periodiseringsfond", help: "An earlier tax allocation reserve that you now bring back to be taxed. Taken from the Tax Reserves page." },
  R33: { label: "Surplus or deficit before allocation to periodiseringsfond", help: "The sum of R12 to R32. You may set aside at most 30 percent of this amount." },
  R34: { label: "Allocation to periodiseringsfond", help: "The profit you choose to defer tax on this year, at most 30 percent of R33. Taken from the Tax Reserves page." },
  R35: { label: "Surplus or deficit before increase of expansionsfond", help: "The sum of R12 to R34." },
  R36: { label: "Increase of expansionsfond", help: "Taken from the Tax Reserves page. The same amount goes in item 12.1 of the tax return." },
  R37: { label: "Decrease of expansionsfond", help: "Taken from the Tax Reserves page. The same amount goes in item 12.2 of the tax return." },
  R38: { label: "Own pension premiums deducted in the business", help: "Private pension saving that you paid yourself and want to deduct here." },
  R39: { label: "Special payroll tax on the pension saving in R38", help: "24.26 percent of the amount in R38. Worked out automatically." },
  R40: { label: "Deduction for egenavgifter allowed last year", help: "The amount in R43 on last year's NE-bilaga. Leave it empty the first year you declare the business." },
  R41: { label: "Egenavgifter charged according to the final tax statement", help: "The social contributions you actually paid for last year. Shown in your final tax statement (slutskattebesked) and in the specification sent with the tax return." },
  R42: { label: "Surplus or deficit before this year's deduction for egenavgifter", help: "The sum of R12 to R41." },
  R43: { label: "This year's estimated deduction for egenavgifter", help: "A standard deduction so that you are not taxed on your egenavgifter (your own social contributions). Normally 25 percent of R42." },
  R44: { label: "Sickness benefit that belongs to the business", help: "Sickness benefit from Försäkringskassan based on income from the business." },
  R45: { label: "General deduction for a deficit", help: "A loss in a newly started or artistic business that you deduct against other income. The same amount goes in item 14.1." },
  R46: { label: "Deficit used against capital income", help: "Only when selling business property or for certain shared housing." },
  R47: { label: "Surplus", help: "The taxable profit of the business. Carried to item 10.1 of Inkomstdeklaration 1." },
  R48: { label: "Deficit", help: "The tax loss of the business. Carried to item 10.2, and to R24 next year." },
  O2: { label: "Car costs by the standard rate", help: "Mileage allowance for business trips in your own car, from the mileage log." }
};

export const neBoxText = (id: string, locale: Lang): BoxText =>
  (locale === "sv" ? sv : en)[id] ?? { label: id, help: "" };

/** Box number as printed on the form ("R20" for both halves of R20, "2" for övriga uppgifter 2). */
export const neBoxNumber = (id: string): string => (id.startsWith("O") ? id.slice(1) : id.replace(/[ab]$/, ""));

export const nePartText = (key: string, locale: Lang): string => {
  const texts: Record<string, [string, string]> = {
    depreciation: ["Årets avskrivningar enligt inventarieregistret, inte bokförda", "This year's depreciation from the asset register, not booked"],
    mileage: ["Milersättning enligt körjournalen, inte bokförd", "Mileage allowance from the mileage log, not booked"],
    entered: ["Eget belopp", "Your own figure"],
    earlierResult: ["Resultat från tidigare år som inte förts över", "Result from earlier years not yet carried over"],
    yearResult: ["Årets resultat", "This year's result"]
  };
  const pair = texts[key];
  return pair ? pair[locale === "sv" ? 0 : 1] : key;
};

export const neWarningText = (warning: NeWarning, locale: Lang, money: (value: number) => string): string => {
  const p = warning.params;
  const svText = locale === "sv";
  switch (warning.code) {
    case "unmappedAccount":
      return svText
        ? `Konto ${p.account} ligger utanför de vanliga kontogrupperna och har räknats in i ${p.box}. Kontrollera att det hamnar rätt.`
        : `Account ${p.account} is outside the standard account groups and has been counted in ${p.box}. Check that this is right.`;
    case "egenavgifterBooked":
      return svText
        ? `Du har bokfört ${money(Number(p.amount))} på konto 7570 Egenavgifter. Dina egna egenavgifter är ingen kostnad i bokföringen. Skriv beloppet i R13 så att det inte dras av två gånger.`
        : `You have booked ${money(Number(p.amount))} on account 7570 Egenavgifter. Your own social contributions are not a cost in the books. Enter the amount in R13 so that it is not deducted twice.`;
    case "untaxedReserveBooked":
      return svText
        ? `Konto ${p.account} har ett saldo. Periodiseringsfond bokförs inte i enskild firma med förenklat årsbokslut. Kontrollera kontot.`
        : `Account ${p.account} has a balance. A periodiseringsfond is not booked by a sole trader with simplified year-end accounts. Check the account.`;
    case "balanceDiffers":
      return svText
        ? `Balansräkningen går inte ihop: skillnaden är ${money(Number(p.amount))}. Kontrollera ingående balanser.`
        : `The balance sheet does not balance: the difference is ${money(Number(p.amount))}. Check the opening balances.`;
    case "assetDisposed":
      return svText
        ? "Du har sålt eller utrangerat inventarier i år. Vinst eller förlust vid försäljningen räknas inte ut här. Kontrollera att försäljningen är bokförd som intäkt."
        : "You sold or scrapped equipment this year. The gain or loss is not worked out here. Check that the sale is booked as income.";
    case "depreciationNotBooked":
      return svText
        ? `Årets avskrivningar (${money(Number(p.amount))}) är inte bokförda, så de dras av i R16. Har du redan kostnadsfört köpet i bokföringen ska tillgången tas bort ur inventarieregistret, annars dras den av två gånger.`
        : `This year's depreciation (${money(Number(p.amount))}) is not booked, so it is deducted in R16. If you already booked the purchase as a cost, remove the asset from the register, otherwise it is deducted twice.`;
    case "pfCapped":
      return svText
        ? `Du har registrerat ${money(Number(p.requested))} till periodiseringsfond men får sätta av högst ${money(Number(p.max))} (30 procent av R33). R34 har sänkts till det högsta beloppet.`
        : `You recorded ${money(Number(p.requested))} for periodiseringsfond but may set aside at most ${money(Number(p.max))} (30 percent of R33). R34 has been lowered to the maximum.`;
    case "efCapped":
      return svText
        ? `Ökningen av expansionsfond (${money(Number(p.requested))}) är större än överskottet i R35. R36 har sänkts till ${money(Number(p.max))}.`
        : `The increase of expansionsfond (${money(Number(p.requested))}) is larger than the surplus in R35. R36 has been lowered to ${money(Number(p.max))}.`;
    case "expansionsfondInk1":
      return svText
        ? "Expansionsfond: fyll också i punkt 12.1 eller 12.2 i Inkomstdeklaration 1 och kapitalunderlaget under Övriga uppgifter. Det finns inte med i filen."
        : "Expansionsfond: also fill in item 12.1 or 12.2 of Inkomstdeklaration 1 and the capital base under Other information. These are not in the file.";
    case "egenavgifterRateAssumed":
      return svText
        ? "Avdraget för egenavgifter i R43 är räknat med 25 procent, som gäller de flesta. Är du född 1958 eller tidigare, har hel ålderspension eller sjukersättning, eller är verksamheten passiv, gäller en lägre procentsats. Ändra då beloppet hos Skatteverket."
        : "The deduction for egenavgifter in R43 uses 25 percent, which applies to most people. If you were born in 1958 or earlier, draw a full pension or sickness compensation, or the business is passive, a lower rate applies. Change the amount at Skatteverket in that case.";
    default:
      return warning.code;
  }
};
