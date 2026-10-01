import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";

/**
 * Local-disk file storage (a Docker volume in deployment). Files are never served statically:
 * routes stream them after authentication. Keys are relative paths such as "documents/2026/09/<uuid>.pdf".
 */
export const storage = {
  root(): string {
    return config().uploads.dir;
  },

  tmpDir(): string {
    return path.join(storage.root(), "tmp");
  },

  async init(): Promise<void> {
    for (const dir of ["tmp", "documents", "voice"])
      await fs.mkdir(path.join(storage.root(), dir), { recursive: true });
    const probe = path.join(storage.tmpDir(), `.probe-${randomUUID()}`);
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
  },

  async isWritable(): Promise<boolean> {
    try {
      await storage.init();
      return true;
    } catch {
      return false;
    }
  },

  /** Absolute path for a key; rejects anything that would escape the storage root. */
  resolve(key: string): string {
    const root = path.resolve(storage.root());
    const absolute = path.resolve(root, key);
    if (absolute === root || !absolute.startsWith(root + path.sep))
      throw new Error("Invalid storage key");
    return absolute;
  },

  newKey(
    kind: "documents" | "voice",
    extension: string,
    name: string = randomUUID()
  ): string {
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${kind}/${now.getUTCFullYear()}/${month}/${name}${extension}`;
  },

  /** Moves an uploaded temp file into permanent storage. */
  async moveIn(tempPath: string, key: string): Promise<void> {
    const destination = storage.resolve(key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.rename(tempPath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await fs.copyFile(tempPath, destination);
      await fs.unlink(tempPath);
    }
  },

  async remove(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await fs.unlink(storage.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(storage.resolve(key));
      return true;
    } catch {
      return false;
    }
  },

  /** Deletes temp files older than `maxAgeMs`. Returns the number removed. */
  async sweepTemp(maxAgeMs: number): Promise<number> {
    let removed = 0;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(storage.tmpDir());
    } catch {
      return 0;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      const file = path.join(storage.tmpDir(), entry);
      try {
        const stat = await fs.stat(file);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fs.unlink(file);
          removed += 1;
        }
      } catch {
        /* file vanished meanwhile */
      }
    }
    return removed;
  },
};

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", chunk => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export async function removeQuietly(
  filePath: string | undefined
): Promise<void> {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    /* already gone */
  }
}
