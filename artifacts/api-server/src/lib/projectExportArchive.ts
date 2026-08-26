import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import type { Archiver, ArchiverOptions } from "archiver";

const nodeRequire = createRequire(import.meta.url);
const { ZipArchive } = nodeRequire("archiver") as {
  ZipArchive: new (options?: ArchiverOptions) => Archiver;
};

export interface ProjectExportZipEntry {
  readonly filename: string;
  readonly bytes: Buffer;
}

/**
 * Completes the archive in memory before callers persist release evidence or
 * expose response headers. Any compression/archiver failure therefore remains
 * a normal request failure rather than a durable-but-undeliverable export.
 */
export async function buildProjectExportZip(
  entries: readonly ProjectExportZipEntry[],
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    output.once("end", () => resolve(Buffer.concat(chunks)));
    output.once("error", reject);
  });
  // Append/pipe can fail synchronously before Promise.all attaches below.
  // Register a rejection observer now so cleanup cannot produce an unhandled
  // stream rejection; awaiting `completed` still preserves the failure.
  void completed.catch(() => undefined);

  archive.once("error", (error) => output.destroy(error));
  archive.once("warning", (warning) => output.destroy(warning));

  try {
    archive.pipe(output);
    for (const entry of entries) {
      archive.append(entry.bytes, { name: entry.filename });
    }
    const [buffer] = await Promise.all([completed, archive.finalize()]);
    return buffer;
  } catch (error) {
    void archive.abort();
    output.destroy(
      error instanceof Error
        ? error
        : new Error("Project export archive assembly failed"),
    );
    throw error;
  }
}
