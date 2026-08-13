import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import {
  boundedSignedObjectExpiration,
  collectStreamWithLimit,
  ObjectStorageService,
  ObjectTooLargeError,
} from "./objectStorage";

test("signed upload expiry is capped by the database authority window", () => {
  const now = new Date("2026-08-13T10:00:00.000Z");
  assert.equal(
    boundedSignedObjectExpiration(
      840,
      new Date("2026-08-13T10:12:00.000Z"),
      now,
    ).toISOString(),
    "2026-08-13T10:12:00.000Z",
  );
  assert.equal(
    boundedSignedObjectExpiration(
      60,
      new Date("2026-08-13T10:12:00.000Z"),
      now,
    ).toISOString(),
    "2026-08-13T10:01:00.000Z",
  );
  assert.throws(
    () => boundedSignedObjectExpiration(840, now, now),
    /authority window is closed/u,
  );
});

async function* chunks(...values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

describe("collectStreamWithLimit", () => {
  it("returns an object at the exact byte limit", async () => {
    assert.deepEqual(
      await collectStreamWithLimit(chunks("abc", "def"), 6),
      Buffer.from("abcdef"),
    );
  });

  it("rejects as soon as the stream crosses the limit", async () => {
    await assert.rejects(
      () => collectStreamWithLimit(chunks("abc", "def"), 5),
      ObjectTooLargeError,
    );
  });
});

test("governed intake reads object bytes once and returns normalized metadata", async () => {
  let streams = 0;
  const service = new ObjectStorageService();
  Object.defineProperty(service, "getObjectEntityFile", {
    value: async () => ({
      getMetadata: async () => [
        { size: "6", contentType: " Application/PDF " },
      ],
      createReadStream: () => {
        streams += 1;
        return chunks("abc", "def");
      },
    }),
  });
  assert.deepEqual(
    await service.downloadObjectEntityForIntake(
      "/objects/tenants/ignored/uploads/ignored",
      6,
    ),
    {
      bytes: Buffer.from("abcdef"),
      contentType: "application/pdf",
      metadataSizeBytes: 6,
    },
  );
  assert.equal(streams, 1);
});

test("governed intake rejects oversized metadata before opening a stream", async () => {
  let streamed = false;
  const service = new ObjectStorageService();
  Object.defineProperty(service, "getObjectEntityFile", {
    value: async () => ({
      getMetadata: async () => [{ size: "7", contentType: "application/pdf" }],
      createReadStream: () => {
        streamed = true;
        return chunks("abcdefg");
      },
    }),
  });
  await assert.rejects(
    () =>
      service.downloadObjectEntityForIntake(
        "/objects/tenants/ignored/uploads/ignored",
        6,
      ),
    ObjectTooLargeError,
  );
  assert.equal(streamed, false);
});

test("object deletion is acknowledged only after confirmed absence", async () => {
  let deleted = false;
  const service = new ObjectStorageService();
  Object.defineProperty(service, "getObjectEntityFile", {
    value: async () => ({
      name: "private/tenants/ignored/uploads/ignored",
      bucket: {
        file: () => ({
          delete: async () => {
            deleted = true;
          },
        }),
      },
      getMetadata: async () => [{ generation: "7" }],
      exists: async () => [false],
    }),
  });
  assert.equal(
    await service.deleteObjectEntity(
      "/objects/tenants/ignored/uploads/ignored",
    ),
    true,
  );
  assert.equal(deleted, true);
});
