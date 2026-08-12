import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("work-inbox SQL bounds and authorizes before projecting", async () => {
  const source = await readFile(
    new URL("./repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /LIMIT \$\{limit \+ 1\}/u);
  assert.match(source, /owner_membership_id = \$\{authority\.membershipId\}/u);
  assert.match(source, /delegateUserId.*authority\.actorUserId/su);
  assert.match(source, /ownerUserId.*authority\.actorUserId/su);
  assert.match(source, /code_units > \$\{MAX_ENVELOPE_CODE_UNITS\}/u);
  assert.match(source, /project\.status <> 'archived'/u);
  assert.match(source, /project_status NOT IN \('signed_off', 'exported'\)/u);
  assert.match(source, /WORK_INBOX_NATIVE_CANDIDATE_LIMIT \+ 1/u);
  assert.match(source, /candidate_guard\.candidate_count >/u);
  assert.match(
    source,
    /left\(task\.title, length\('\[OPS:work_item\]'\)\) = '\[OPS:work_item\]'/u,
  );
  assert.match(
    source,
    /left\(task\.title, length\('\[OPS:mission\]'\)\) = '\[OPS:mission\]'/u,
  );
  assert.match(
    source,
    /left\(task\.title, length\('\[OPS:post_award_item\]'\)\) = '\[OPS:post_award_item\]'/u,
  );
  assert.doesNotMatch(source, /task\.title LIKE '\[OPS:%'/u);
  assert.match(
    source,
    /project_status NOT IN \('signed_off', 'exported'\)[\s\S]*OR envelope #>> '\{record,kind\}' = 'post_award_item'/u,
  );
  const nativeAt = source.indexOf("native_candidates AS MATERIALIZED");
  const guardAt = source.indexOf("candidate_guard AS MATERIALIZED", nativeAt);
  const descriptionAt = source.indexOf(
    "char_length(task.description)",
    guardAt,
  );
  assert.ok(nativeAt >= 0 && guardAt > nativeAt && descriptionAt > guardAt);
});
