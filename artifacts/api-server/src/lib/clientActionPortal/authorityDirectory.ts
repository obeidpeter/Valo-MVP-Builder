import { and, asc, eq } from "drizzle-orm";
import {
  currentTenantDatabaseOrganisation,
  db,
  organisationMemberships,
  organisations,
  projects,
  users,
} from "@workspace/db";
import {
  CLIENT_ACTION_BOUNDS,
  type ClientActionAuthorityOption,
  type ClientActionScope,
} from "./contracts";
import { ClientActionError } from "./errors";
import {
  CLIENT_ACTION_CREATOR_ROLES,
  clientActionAuthorityPredicate,
  clientActionRecipientPredicate,
  validClientActionAuthorityName,
} from "./authorityPolicy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function denied(message: string): never {
  throw new ClientActionError("scope_denied", message);
}

function assertScope(scope: ClientActionScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.projectId) ||
    !UUID_PATTERN.test(scope.actorUserId) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    denied("Client action authority-directory scope denied.");
  }
}

export interface ClientActionAuthorityDirectorySource {
  list(
    scope: ClientActionScope,
    limit: number,
  ): Promise<readonly ClientActionAuthorityOption[]>;
}

export class DrizzleClientActionAuthorityDirectory implements ClientActionAuthorityDirectorySource {
  async list(
    scope: ClientActionScope,
    limit: number,
  ): Promise<readonly ClientActionAuthorityOption[]> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > CLIENT_ACTION_BOUNDS.authorities + 1
    ) {
      denied("Client action authority-directory bound denied.");
    }
    const now = new Date();
    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, scope.projectId),
          eq(projects.organisationId, scope.organisationId),
        ),
      )
      .limit(2);
    if (projectRows.length !== 1) denied("Project access denied.");

    const actorRows = await db
      .select({
        membershipId: organisationMemberships.id,
        name: users.name,
      })
      .from(organisationMemberships)
      .innerJoin(users, eq(users.id, organisationMemberships.userId))
      .innerJoin(
        organisations,
        eq(organisations.id, organisationMemberships.organisationId),
      )
      .where(
        and(
          clientActionAuthorityPredicate(
            db,
            scope,
            now,
            CLIENT_ACTION_CREATOR_ROLES,
          ),
          eq(organisationMemberships.userId, scope.actorUserId),
        ),
      )
      .limit(2);
    if (
      actorRows.length !== 1 ||
      !validClientActionAuthorityName(actorRows[0]!.name)
    ) {
      denied("Named request creator denied.");
    }

    const rows = await db
      .select({
        membershipId: organisationMemberships.id,
        userId: users.id,
        name: users.name,
      })
      .from(organisationMemberships)
      .innerJoin(users, eq(users.id, organisationMemberships.userId))
      .innerJoin(
        organisations,
        eq(organisations.id, organisationMemberships.organisationId),
      )
      .where(clientActionRecipientPredicate(db, scope, now))
      .orderBy(asc(users.name), asc(users.id), asc(organisationMemberships.id))
      .limit(limit);
    const seen = new Set<string>();
    return rows.map((row) => {
      if (seen.has(row.userId) || !validClientActionAuthorityName(row.name)) {
        denied(
          "Client action authority directory failed its named-member policy.",
        );
      }
      seen.add(row.userId);
      return { userId: row.userId, name: row.name };
    });
  }
}
