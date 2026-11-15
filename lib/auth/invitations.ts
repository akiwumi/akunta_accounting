// Invitations: an owner gives another person access to the business.
//
// The link carries a random token. Only its SHA-256 hash is stored, so the
// database (or a backup of it) cannot be used to accept an invitation. A link
// works once, for 7 days, and only for the email address it was sent to.

import { createHash, randomBytes } from "crypto";

import { Prisma } from "@prisma/client";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { assertOwner, lockBusinessTeam, TeamError } from "@/lib/auth/members";
import { INVITABLE_ROLES, type InvitableRole, Roles } from "@/lib/auth/roles";
import { hashPassword } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

export const INVITATION_TTL_DAYS = 7;
const TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export const generateInvitationToken = () => randomBytes(32).toString("hex");
export const hashInvitationToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isInvitableRole = (role: string): role is InvitableRole => (INVITABLE_ROLES as readonly string[]).includes(role);
/** An invitation never grants more than it was created with; anything unexpected becomes read-only. */
const invitedRole = (role: string): InvitableRole => (isInvitableRole(role) ? role : Roles.VIEWER);

export type InvitationStatus = "pending" | "expired" | "revoked" | "accepted";

export const invitationStatus = (
  invitation: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now = new Date()
): InvitationStatus => {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt <= now) return "expired";
  return "pending";
};

const assertPending = (invitation: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null }) => {
  const status = invitationStatus(invitation);
  if (status === "accepted") throw new TeamError("invitation_used");
  if (status === "revoked") throw new TeamError("invitation_revoked");
  if (status === "expired") throw new TeamError("invitation_expired");
};

// ─── Owner side ───────────────────────────────────────────────────────────────

/**
 * Creates an invitation and returns the token for the email. The token is not
 * stored and cannot be recovered later; resending makes a new one. An earlier
 * unanswered invitation to the same address is withdrawn, so only one link per
 * person is ever live.
 */
export const createInvitation = async (params: {
  businessId: string;
  actorUserId: string;
  email: string;
  role: string;
}) => {
  if (!isInvitableRole(params.role)) throw new TeamError("invalid_role");
  const role = params.role;
  const email = normalizeEmail(params.email);
  const token = generateInvitationToken();
  const now = new Date();

  const invitation = await prisma.$transaction(async (tx) => {
    await lockBusinessTeam(tx, params.businessId);
    await assertOwner(tx, params.businessId, params.actorUserId);

    const existingMember = await tx.membership.findFirst({
      where: { businessId: params.businessId, user: { email } },
      select: { id: true }
    });
    if (existingMember) throw new TeamError("already_member");

    await tx.invitation.updateMany({
      where: { businessId: params.businessId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now }
    });

    const created = await tx.invitation.create({
      data: {
        businessId: params.businessId,
        email,
        role,
        tokenHash: hashInvitationToken(token),
        invitedByUserId: params.actorUserId,
        expiresAt: new Date(now.getTime() + TTL_MS)
      }
    });
    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.actorUserId,
      entityType: "Invitation",
      entityId: created.id,
      action: "CREATE",
      after: { email, role, expiresAt: created.expiresAt }
    });
    return created;
  });

  return { invitation, token };
};

/** Issues a fresh link for an unanswered invitation. The previous link stops working. */
export const resendInvitation = async (params: { businessId: string; actorUserId: string; invitationId: string }) => {
  const token = generateInvitationToken();
  const now = new Date();

  const invitation = await prisma.$transaction(async (tx) => {
    await lockBusinessTeam(tx, params.businessId);
    await assertOwner(tx, params.businessId, params.actorUserId);

    const existing = await tx.invitation.findFirst({
      where: { id: params.invitationId, businessId: params.businessId }
    });
    if (!existing) throw new TeamError("not_found");
    if (existing.acceptedAt) throw new TeamError("invitation_used");
    if (existing.revokedAt) throw new TeamError("invitation_revoked");

    const updated = await tx.invitation.update({
      where: { id: existing.id },
      data: { tokenHash: hashInvitationToken(token), expiresAt: new Date(now.getTime() + TTL_MS) }
    });
    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.actorUserId,
      entityType: "Invitation",
      entityId: updated.id,
      action: "RESEND",
      before: { expiresAt: existing.expiresAt },
      after: { email: updated.email, role: updated.role, expiresAt: updated.expiresAt }
    });
    return updated;
  });

  return { invitation, token };
};

export const revokeInvitation = async (params: { businessId: string; actorUserId: string; invitationId: string }) =>
  prisma.$transaction(async (tx) => {
    await lockBusinessTeam(tx, params.businessId);
    await assertOwner(tx, params.businessId, params.actorUserId);

    const existing = await tx.invitation.findFirst({
      where: { id: params.invitationId, businessId: params.businessId }
    });
    if (!existing) throw new TeamError("not_found");
    if (existing.acceptedAt) throw new TeamError("invitation_used");
    if (existing.revokedAt) return existing;

    const revoked = await tx.invitation.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.actorUserId,
      entityType: "Invitation",
      entityId: revoked.id,
      action: "REVOKE",
      before: { email: existing.email, role: existing.role }
    });
    return revoked;
  });

export type PendingInvitation = {
  id: string;
  email: string;
  role: InvitableRole;
  expiresAt: Date;
  createdAt: Date;
  expired: boolean;
};

/** Unanswered invitations, including expired ones so the owner can resend or clear them. */
export const listPendingInvitations = async (businessId: string): Promise<PendingInvitation[]> => {
  const now = new Date();
  const rows = await prisma.invitation.findMany({
    where: { businessId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }
  });
  return rows.map((row) => ({ ...row, role: invitedRole(row.role), expired: row.expiresAt <= now }));
};

