import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projectsSource = readFileSync(
  new URL("./projects.ts", import.meta.url),
  "utf8",
);
const usersSource = readFileSync(
  new URL("./users.ts", import.meta.url),
  "utf8",
);

test("create and every supplied reviewer assignment revalidate under the authority lock", () => {
  assert.equal(
    projectsSource.match(/lockProjectReviewerAuthorityBoundary\(/gu)?.length,
    2,
  );
  assert.equal(
    projectsSource.match(/currentProjectReviewerAuthorityTime\(tx\)/gu)?.length,
    2,
  );
  assert.equal(projectsSource.match(/isCurrentProjectReviewer\(/gu)?.length, 2);
  assert.match(
    projectsSource,
    /parsed\.data\.reviewerId !== undefined\s*&&\s*!hasRequestPermission\(req, "project:assign"\)/u,
  );
  assert.doesNotMatch(
    projectsSource,
    /parsed\.data\.reviewerId !== existing\.reviewerId/u,
  );
  assert.match(
    projectsSource,
    /if \(updateFields\.reviewerId !== undefined\) \{[\s\S]*lockProjectReviewerAuthorityBoundary/u,
  );
});

test("directory eligibility and register reviewer identity are server-computed", () => {
  assert.match(
    usersSource,
    /reviewerEligible: hasProjectReviewerAuthority\(authority\)/u,
  );
  assert.match(projectsSource, /reviewerId: p\.reviewerId \?\? null/u);
});

test("project creation rejects controlled state and canonicalizes deadlines", () => {
  assert.match(
    projectsSource,
    /hasServerManagedProjectCreateField\(req\.body\)/u,
  );
  assert.equal(
    projectsSource.match(/canonicalProjectDeadline\(rawDeadline\)/gu)?.length,
    2,
  );
  assert.equal(
    projectsSource.match(
      /const \{ deadline: _parsedDeadline, \.\.\.parsed(?:Create|Update)Fields \} = parsed\.data/gu,
    )?.length,
    2,
  );
});
