import assert from "node:assert/strict";
import test from "node:test";
import { senateReportSearchParams } from "../src/sources/senateDisclosureSource.js";

test("senate report search params mirror a DataTables browser request", () => {
  const params = senateReportSearchParams({
    csrf: "csrf-token",
    currentYear: 2026,
    length: 50,
  });

  assert.equal(params.get("csrfmiddlewaretoken"), "csrf-token");
  assert.equal(params.get("report_types"), "[11]");
  assert.equal(params.get("submitted_start_date"), "01/01/2026");
  assert.equal(params.get("submitted_end_date"), "12/31/2026");
  assert.equal(params.get("order[0][column]"), "4");
  assert.equal(params.get("order[0][dir]"), "desc");
  assert.equal(params.get("search[value]"), "");
  assert.equal(params.get("columns[0][data]"), "0");
  assert.equal(params.get("columns[0][searchable]"), "true");
  assert.equal(params.get("columns[5][orderable]"), "false");
});
