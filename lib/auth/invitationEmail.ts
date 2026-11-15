// The email that carries an invitation link.

import { INVITATION_TTL_DAYS } from "@/lib/auth/invitations";
import { type InvitableRole, Roles } from "@/lib/auth/roles";
import { escapeHtml, sendEmail, type SendEmailResult } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";

export const invitationUrl = (token: string) => {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${appUrl}/invite/${encodeURIComponent(token)}`;
};

const rights = (role: InvitableRole) =>
  role === Roles.ACCOUNTANT
    ? {
        sv: "Du får fullständig bokföringsbehörighet: du kan se och bokföra allt, men inte hantera medlemmar eller abonnemang.",
        en: "You get full bookkeeping access: you can view and book everything, but not manage members or the subscription."
      }
    : {
        sv: "Du får läsbehörighet: du kan se allt och ladda ner underlag, men inte ändra något.",
        en: "You get read-only access: you can view everything and download exports, but not change anything."
      };

export const sendInvitationEmail = async (params: {
  to: string;
  token: string;
  businessName: string;
  inviterName: string | null;
  role: InvitableRole;
}): Promise<SendEmailResult> => {
  const url = invitationUrl(params.token);
  const inviter = params.inviterName?.trim() || params.businessName;
  const text = rights(params.role);

  const lines = {
    sv: [
      `${inviter} bjuder in dig till bokföringen för ${params.businessName} i Akunta.`,
      text.sv,
      `Öppna länken för att tacka ja. Den gäller i ${INVITATION_TTL_DAYS} dagar och kan bara användas en gång, av dig.`
    ],
    en: [
      `${inviter} invites you to the books of ${params.businessName} in Akunta.`,
      text.en,
      `Open the link to accept. It is valid for ${INVITATION_TTL_DAYS} days and can be used once, by you only.`
    ]
  };

  const paragraph = (value: string) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#33413f;">${escapeHtml(value)}</p>`;
  const safeUrl = escapeHtml(url);
  const html = `
    <div style="background:#ffffff;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1a1c1e;">
      <div style="max-width:560px;margin:0 auto;">
        <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7a7d;">Akunta</p>
        <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;font-weight:600;">${escapeHtml(params.businessName)}</h1>
        ${lines.sv.map(paragraph).join("")}
        <p style="margin:22px 0;">
          <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;background:#12423f;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px;">
            Öppna inbjudan / Open invitation
          </a>
        </p>
        ${lines.en.map(paragraph).join("")}
        <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#6b7a7d;word-break:break-all;">${safeUrl}</p>
        <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b7a7d;">
          Väntade du dig inte det här mejlet kan du bortse från det. Ingen får åtkomst förrän du tackar ja.<br />
          If you did not expect this email you can ignore it. Nobody gets access until you accept.
        </p>
      </div>
    </div>`;

  const result = await sendEmail({
    to: params.to,
    subject: `Inbjudan till ${params.businessName} i Akunta | Invitation to ${params.businessName} in Akunta`.replace(
      /[\r\n]+/g,
      " "
    ),
    html,
    text: [...lines.sv, url, "", ...lines.en, url].join("\n")
  });

  if (!result.ok) {
    // The link is a credential: it goes to the invited mailbox and nowhere
    // else. Outside production it is printed so the flow can be tried locally.
    if (process.env.NODE_ENV !== "production") {
      console.info(`[DEV] Invitation link for ${params.to}: ${url}`);
    }
    logger.warn("team.invitation_email.not_sent", { reason: result.reason, message: result.message });
  }
  return result;
};
