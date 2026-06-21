import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../config.js";
import type { DisclosureFiling } from "../types/disclosure.js";

export type DownloadedDocument = {
  content: Buffer;
  documentHash: string;
  storedPath?: string;
  cleanup(): Promise<void>;
};

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function deterministicName(filing: DisclosureFiling): string {
  const extension = filing.documentKind === "pdf" ? "pdf" : "html";
  return `${filing.source}_${filing.sourceFilingId}_${filing.filingDate}_${slug(
    filing.politicianName,
  )}.${extension}`;
}

export async function downloadDocument(
  filing: DisclosureFiling,
): Promise<DownloadedDocument> {
  const response = await fetch(filing.documentUrl, {
    headers: { "user-agent": config.userAgent, ...filing.requestHeaders },
    signal: AbortSignal.timeout(config.downloadTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Document download failed (HTTP ${response.status})`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (!content.length) throw new Error("Downloaded document is empty");
  const documentHash = createHash("sha256").update(content).digest("hex");

  if (config.storeRawPdfs) {
    await mkdir(config.rawPdfDir, { recursive: true });
    const storedPath = path.join(config.rawPdfDir, deterministicName(filing));
    await writeFile(storedPath, content);
    return { content, documentHash, storedPath, cleanup: async () => undefined };
  }

  const directory = await mkdtemp(path.join(tmpdir(), "capitol-disclosure-"));
  const temporaryPath = path.join(directory, deterministicName(filing));
  await writeFile(temporaryPath, content);
  return {
    content: await readFile(temporaryPath),
    documentHash,
    cleanup: async () => rm(directory, { recursive: true, force: true }),
  };
}

export async function cleanupRetainedDocuments(): Promise<number> {
  if (!config.storeRawPdfs) return 0;
  await mkdir(config.rawPdfDir, { recursive: true });
  const cutoff = Date.now() - config.pdfRetentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of await readdir(config.rawPdfDir)) {
    const file = path.join(config.rawPdfDir, name);
    const info = await stat(file);
    if (info.isFile() && info.mtimeMs < cutoff) {
      await rm(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}
