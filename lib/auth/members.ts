// Who has access to a business, and changing it.
//
// Every function takes the acting user and checks their role inside the same
// database transaction that makes the change, so the rules hold no matter
// which route (or script) calls them. Every change is written to the audit log
// in that transaction.

import { type Prisma } from "@prisma/client";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { isRole, normalizeRole, type Role, Roles } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

export type TeamErrorCode =
  | "owner_only"
  | "not_found"
  | "last_owner"
  | "invalid_role"
  | "already_member"
  | "invalid_invitation"
  | "invitation_expired"
  | "invitation_revoked"
  | "invitation_used"
  | "email_mismatch"
  | "account_exists"
  | "not_a_member";

const STATUS: Record<TeamErrorCode, number> = {
  owner_only: 403,
  not_found: 404,
  last_owner: 409,
  invalid_role: 422,
  already_member: 409,
  invalid_invitation: 404,
  invitation_expired: 410,
  invitation_revoked: 410,
  invitation_used: 409,
  email_mismatch: 403,
  account_exists: 409,
  not_a_member: 403
};

const MESSAGES: Record<TeamErrorCode, { en: string; sv: string }> = {
  owner_only: { en: "Only the owner of the business can do this.", sv: "Det här kan bara företagets ägare göra." },
  not_found: { en: "That person or invitation was not found.", sv: "Personen eller inbjudan hittades inte." },
  last_owner: {
    en: "A business must have an owner. Make someone else owner first.",
    sv: "Ett företag måste ha en ägare. Gör någon annan till ägare först."
  },
  invalid_role: { en: "That role does not exist.", sv: "Den rollen finns inte." },
  already_member: { en: "That person already has access.", sv: "Den personen har redan åtkomst." },
  invalid_invitation: { en: "This invitation link is not valid.", sv: "Den här inbjudningslänken är inte giltig." },
  invitation_expired: {
    en: "This invitation has expired. Ask for a new one.",
    sv: "Inbjudan har gått ut. Be om en ny."
  },
  invitation_revoked: {
    en: "This invitation has been withdrawn. Ask for a new one.",
    sv: "Inbjudan har dragits tillbaka. Be om en ny."
  },
  invitation_used: { en: "This invitation has already been used.", sv: "Inbjudan har redan använts." },
  email_mismatch: {
    en: "This invitation was sent to another email address.",
    sv: "Inbjudan skickades till en annan e-postadress."
  },
  account_exists: {
    en: "There is already an account for this email address. Sign in to accept the invitation.",
    sv: "Det finns redan ett konto för den här e-postadressen. Logga in för att tacka ja."
  },
  not_a_member: { en: "You do not have access to that business.", sv: "Du har inte åtkomst till det företaget." }
};

export class TeamError extends Error {
  readonly status: number;
  constructor(public readonly code: TeamErrorCode) {
    super(MESSAGES[code].en);
    this.name = "TeamError";
    this.status = STATUS[code];
  }
  localized(locale: string | null | undefined) {
    return locale === "sv" ? MESSAGES[this.code].sv : MESSAGES[this.code].en;
  }
}

/**
 * Serialises member changes for one business. Without it two owners demoting
 * each other at the same moment could both pass the "is there another owner"
 * check and leave the business with none.
 */
export const lockBusinessTeam = async (tx: Db, businessId: string) => {
  await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
};

export const assertOwner = async (tx: Db, businessId: string, userId: string) => {
  const membership = await tx.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true }
  });
  if (!membership || normalizeRole(membership.role) !== Roles.OWNER) throw new TeamError("owner_only");
};

const countOwners = (tx: Db, businessId: string) =>
  tx.membership.count({ where: { businessId, role: Roles.OWNER } });

export type MemberSummary = {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: Role;
  since: Date;
};

export const listMembers = async (businessId: string): Promise<MemberSummary[]> => {
  const rows = await prisma.membership.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, role: true, createdAt: true, user: { select: { email: true, fullName: true } } }
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    email: row.user.email,
    fullName: row.user.fullName,
    role: normalizeRole(row.role),
    since: row.createdAt
  }));
};

export const changeMemberRole = async (params: {
  businessId: string;
  actorUserId: string;
  membershipId: string;
  role: string;
}) => {
  if (!isRole(params.role)) throw new TeamError("invalid_role");
  const nextRole = params.role;

  return prisma.$transaction(async (tx) => {
    await lockBusinessTeam(tx, params.businessId);
    await assertOwner(tx, params.businessId, params.actorUserId);

    // Scoped by businessId: a membership id from another business is "not found".
    const target = await tx.membership.findFirst({
      where: { id: params.membershipId, businessId: params.businessId },
      select: { id: true, userId: true, role: true }
    });
    if (!target) throw new TeamError("not_found");
    if (target.role === nextRole) return { id: target.id, userId: target.userId, role: nextRole };

    if (target.role === Roles.OWNER && nextRole !== Roles.OWNER && (await countOwners(tx, params.businessId)) <= 1) {
      throw new TeamError("last_owner");
    }

    await tx.membership.update({ where: { id: target.id }, data: { role: nextRole } });
    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.actorUserId,
      entityType: "Membership",
      entityId: target.id,
      action: "ROLE_CHANGE",
      before: { userId: target.userId, role: target.role },
      after: { userId: target.userId, role: nextRole }
    });
    return { id: target.id, userId: target.userId, role: nextRole };
  });
};

/**
 * Removes a member and ends their sessions in this business in the same
 * transaction, so access stops at once. An owner can remove anyone; anyone can
 * remove themselves (leave). The last owner cannot be removed.
 */
export const removeMember = async (params: { businessId: string; actorUserId: string; membershipId: string }) =>
  prisma.$transaction(async (tx) => {
    await lockBusinessTeam(tx, params.businessId);

    const target = await tx.membership.findFirst({
      where: { id: params.membershipId, businessId: params.businessId },
      select: { id: true, userId: true, role: true, user: { select: { email: true } } }
    });
    const leaving = target?.userId === params.actorUserId;
    if (!leaving) await assertOwner(tx, params.businessId, params.actorUserId);
    if (!target) throw new TeamError("not_found");

    if (target.role === Roles.OWNER && (await countOwners(tx, params.businessId)) <= 1) {
      throw new TeamError("last_owner");
    }

    await tx.membership.delete({ where: { id: target.id } });
    const ended = await tx.session.deleteMany({ where: { userId: target.userId, businessId: params.businessId } });

    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.actorUserId,
      entityType: "Membership",
      entityId: target.id,
      action: leaving ? "LEAVE" : "REMOVE",
      before: { userId: target.userId, email: target.user.email, role: target.role },
      after: { sessionsEnded: ended.count }
    });
    return { userId: target.userId, sessionsEnded: ended.count };
  });

/** The caller leaves the business they are signed in to. */
export const leaveBusiness = async (params: { businessId: string; userId: string }) => {
  const own = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: params.userId, businessId: params.businessId } },
    select: { id: true }
  });
  if (!own) throw new TeamError("not_a_member");
  return removeMember({ businessId: params.businessId, actorUserId: params.userId, membershipId: own.id });
};
