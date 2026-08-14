import { and, eq } from "drizzle-orm";
import { db, projects } from "@workspace/db";

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProjectBoundary = "not_found" | "archived" | { status: string };

/**
 * Tenant-scoped project existence and archival check shared by verticals
 * whose access rules are exactly "missing is not found, archived is
 * terminal". Callers wrap the result in their own error classes so their
 * HTTP envelopes stay unchanged.
 */
export async function fetchProjectBoundary(
  tx: DbTx,
  scope: { organisationId: string; projectId: string },
): Promise<ProjectBoundary> {
  const [project] = await tx
    .select({ status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(1);
  if (!project) return "not_found";
  if (project.status === "archived") return "archived";
  return { status: project.status };
}
