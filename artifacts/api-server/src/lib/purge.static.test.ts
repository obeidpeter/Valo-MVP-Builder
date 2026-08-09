import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./purge.ts", import.meta.url), "utf8");

test("project blob purge includes both report render formats", () => {
  assert.match(source, /docxPath: reports\.docxPath/);
  assert.match(source, /pdfPath: reports\.pdfPath/);
  assert.match(source, /reps\.map\(\(r\) => r\.docxPath\)/);
  assert.match(source, /reps\.map\(\(r\) => r\.pdfPath\)/);
});
