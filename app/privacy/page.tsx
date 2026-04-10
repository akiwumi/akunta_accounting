import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/locale";

export const metadata = {
  title: "Privacy Policy – Akunta",
  description: "How Akunta collects, uses, and protects your personal data."
};

export default function PrivacyPage() {
  const locale = getRequestLocale();
  const sv = locale === "sv";
  const updated = "10 April 2026";

  if (sv) {
    return (
      <main className="publicMain">
        <div className="legalPage">
          <Link href="/" className="legalBack">← Akunta</Link>
          <h1>Integritetspolicy</h1>
          <p className="legalUpdated">Senast uppdaterad: {updated}</p>

          <section>
            <h2>1. Personuppgiftsansvarig</h2>
            <p>
              Akunta är personuppgiftsansvarig för behandlingen av dina personuppgifter.
              Kontakta oss på <a href="mailto:support@akunta.se">support@akunta.se</a> med
              frågor om dataskydd.
            </p>
          </section>

          <section>
            <h2>2. Vilka uppgifter samlar vi in?</h2>
            <ul>
              <li><strong>Kontouppgifter:</strong> namn, e-postadress, lösenord (krypterat)</li>
              <li><strong>Företagsuppgifter:</strong> företagsnamn, organisationsnummer, momsregistreringsnummer, adress</li>
              <li><strong>Bokföringsdata:</strong> kvitton, fakturor, transaktioner, löner och relaterade dokument som du matar in</li>
              <li><strong>Tekniska uppgifter:</strong> IP-adress, webbläsartyp, enhetstyp, felloggning (Sentry) och anonyma användningsmönster (Vercel Analytics)</li>
            </ul>
          </section>

          <section>
            <h2>3. Varför behandlar vi dina uppgifter?</h2>
            <ul>
              <li><strong>Avtalsfullgörelse (Art. 6.1.b GDPR):</strong> För att tillhandahålla bokföringstjänsten – lagra din data, generera rapporter och fakturor</li>
              <li><strong>Rättslig förpliktelse (Art. 6.1.c GDPR):</strong> Skatteverket och bokföringslagen kräver att vi hanterar bokföringsunderlag korrekt</li>
              <li><strong>Berättigat intresse (Art. 6.1.f GDPR):</strong> Felloggning för att säkerställa tjänstens stabilitet; anonyma prestandamätningar</li>
            </ul>
          </section>

          <section>
            <h2>4. Var lagras dina uppgifter?</h2>
            <p>
              All bokföringsdata lagras i PostgreSQL-databasen hos Supabase (AWS eu-west-1, Irland).
              Uppladdade filer (kvittobilder, faktura-PDF) lagras i Supabase Storage (samma region).
              Inga personuppgifter lämnas vidare till tredje part utanför EU/EES utan adekvata skyddsåtgärder.
            </p>
          </section>

          <section>
            <h2>5. Hur länge sparar vi dina uppgifter?</h2>
            <p>
              Bokföringsdata sparas så länge ditt konto är aktivt och i minst 7 år efter räkenskapsårets slut
              i enlighet med bokföringslagen (7 kap. BFL). Vid kontoborttagning anonymiseras eller raderas
              uppgifter inom 30 dagar, med undantag för vad som krävs enligt lag.
            </p>
          </section>

          <section>
            <h2>6. Dina rättigheter</h2>
            <p>Under GDPR har du rätt att:</p>
            <ul>
              <li>Begära tillgång till dina personuppgifter</li>
              <li>Begära rättelse av felaktiga uppgifter</li>
              <li>Begära radering ("rätten att bli glömd"), med förbehåll för lagstadgade krav</li>
              <li>Begära begränsning av behandlingen</li>
              <li>Invända mot behandling baserad på berättigat intresse</li>
              <li>Dataportabilitet – exportera dina uppgifter i maskinläsbart format</li>
            </ul>
            <p>
              Skicka begäran till <a href="mailto:support@akunta.se">support@akunta.se</a>.
              Du har också rätt att lämna klagomål till Integritetsskyddsmyndigheten (IMY) på{" "}
              <a href="https://www.imy.se" target="_blank" rel="noopener noreferrer">imy.se</a>.
            </p>
          </section>

          <section>
            <h2>7. Cookies och spårning</h2>
            <p>Vi använder följande cookies:</p>
            <ul>
              <li><strong>akunta_session</strong> – nödvändig inloggningstoken (httpOnly, 30 dagar)</li>
              <li><strong>akunta_auth</strong> – inloggningsindikator för UI (30 dagar)</li>
              <li><strong>locale</strong> – språkinställning (1 år)</li>
              <li><strong>cookie_consent</strong> – ditt cookiesamtycke (1 år)</li>
            </ul>
            <p>
              Med ditt samtycke aktiveras Sentry (felloggning) och Vercel Analytics (cookielösa, anonyma sidvisningsstatistik).
              Vercel Analytics samlar inte in personuppgifter och kräver inget samtycke.
            </p>
          </section>

          <section>
            <h2>8. Kontakt</h2>
            <p>
              Frågor om denna policy? Kontakta oss på{" "}
              <a href="mailto:support@akunta.se">support@akunta.se</a>.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="publicMain">
      <div className="legalPage">
        <Link href="/" className="legalBack">← Akunta</Link>
        <h1>Privacy Policy</h1>
        <p className="legalUpdated">Last updated: {updated}</p>

        <section>
          <h2>1. Data Controller</h2>
          <p>
            Akunta is the data controller for the processing of your personal data.
            Contact us at <a href="mailto:support@akunta.se">support@akunta.se</a> for
            any data protection enquiries.
          </p>
        </section>

        <section>
          <h2>2. What data do we collect?</h2>
          <ul>
            <li><strong>Account data:</strong> name, email address, password (hashed)</li>
            <li><strong>Business data:</strong> company name, organisation number, VAT number, address</li>
            <li><strong>Accounting data:</strong> receipts, invoices, transactions, payroll records and related documents you enter</li>
            <li><strong>Technical data:</strong> IP address, browser type, device type, error logs (Sentry) and anonymous usage patterns (Vercel Analytics)</li>
          </ul>
        </section>

        <section>
          <h2>3. Why do we process your data?</h2>
          <ul>
            <li><strong>Contract performance (Art. 6.1.b GDPR):</strong> To provide the bookkeeping service — store your data, generate reports and invoices</li>
            <li><strong>Legal obligation (Art. 6.1.c GDPR):</strong> Swedish tax law (Skatteverket) and the Bookkeeping Act require us to handle accounting records correctly</li>
            <li><strong>Legitimate interest (Art. 6.1.f GDPR):</strong> Error logging to maintain service stability; anonymous performance measurements</li>
          </ul>
        </section>

        <section>
          <h2>4. Where is your data stored?</h2>
          <p>
            All accounting data is stored in a PostgreSQL database hosted by Supabase (AWS eu-west-1, Ireland).
            Uploaded files (receipt images, invoice PDFs) are stored in Supabase Storage (same region).
            No personal data is transferred to third parties outside the EU/EEA without adequate safeguards.
          </p>
        </section>

        <section>
          <h2>5. How long do we keep your data?</h2>
          <p>
            Accounting data is retained for as long as your account is active and for at least 7 years after
            the end of the financial year, as required by the Swedish Bookkeeping Act (7 ch. BFL).
            On account deletion, data is anonymised or deleted within 30 days, except where legally required.
          </p>
        </section>

        <section>
          <h2>6. Your rights</h2>
          <p>Under GDPR you have the right to:</p>
          <ul>
            <li>Request access to your personal data</li>
            <li>Request correction of inaccurate data</li>
            <li>Request erasure ("right to be forgotten"), subject to legal retention requirements</li>
            <li>Request restriction of processing</li>
            <li>Object to processing based on legitimate interest</li>
            <li>Data portability — export your data in machine-readable format</li>
          </ul>
          <p>
            Send requests to <a href="mailto:support@akunta.se">support@akunta.se</a>.
            You may also lodge a complaint with the Swedish Data Protection Authority (IMY) at{" "}
            <a href="https://www.imy.se" target="_blank" rel="noopener noreferrer">imy.se</a>.
          </p>
        </section>

        <section>
          <h2>7. Cookies and tracking</h2>
          <p>We use the following cookies:</p>
          <ul>
            <li><strong>akunta_session</strong> — essential login token (httpOnly, 30 days)</li>
            <li><strong>akunta_auth</strong> — login UI indicator (30 days)</li>
            <li><strong>locale</strong> — language preference (1 year)</li>
            <li><strong>cookie_consent</strong> — your cookie consent choice (1 year)</li>
          </ul>
          <p>
            With your consent, we enable Sentry (error monitoring) and Vercel Analytics (cookieless,
            anonymous page-view statistics). Vercel Analytics does not collect personal data and does not
            require consent.
          </p>
        </section>

        <section>
          <h2>8. Contact</h2>
          <p>
            Questions about this policy? Contact us at{" "}
            <a href="mailto:support@akunta.se">support@akunta.se</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
