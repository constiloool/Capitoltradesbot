import * as cheerio from "cheerio";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { config } from "../config.js";
import type {
  DisclosureFiling,
  SourceFetchResult,
} from "../types/disclosure.js";
import { logger } from "../utils/logger.js";
import { cleanText } from "../utils/normalize.js";
import type { DisclosureSourceAdapter } from "./sourceAdapter.js";

const BASE_URL = "https://efdsearch.senate.gov";
const SEARCH_HOME_URL = `${BASE_URL}/search/home/`;
const SEARCH_URL = `${BASE_URL}/search/`;
const REPORT_DATA_URL = `${BASE_URL}/search/report/data/`;

const DEFAULT_HEADERS = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

const REPORT_COLUMNS = [
  "last_name",
  "first_name",
  "office",
  "report_type",
  "date_received",
  "view_report",
];

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...DEFAULT_HEADERS,
    "user-agent": config.userAgent,
    ...extra,
  };
}

export function senateReportSearchParams(options: {
  csrf: string;
  start?: number;
  length?: number;
  currentYear?: number;
  lastName?: string;
}): URLSearchParams {
  const currentYear = options.currentYear ?? new Date().getUTCFullYear();
  const body = new URLSearchParams({
    csrfmiddlewaretoken: options.csrf,
    draw: "1",
    start: String(options.start ?? 0),
    length: String(options.length ?? config.maxFilingsPerRun),
    "search[value]": "",
    "search[regex]": "false",
    "order[0][column]": "4",
    "order[0][dir]": "desc",
    report_types: "[11]",
    filer_types: "[]",
    submitted_start_date: `01/01/${currentYear}`,
    submitted_end_date: `12/31/${currentYear}`,
    candidate_state: "",
    senator_state: "",
    office_id: "",
    first_name: "",
    last_name: options.lastName ?? "",
  });
  REPORT_COLUMNS.forEach((column, index) => {
    body.set(`columns[${index}][data]`, String(index));
    body.set(`columns[${index}][name]`, column);
    body.set(`columns[${index}][searchable]`, "true");
    body.set(`columns[${index}][orderable]`, index === 5 ? "false" : "true");
    body.set(`columns[${index}][search][value]`, "");
    body.set(`columns[${index}][search][regex]`, "false");
  });
  return body;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, init);
    if (![429, 500, 502, 503, 504].includes(response.status)) {
      return response;
    }
    lastResponse = response;
    if (attempt < 3) {
      await response.arrayBuffer().catch(() => undefined);
      await sleep(750 * attempt + Math.floor(Math.random() * 500));
    }
  }
  if (lastResponse) return lastResponse;
  throw new Error(`${label} failed before receiving a response`);
}

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

type SenateReportPayload = {
  recordsFiltered?: number;
  data?: unknown[][];
};

async function fetchReportPayload(
  csrf: string,
  cookies: string,
): Promise<{ payload?: SenateReportPayload; error?: string }> {
  const response = await fetchWithRetry(REPORT_DATA_URL, {
    method: "POST",
    headers: headers({
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie: cookies,
      origin: BASE_URL,
      referer: SEARCH_URL,
      "x-csrftoken": csrf,
      "x-requested-with": "XMLHttpRequest",
    }),
    body: senateReportSearchParams({ csrf }),
    signal: AbortSignal.timeout(config.downloadTimeoutMs),
  }, "Senate eFD report search");
  if (response.ok) {
    return { payload: (await response.json()) as SenateReportPayload };
  }

  logger.warn("SOURCE", "Senate eFD direct report search failed; trying browser fallback", {
    status: response.status,
  });
  try {
    return { payload: await browserReportPayload() };
  } catch (error) {
    logger.warn("SOURCE", "Senate eFD browser fallback failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { error: `Senate eFD report search failed (HTTP ${response.status})` };
  }
}

async function browserReportPayload(): Promise<SenateReportPayload> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: config.userAgent,
      extraHTTPHeaders: {
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const page = await context.newPage();
    await page.goto(SEARCH_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.downloadTimeoutMs,
    });
    const homeCsrf = await page
      .locator('input[name="csrfmiddlewaretoken"]')
      .first()
      .getAttribute("value", { timeout: config.downloadTimeoutMs });
    if (!homeCsrf) throw new Error("Browser fallback did not find agreement CSRF token");

    const agreement = await context.request.post(SEARCH_HOME_URL, {
      form: {
        csrfmiddlewaretoken: homeCsrf,
        prohibition_agreement: "1",
      },
      headers: {
        origin: BASE_URL,
        referer: SEARCH_HOME_URL,
      },
      maxRedirects: 0,
      timeout: config.downloadTimeoutMs,
    });
    if (![200, 302].includes(agreement.status())) {
      throw new Error(`Browser fallback agreement failed (HTTP ${agreement.status()})`);
    }

    await page.goto(SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.downloadTimeoutMs,
    });
    const csrf = await page
      .locator('input[name="csrfmiddlewaretoken"]')
      .first()
      .getAttribute("value", { timeout: config.downloadTimeoutMs });
    if (!csrf) throw new Error("Browser fallback did not find search CSRF token");

    const response = await context.request.post(REPORT_DATA_URL, {
      form: Object.fromEntries(senateReportSearchParams({ csrf })),
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        origin: BASE_URL,
        referer: SEARCH_URL,
        "x-csrftoken": csrf,
        "x-requested-with": "XMLHttpRequest",
      },
      timeout: config.downloadTimeoutMs,
    });
    if (!response.ok()) {
      throw new Error(`Browser fallback report search failed (HTTP ${response.status()})`);
    }
    return (await response.json()) as SenateReportPayload;
  } finally {
    await browser.close();
  }
}

export class SenateDisclosureSource implements DisclosureSourceAdapter {
  async fetchFilings(): Promise<SourceFetchResult> {
    let cookies = "";
    const home = await fetchWithRetry(SEARCH_HOME_URL, {
      headers: headers(),
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    }, "Senate eFD home page");
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

    const agreement = await fetchWithRetry(SEARCH_HOME_URL, {
      method: "POST",
      redirect: "manual",
      headers: headers({
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookies,
        origin: BASE_URL,
        referer: SEARCH_HOME_URL,
      }),
      body: new URLSearchParams({
        csrfmiddlewaretoken: homeCsrf,
        prohibition_agreement: "1",
      }),
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    }, "Senate eFD agreement");
    cookies = mergeCookies(cookies, agreement);
    if (![200, 302].includes(agreement.status)) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: `Senate eFD agreement failed (HTTP ${agreement.status})`,
      };
    }

    await sleep(400 + Math.floor(Math.random() * 400));
    const searchPage = await fetchWithRetry(SEARCH_URL, {
      headers: headers({
        cookie: cookies,
        referer: SEARCH_HOME_URL,
      }),
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
    }, "Senate eFD search page");
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

    await sleep(500 + Math.floor(Math.random() * 500));
    const reportResult = await fetchReportPayload(csrf, cookies);
    if (reportResult.error || !reportResult.payload) {
      return {
        source: "senate",
        checked: 0,
        filings: [],
        error: reportResult.error ?? "Senate eFD report search returned no payload",
      };
    }

    const payload = reportResult.payload;
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
