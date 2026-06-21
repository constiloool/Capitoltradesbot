import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { config } from "../config.js";
import type {
  DisclosureFiling,
  SourceFetchResult,
} from "../types/disclosure.js";
import { cleanText } from "../utils/normalize.js";
import type { DisclosureSourceAdapter } from "./sourceAdapter.js";

type HouseMember = {
  Prefix?: string;
  First?: string;
  Last?: string;
  Suffix?: string;
  FilingType?: string;
  FilingDate?: string;
  Year?: string | number;
  DocID?: string | number;
};

function isoDate(value: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return value;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function memberName(member: HouseMember): string {
  return cleanText(
    [member.Prefix, member.First, member.Last, member.Suffix]
      .filter(Boolean)
      .join(" ")
      .replace(/^Hon\.\s*/i, ""),
  );
}

export class HouseDisclosureSource implements DisclosureSourceAdapter {
  async fetchFilings(): Promise<SourceFetchResult> {
    const years = [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1];
    const all: DisclosureFiling[] = [];
    let checked = 0;

    for (const year of years) {
      const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.downloadTimeoutMs),
        headers: { "user-agent": config.userAgent },
      });
      if (!response.ok) {
        throw new Error(`House index download failed (HTTP ${response.status})`);
      }

      const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
      const xmlEntry = zip
        .getEntries()
        .find((entry) => entry.entryName.toLowerCase().endsWith(".xml"));
      if (!xmlEntry) throw new Error(`House index for ${year} contains no XML file`);

      const parsed = new XMLParser({ ignoreAttributes: false }).parse(
        xmlEntry.getData().toString("utf8").replace(/^\uFEFF/, ""),
      ) as { FinancialDisclosure?: { Member?: HouseMember | HouseMember[] } };
      const rawMembers = parsed.FinancialDisclosure?.Member ?? [];
      const members = Array.isArray(rawMembers) ? rawMembers : [rawMembers];
      checked += members.length;

      for (const member of members) {
        if (member.FilingType !== "P" || !member.DocID || !member.FilingDate) continue;
        const filingYear = String(member.Year || year);
        const sourceFilingId = String(member.DocID);
        all.push({
          id: `house:${sourceFilingId}`,
          source: "house",
          sourceFilingId,
          politicianName: memberName(member),
          chamber: "House",
          filingType: "Periodic Transaction Report",
          filingDate: isoDate(member.FilingDate),
          documentUrl: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filingYear}/${sourceFilingId}.pdf`,
          documentKind: "pdf",
        });
      }
    }

    const unique = [...new Map(all.map((filing) => [filing.id, filing])).values()]
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
      .slice(0, config.maxFilingsPerRun);
    return { source: "house", checked, filings: unique };
  }
}
