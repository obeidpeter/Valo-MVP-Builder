import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./clientActionPortal.ts", import.meta.url),
  "utf8",
);

test("client actions require direct membership, named permissions and private responses", () => {
  assert.match(source, /access\?\.source !== "membership"/u);
  assert.match(source, /requirePermissionOrLegacy\("evidence:approve"\)/u);
  assert.match(source, /requirePermissionOrLegacy\("package:export"\)/u);
  assert.match(
    source,
    /"\/projects\/:id\/client-actions\/authorities"[\s\S]*requirePermissionOrLegacy\("evidence:write"\)/u,
  );
  assert.match(source, /authorityDirectory\.list\([\s\S]*authorities \+ 1/u);
  assert.match(source, /Cache-Control", "private, no-store"/u);
});

test("client action route has no raw upload, message-send or package-transfer endpoint", () => {
  assert.doesNotMatch(
    source,
    /upload-url|signed-url|send-message|send-email|whatsapp/iu,
  );
  assert.match(source, /rawUploadPerformedByThisRoute: false/u);
  assert.match(source, /externalPackageDeliveryPerformedByValo: false/u);
});