// ─── Invited person's side ────────────────────────────────────────────────────

export type InvitationView = {
  status: InvitationStatus;
  email: string;
  role: InvitableRole;
  businessId: string;
  businessName: string;
  inviterName: string | null;
  expiresAt: Date;
  /** True when a confirmed account exists for the invited address, so the person signs in rather than registers. */
  hasAccount: boolean;
};

/** What the invitation page shows. Null when the token matches nothing. */
export const lookupInvitation = async (token: string): Promise<InvitationView | null> => {
  if (!token || token.length < 32 || token.length > 128) return null;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { business: { select: { name: true } } }
  });
  if (!invitation) return null;

  const [inviter, account] = await Promise.all([
    invitation.invitedByUserId
      ? prisma.user.findUnique({ where: { id: invitation.invitedByUserId }, select: { fullName: true, email: true } })
      : null,
    prisma.user.findUnique({ where: { email: invitation.email }, select: { emailVerifiedAt: true, isActive: true } })
  ]);

  return {
    status: invitationStatus(invitation),
    email: invitation.email,
    role: invitedRole(invitation.role),
    businessId: invitation.businessId,
    businessName: invitation.business.name,
    inviterName: inviter?.fullName || inviter?.email || null,
    expiresAt: invitation.expiresAt,
    hasAccount: Boolean(account?.emailVerifiedAt)
  };
};

type AcceptResult = { businessId: string; role: string; membershipId: string; userId: string };

const acceptInTransaction = async (
  tx: Db,
  token: string,
  resolveUser: (invitation: { email: string }) => Promise<{ id: string; email: string; isActive: boolean; emailVerifiedAt: Date | null }>
): Promise<AcceptResult> => {
  const invitation = await tx.invitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } });
  if (!invitation) throw new TeamError("invalid_invitation");
  assertPending(invitation);

  const user = await resolveUser(invitation);
  if (!user.isActive) throw new TeamError("email_mismatch");
  // The invitation belongs to one address. Being signed in as anyone else,
  // even with the link in hand, is not enough.
  if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) throw new TeamError("email_mismatch");

  // Single use: the claim only succeeds while the row is still unanswered, so
  // of two simultaneous attempts exactly one gets through.
  const now = new Date();
  const claimed = await tx.invitation.updateMany({
    where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { acceptedAt: now }
  });
  if (claimed.count !== 1) throw new TeamError("invitation_used");

  const existing = await tx.membership.findUnique({
    where: { userId_businessId: { userId: user.id, businessId: invitation.businessId } }
  });
  // Someone who already has access keeps the role they have.
  const membership =
    existing ??
    (await tx.membership.create({
      data: { userId: user.id, businessId: invitation.businessId, role: invitedRole(invitation.role) }
    }));

  if (!user.emailVerifiedAt) {
    // The link was delivered to this address, which is what confirmation proves.
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now, emailVerificationToken: null } });
  }

  await writeLedgerAudit(tx, {
    businessId: invitation.businessId,
    userId: user.id,
    entityType: "Invitation",
    entityId: invitation.id,
    action: "ACCEPT",
    after: { email: invitation.email, role: membership.role, membershipId: membership.id }
  });
  if (!existing) {
    await writeLedgerAudit(tx, {
      businessId: invitation.businessId,
      userId: user.id,
      entityType: "Membership",
      entityId: membership.id,
      action: "CREATE",
      after: { userId: user.id, email: invitation.email, role: membership.role, invitationId: invitation.id }
    });
  }

  return { businessId: invitation.businessId, role: membership.role, membershipId: membership.id, userId: user.id };
};

/** A signed-in person accepts. Fails unless their account's email is the invited one. */
export const acceptInvitation = async (params: { token: string; userId: string }): Promise<AcceptResult> =>
  prisma.$transaction((tx) =>
    acceptInTransaction(tx, params.token, async () => {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { id: true, email: true, isActive: true, emailVerifiedAt: true }
      });
      if (!user) throw new TeamError("email_mismatch");
      return user;
    })
  );

/**
 * Someone without an account accepts: the account is created for the invited
 * address (taken from the invitation, never from the request), already
 * confirmed, and with no business of its own. Its only membership is the one
 * the invitation grants.
 */
export const registerWithInvitation = async (params: {
  token: string;
  fullName: string;
  password: string;
}): Promise<AcceptResult> => {
  const passwordHash = await hashPassword(params.password);
  const fullName = params.fullName.trim();

  try {
    return await prisma.$transaction((tx) =>
      acceptInTransaction(tx, params.token, async (invitation) => {
        const email = normalizeEmail(invitation.email);
        const existing = await tx.user.findUnique({
          where: { email },
          select: { id: true, emailVerifiedAt: true, isActive: true }
        });
        // A confirmed account is never taken over through an invitation; its owner signs in.
        if (existing?.emailVerifiedAt) throw new TeamError("account_exists");

        const select = { id: true, email: true, isActive: true, emailVerifiedAt: true } as const;
        if (existing) {
          // Registered earlier but never confirmed. Whoever holds this link
          // controls the mailbox, so the account becomes theirs: new password,
          // and any session started before now is ended.
          await tx.session.deleteMany({ where: { userId: existing.id } });
          return tx.user.update({
            where: { id: existing.id },
            data: { passwordHash, fullName, emailVerifiedAt: new Date(), emailVerificationToken: null },
            select
          });
        }
        return tx.user.create({
          data: { email, passwordHash, fullName, emailVerifiedAt: new Date() },
          select
        });
      })
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TeamError("account_exists");
    }
    throw error;
  }
};
