import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { buildProjectExportZip } from "./projectExportArchive";

test("project export ZIP is complete and readable before it is returned", async () => {
  const archive = await buildProjectExportZip([
    { filename: "project.json", bytes: Buffer.from('{"status":"exported"}') },
    {
      filename: "requirements.csv",
      bytes: Buffer.from("id,status\n1,ready\n"),
    },
  ]);

  const zip = await JSZip.loadAsync(archive);
  assert.deepEqual(Object.keys(zip.files).sort(), [
    "project.json",
    "requirements.csv",
  ]);
  assert.equal(
    await zip.file("project.json")!.async("string"),
    '{"status":"exported"}',
  );
  assert.equal(
    await zip.file("requirements.csv")!.async("string"),
    "id,status\n1,ready\n",
  );
});
