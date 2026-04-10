import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/locale";

export const metadata = {
  title: "Terms of Service – Akunta",
  description: "Terms and conditions for using the Akunta bookkeeping service."
};

export default function TermsPage() {
  const locale = getRequestLocale();
  const sv = locale === "sv";
  const updated = "10 April 2026";

  if (sv) {
    return (
      <main className="publicMain">
        <div className="legalPage">
          <Link href="/" className="legalBack">← Akunta</Link>
          <h1>Användarvillkor</h1>
          <p className="legalUpdated">Senast uppdaterad: {updated}</p>

          <section>
            <h2>1. Om tjänsten</h2>
            <p>
              Akunta är ett webbaserat bokföringsverktyg riktat till svenska egenföretagare och enskilda firmor.
              Genom att skapa ett konto accepterar du dessa villkor.
            </p>
          </section>

          <section>
            <h2>2. Ditt ansvar</h2>
            <ul>
              <li>Du ansvarar för att bokföringsdata du matar in är korrekt och fullständig.</li>
              <li>Akunta ersätter inte en auktoriserad revisor. Vi rekommenderar att du anlitar en revisor för årsredovisning och deklaration.</li>
              <li>Du ansvarar för att uppfylla alla skattemässiga och redovisningsmässiga skyldigheter gentemot Skatteverket och andra myndigheter.</li>
              <li>Du håller dina inloggningsuppgifter konfidentiella och ansvarar för all aktivitet under ditt konto.</li>
            </ul>
          </section>

          <section>
            <h2>3. Tjänstens tillgänglighet</h2>
            <p>
              Vi strävar efter hög tillgänglighet men garanterar inte 100 % drifttid.
              Planerat underhåll meddelas i förväg när det är möjligt. Vi ansvarar inte för
              förluster till följd av avbrott utanför vår kontroll.
            </p>
          </section>

          <section>
            <h2>4. Immateriella rättigheter</h2>
            <p>
              Akuntaplattformens kod, design och varumärke tillhör Akunta.
              Din bokföringsdata tillhör dig. Vi behandlar den uteslutande för att tillhandahålla tjänsten.
            </p>
          </section>

          <section>
            <h2>5. Betalning och prenumeration</h2>
            <p>
              Priser anges exklusive moms. Prenumeration faktureras månadsvis eller årsvis.
              Du kan säga upp prenumerationen när som helst; inget avtal löper vidare automatiskt efter
              den betalda perioden. Återbetalning sker inte för påbörjad period.
            </p>
          </section>

          <section>
            <h2>6. Uppsägning</h2>
            <p>
              Du kan ta bort ditt konto när som helst via inställningssidan eller genom att kontakta
              <a href="mailto:support@akunta.se">support@akunta.se</a>. Vi förbehåller oss rätten att
              stänga konton som bryter mot dessa villkor.
            </p>
          </section>

          <section>
            <h2>7. Ansvarsbegränsning</h2>
            <p>
              Akunta tillhandahålls &quot;i befintligt skick&quot;. Vi ansvarar inte för indirekta skador,
              utebliven vinst eller ekonomiska förluster till följd av din användning av tjänsten.
              Vårt totala ansvar är begränsat till det belopp du betalat under de senaste 12 månaderna.
            </p>
          </section>

          <section>
            <h2>8. Tillämplig lag</h2>
            <p>
              Dessa villkor regleras av svensk lag. Tvister avgörs av svensk allmän domstol med
              Stockholms tingsrätt som första instans.
            </p>
          </section>

          <section>
            <h2>9. Kontakt</h2>
            <p>
              Frågor om dessa villkor? Kontakta oss på{" "}
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
        <h1>Terms of Service</h1>
        <p className="legalUpdated">Last updated: {updated}</p>

        <section>
          <h2>1. About the service</h2>
          <p>
            Akunta is a web-based bookkeeping tool aimed at Swedish sole traders and individual businesses.
            By creating an account you accept these terms.
          </p>
        </section>

        <section>
          <h2>2. Your responsibilities</h2>
          <ul>
            <li>You are responsible for ensuring that the accounting data you enter is accurate and complete.</li>
            <li>Akunta does not replace a licensed accountant. We recommend engaging an accountant for annual accounts and tax returns.</li>
            <li>You are responsible for fulfilling all tax and accounting obligations to Skatteverket and other authorities.</li>
            <li>You keep your login credentials confidential and are responsible for all activity under your account.</li>
          </ul>
        </section>

        <section>
          <h2>3. Service availability</h2>
          <p>
            We aim for high availability but do not guarantee 100% uptime.
            Planned maintenance will be notified in advance where possible. We are not liable for
            losses resulting from outages beyond our control.
          </p>
        </section>

        <section>
          <h2>4. Intellectual property</h2>
          <p>
            The Akunta platform&apos;s code, design and brand belong to Akunta.
            Your accounting data belongs to you. We process it solely to provide the service.
          </p>
        </section>

        <section>
          <h2>5. Payment and subscription</h2>
          <p>
            Prices are shown excluding VAT. Subscriptions are billed monthly or annually.
            You may cancel at any time; no contract continues automatically beyond the paid period.
            Refunds are not provided for a period already started.
          </p>
        </section>

        <section>
          <h2>6. Termination</h2>
          <p>
            You may delete your account at any time via the settings page or by contacting{" "}
            <a href="mailto:support@akunta.se">support@akunta.se</a>. We reserve the right to
            suspend accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2>7. Limitation of liability</h2>
          <p>
            Akunta is provided &quot;as is&quot;. We are not liable for indirect damages, lost profits or financial
            losses resulting from your use of the service. Our total liability is limited to the amount
            you have paid in the previous 12 months.
          </p>
        </section>

        <section>
          <h2>8. Governing law</h2>
          <p>
            These terms are governed by Swedish law. Disputes shall be settled by Swedish general courts
            with Stockholm District Court as the court of first instance.
          </p>
        </section>

        <section>
          <h2>9. Contact</h2>
          <p>
            Questions about these terms? Contact us at{" "}
            <a href="mailto:support@akunta.se">support@akunta.se</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
