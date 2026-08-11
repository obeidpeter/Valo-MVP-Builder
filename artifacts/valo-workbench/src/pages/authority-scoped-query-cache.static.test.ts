import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clientActionSource = readFileSync(
  new URL("./client-action-portal-route.tsx", import.meta.url),
  "utf8",
);
const consortiumSource = readFileSync(
  new URL("./partner-consortium-room-route.tsx", import.meta.url),
  "utf8",
);
const operationsSource = readFileSync(
  new URL("./pursuit-operations-suite-route.tsx", import.meta.url),
  "utf8",
);

function sourceBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("authority-scoped query caches", () => {
  it("partitions Client Action reads by actor and capability state", () => {
    const snapshotBlock = sourceBlock(
      clientActionSource,
      "const queryKey = [",
      "const authorityQueryKey = [",
    );
    const authorityBlock = sourceBlock(
      clientActionSource,
      "const authorityQueryKey = [",
      "const mutation = useMutation",
    );
    expect(snapshotBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(snapshotBlock).toContain("enabled: canView && Boolean(actorUserId)");
    expect(authorityBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(authorityBlock).toMatch(
      /activeScope\.current\.actorUserId !==\s*requestedScope\.actorUserId/u,
    );
    expect(authorityBlock).toMatch(
      /activeScope\.current\.capabilityKey !==\s*requestedScope\.capabilityKey/u,
    );
    expect(clientActionSource).toContain(
      "key={`${organisationId}:${projectId}:${actorUserId}:${capabilityKey}`}",
    );
  });

  it("partitions consortium rooms and participant names by current authority", () => {
    const participantBlock = sourceBlock(
      consortiumSource,
      "const participantQueryKey = [",
      "const mutation = useMutation",
    );
    expect(participantBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(participantBlock).toMatch(
      /activeScope\.current\.actorUserId !==\s*requestedScope\.actorUserId/u,
    );
    expect(participantBlock).toMatch(
      /activeScope\.current\.capabilityKey !==\s*requestedScope\.capabilityKey/u,
    );
    expect(participantBlock).toContain(
      "enabled: canView && canWrite && Boolean(actorUserId)",
    );
    expect(consortiumSource).toContain(
      "key={`${organisationId}:${projectId}:${relationshipId}:${actorUserId}:${capabilityKey}`}",
    );
  });

  it("requires a named actor and readable-kind fingerprint for the mobile queue", () => {
    const suiteBlock = sourceBlock(
      operationsSource,
      "const suiteQuery = useQuery",
      "const mobileQueueQuery = useQuery",
    );
    const mobileBlock = sourceBlock(
      operationsSource,
      "const mobileQueueQuery = useQuery",
      "const packageVersionQuery = useQuery",
    );
    const mutationScopeBlock = sourceBlock(
      operationsSource,
      "const activeMutationScope = useRef",
      "const refreshAfterMutation",
    );
    expect(suiteBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(suiteBlock).toContain("readScopeIsCurrent(requestedScope)");
    expect(mobileBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(mobileBlock).toContain(
      "enabled: Boolean(compactMode && canRead && projectId && actorUserId)",
    );
    expect(mobileBlock).toContain("readScopeIsCurrent(requestedScope)");
    expect(mutationScopeBlock).toMatch(
      /activeMutationScope\.current\.actorUserId !==\s*requestedScope\.actorUserId/u,
    );
    expect(mutationScopeBlock).toMatch(
      /activeMutationScope\.current\.capabilityKey !==\s*requestedScope\.capabilityKey/u,
    );
    expect(operationsSource).toContain(
      "key={`${organisationId}:${projectId}:${actorUserId}:${capabilityKey}`}",
    );
    expect(
      operationsSource.match(/(?:^|\s)disabled=\{operationPending\}/gu),
    ).toHaveLength(1);
    expect(operationsSource).toContain("aria-disabled={operationPending}");
    expect(operationsSource).toMatch(
      /if \(projectsQuery\.isLoading \|\| meQuery\.isLoading\)/u,
    );
  });
});
