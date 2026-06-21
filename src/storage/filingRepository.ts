import type {
  DisclosureFiling,
  FilingParseStatus,
} from "../types/disclosure.js";
import { getDatabase } from "./db.js";

export function filingExists(id: string): boolean {
  return Boolean(
    getDatabase().prepare("SELECT 1 FROM filings WHERE id = ?").get(id),
  );
}

export function insertPendingFiling(filing: DisclosureFiling): boolean {
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO filings (
        id, source, source_filing_id, politician_name, chamber, filing_type,
        filing_date, document_url, document_kind, parse_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      filing.id,
      filing.source,
      filing.sourceFilingId,
      filing.politicianName,
      filing.chamber,
      filing.filingType,
      filing.filingDate,
      filing.documentUrl,
      filing.documentKind,
      now,
      now,
    );
  return result.changes === 1;
}

export function updateFilingStatus(
  id: string,
  status: FilingParseStatus,
  details: {
    documentHash?: string;
    rawPdfPath?: string;
    parseError?: string;
  } = {},
): void {
  getDatabase()
    .prepare(
      `UPDATE filings
       SET parse_status = ?, document_hash = COALESCE(?, document_hash),
           raw_pdf_path = ?, parse_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      details.documentHash ?? null,
      details.rawPdfPath ?? null,
      details.parseError ?? null,
      new Date().toISOString(),
      id,
    );
}

export function countFilings(): number {
  return (
    getDatabase().prepare("SELECT COUNT(*) AS count FROM filings").get() as {
      count: number;
    }
  ).count;
}
