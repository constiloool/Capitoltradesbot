import * as cheerio from "cheerio";
import { config } from "../config.js";
import type {
  DisclosureFiling,
  SourceFetchResult,
} from "../types/disclosure.js";
import { cleanText } from "../utils/normalize.js";
import type { DisclosureSourceAdapter } from "./sourceAdapter.js";

const BASE_URL = "https://efdsearch.senate.gov";

function extractCsrf(html: string): string {
  const $ = cheerio.load(html);
  return $('input[name="csrfmiddlewaretoken"]').attr("value") || "";
}

function mergeCookies(current: string, response: Response): string {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""];
  const jar = new Map<string, string>();
  for (const part of current.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name && value) jar.set(name, value);
  }
  for (const header of values) {
    const pair = header.split(";", 1)[0];
    const [name, value] = pair.split("=", 2);
    if (name && value) jar.set(name.trim(), value.trim());
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function isoDate(value: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match
    ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`
    : value;
}

function htmlText(value: unknown): string {
  return cleanText(cheerio.load(String(value ?? "")).text());
}

export class SenateDisclosureSource implements DisclosureSourceAdapter {
  async fetchFilings(): Promise<SourceFetchResult> {
    let cookies = "";
    const home = await fetch(`${BASE_URL}/search/home/`, {
      headers: { "user-agent": config.userAgent },
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    });
    if (!home.ok) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: `Senate eFD unavailable (HTTP ${home.status})`,
      };
    }
    cookies = mergeCookies(cookies, home);
    const homeHtml = await home.text();
    const homeCsrf = extractCsrf(homeHtml);
    if (!homeCsrf) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: "Senate eFD agreement page did not provide a CSRF token",
      };
    }

    const agreement = await fetch(`${BASE_URL}/search/home/`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookies,
        referer: `${BASE_URL}/search/home/`,
        "user-agent": config.userAgent,
      },
      body: new URLSearchParams({
        csrfmiddlewaretoken: homeCsrf,
        prohibition_agreement: "1",
      }),
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    });
    cookies = mergeCookies(cookies, agreement);
    if (![200, 302].includes(agreement.status)) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: `Senate eFD agreement failed (HTTP ${agreement.status})`,
      };
    }

    const searchPage = await fetch(`${BASE_URL}/search/`, {
      headers: { cookie: cookies, "user-agent": config.userAgent },
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    });
    cookies = mergeCookies(cookies, searchPage);
    if (!searchPage.ok) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: `Senate eFD search page unavailable (HTTP ${searchPage.status})`,
      };
    }
    const csrf = extractCsrf(await searchPage.text());
    if (!csrf) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: "Senate eFD search page did not provide a CSRF token",
      };
    }

    const currentYear = new Date().getUTCFullYear();
    const response = await fetch(`${BASE_URL}/search/report/data/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        cookie: cookies,
        referer: `${BASE_URL}/search/`,
        "user-agent": config.userAgent,
        "x-csrftoken": csrf,
        "x-requested-with": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        csrfmiddlewaretoken: csrf,
        draw: "1",
        start: "0",
        length: String(config.maxFilingsPerRun),
        report_types: "[11]",
        filer_types: "[]",
        submitted_start_date: `01/01/${currentYear}`,
        submitted_end_date: `12/31/${currentYear}`,
        candidate_state: "",
        senator_state: "",
        office_id: "",
        first_name: "",
        last_name: "",
      }),
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    });
    if (!response.ok) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: `Senate eFD report search failed (HTTP ${response.status})`,
      };
    }

    const payload = (await response.json()) as {
      recordsFiltered?: number;
      data?: unknown[][];
    };
    const filings: DisclosureFiling[] = [];
    for (const row of payload.data ?? []) {
      const joined = row.map(String).join(" ");
      const href = joined.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const id = href.match(/\/(ptr|paper)\/([^/]+)/i)?.[2];
      if (!id) continue;
      const values = row.map(htmlText);
      const filingDate =
        values.find((item) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item)) || "";
      const reportType =
        values.find((item) => /Periodic Transaction/i.test(item)) ||
        "Periodic Transaction Report";
      const politicianName =
        values.find(
          (item) =>
            item &&
            item !== filingDate &&
            item !== reportType &&
            !/Senator|Candidate/i.test(item),
        ) || "Unknown";
      filings.push({
        id: `senate:${id}`,
        source: "senate",
        sourceFilingId: id,
        politicianName,
        chamber: "Senate",
        filingType: reportType,
        filingDate: isoDate(filingDate),
        documentUrl: new URL(href, BASE_URL).toString(),
        documentKind: href.includes("/paper/") ? "pdf" : "html",
        requestHeaders: { cookie: cookies, referer: `${BASE_URL}/search/` },
      });
    }
    return {
      source: "senate",
      checked: payload.recordsFiltered ?? filings.length,
      filings: filings.slice(0, config.maxFilingsPerRun),
    };
  }
}
