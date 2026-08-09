import assert from "node:assert/strict";
import test from "node:test";
import { continuousAccessExpiry } from "./continuousAccess";

const date = (day: number) =>
  new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`);

test("returns undefined when no role window is active now", () => {
  assert.equal(
    continuousAccessExpiry([{ startsAt: date(11), expiresAt: null }], date(10)),
    undefined,
  );
});

test("extends current access through overlapping and adjacent role grants", () => {
  assert.deepEqual(
    continuousAccessExpiry(
      [
        { startsAt: date(1), expiresAt: date(10) },
        { startsAt: date(9), expiresAt: date(12) },
        { startsAt: date(12), expiresAt: date(14) },
      ],
      date(8),
    ),
    date(14),
  );
});

test("stops at the current role window instead of crossing a future gap", () => {
  assert.deepEqual(
    continuousAccessExpiry(
      [
        { startsAt: date(1), expiresAt: date(10) },
        { startsAt: date(11), expiresAt: null },
      ],
      date(8),
    ),
    date(10),
  );
});

test("returns null when uninterrupted role access becomes indefinite", () => {
  assert.equal(
    continuousAccessExpiry(
      [
        { startsAt: date(1), expiresAt: date(10) },
        { startsAt: date(9), expiresAt: null },
      ],
      date(8),
    ),
    null,
  );
});
