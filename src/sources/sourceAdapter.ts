import type { SourceFetchResult } from "../types/disclosure.js";

export interface DisclosureSourceAdapter {
  fetchFilings(): Promise<SourceFetchResult>;
}
