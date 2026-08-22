"use strict";
//==========// The reverse audit answers "which field broke my Analytics sync", so a
//==========// false alarm sends someone hunting a break that never happened. Every
//==========// misfire this suite pins down was found against a live org whose sync was
//==========// healthy at the time, and each is a distinct reason a real field failed to
//==========// match its own column:
//==========//
//==========//   Website, Industry        parked in the layout's Unused Items
//==========//   Converted Account        a read-only system lookup
//==========//   Title / Designation      relabelled, so its three names disagree
//==========//   Is Converted             a sync column that was never a field
//==========//
//==========// The first three all trace to one cause: the SDK's getFields returns only
//==========// fields sitting on a layout. The fix reads the settings endpoint instead.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: "", textContent: "", innerHTML: "", disabled: false,
      _c: new Set(),
      classList: {
        add: (c) => els[id]._c.add(c),
        remove: (c) => els[id]._c.delete(c),
        toggle: (c, on) => (on ? els[id]._c.add(c) : els[id]._c.delete(c)),
        contains: (c) => els[id]._c.has(c),
      },
      appendChild() {}, remove() {}, click() {}, setAttribute() {}, addEventListener() {},
      getAttribute: () => null, querySelectorAll: () => [], closest: () => el("x"),
      selectedOptions: [{ textContent: "Leads" }],
    };
  }
  return els[id];
}

//==========// every metered call is recorded rather than made
let crmCalls = [];
let depCalls = [];

const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent, Date, Set, setTimeout: (f) => f(), clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    getElementById: el, createElement: () => el("anchor"),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, body: el("body"),
  },
  ZOHO: { CRM: { META: {}, CONNECTION: { invoke: () => Promise.resolve({}) }, CONFIG: {} } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["state.js", "helpers.js", "sources.js", "fields.js", "ui.js", "reverse-audit.js"]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), sandbox, { filename: f });
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

const S = sandbox.S;

/* **********************************************************************
 *   The_Field_List_Comes_From_The_Settings_Endpoint
 *
 *   Shape copied from a real /crm/v8/settings/fields response. The
 *   field-level "type" is what marks a field as off every layout, and it
 *   is the key the whole fix turns on.
 ********************************************************************** */

const LEADS_FIELDS = [
  { api_name: "Last_Name", field_label: "Last Name", display_label: "Last Name",
    data_type: "text", custom_field: false, type: "used" },
  //==========// relabelled: three names, and the sync may use any of them
  { api_name: "Designation", field_label: "Title", display_label: "Designation",
    data_type: "text", custom_field: false, type: "used" },
  //==========// off every layout, but very much still a field
  { api_name: "Website", field_label: "Website", display_label: "Website",
    data_type: "website", custom_field: false, type: "unused" },
  { api_name: "Industry", field_label: "Industry", display_label: "Industry",
    data_type: "picklist", custom_field: false, type: "unused" },
  //==========// a read-only system lookup the SDK helper never returned
  { api_name: "Converted_Account", field_label: "Converted Account",
    display_label: "Converted Account", data_type: "lookup", custom_field: false, type: "used" },
];

sandbox.crmGet = function (p) {
  crmCalls.push(p);
  return Promise.resolve({ fields: LEADS_FIELDS });
};

sandbox.analyticsGet = function (p) {
  depCalls.push(p);
  return Promise.resolve({
    data: {
      views: [{ viewName: "Lead Funnel", viewId: "v99", reportType: "chart" }],
      customFormulas: [], aggregateFormulas: [],
    },
  });
};

sandbox.showLoader = function () {};

//==========// one synced Leads table carrying every column shape that has ever misfired
const LEADS_TABLE = {
  wsId: "ws1", wsName: "Zoho One Workspace", viewId: "t1", viewName: "Leads (Zoho CRM)",
  columns: [
    { columnId: "c1", columnName: "Last Name", dataType: "Plain Text", formula: "" },
    { columnId: "c2", columnName: "Designation", dataType: "Plain Text", formula: "" },
    //==========// the same field reached by its other label
    { columnId: "c3", columnName: "Title", dataType: "Plain Text", formula: "" },
    { columnId: "c4", columnName: "Website", dataType: "URL", formula: "" },
    { columnId: "c5", columnName: "Industry", dataType: "Plain Text", formula: "" },
    { columnId: "c6", columnName: "Converted Account", dataType: "Number", formula: "" },
    //==========// columns the sync owns and no field list will ever hold
    { columnId: "c7", columnName: "Id", dataType: "Number", formula: "" },
    { columnId: "c8", columnName: "Lead Owner Name", dataType: "Plain Text", formula: "" },
    { columnId: "c9", columnName: "Is Converted", dataType: "Yes/No Decision", formula: "" },
    { columnId: "c10", columnName: "Converted Date Time", dataType: "Date", formula: "" },
    //==========// derived, so never an orphan whatever CRM holds
    { columnId: "c11", columnName: "Lead Age", dataType: "Number", formula: "daysbetween(x,y)" },
    //==========// the one real orphan: a field that is genuinely gone
    { columnId: "c12", columnName: "Retired Score", dataType: "Number", formula: "" },
  ],
};

S.modules = [{ api_name: "Leads", id: "1", plural_label: "Leads", singular_label: "Lead" }];

/* **********************************************************************
 *   A_Live_Field_Is_Never_Called_An_Orphan
 ********************************************************************** */

(async function () {
  const fields = await sandbox.fetchModuleFields("Leads");

  //==========// type=all is the whole fix: without it the endpoint returns only
  //==========// fields on a layout, which is the blind spot this suite exists for
  check("the field list is read from the settings endpoint, asking for all fields",
    crmCalls, ["/settings/fields?type=all&module=Leads"]);
  check("and it is cached, so a module is never paid for twice",
    (await sandbox.fetchModuleFields("Leads")) === fields, true);
  check("off-layout fields are carried, not dropped", fields.length, LEADS_FIELDS.length);
  check("and they are marked as off-layout",
    fields.filter((f) => f.offLayout).map((f) => f.api_name), ["Website", "Industry"]);

  const unmatched = sandbox.unmatchedColumns(LEADS_TABLE, fields).map((c) => c.columnName);
  check("only the genuinely deleted field is reported", unmatched, ["Retired Score"]);

  //==========// each misfire named individually, so a regression says which one broke
  const misfires = {
    "an off-layout field (Website)": "Website",
    "an off-layout picklist (Industry)": "Industry",
    "a read-only system lookup (Converted Account)": "Converted Account",
    "a relabelled field by its display label (Designation)": "Designation",
    "a relabelled field by its original label (Title)": "Title",
    "a sync key (Id)": "Id",
    "an owner column (Lead Owner Name)": "Lead Owner Name",
    "a conversion flag (Is Converted)": "Is Converted",
    "a conversion timestamp (Converted Date Time)": "Converted Date Time",
    "a formula column (Lead Age)": "Lead Age",
  };
  for (const [label, column] of Object.entries(misfires)) {
    check(label + " is not an orphan", unmatched.includes(column), false);
  }

  /* **********************************************************************
   *   Dependents_Are_Bought_Only_For_Real_Orphans
   *
   *   One metered Analytics call each, which is only affordable because a
   *   healthy org has none.
   ********************************************************************** */

  S.tables = [LEADS_TABLE];
  S.depCache = {};
  S.scannedAt = "8/21/2026, 5:32:45 PM";
  depCalls = [];

  await sandbox.runReverseAudit();

  check("one dependents call, for the orphan alone", depCalls.length, 1);
  check("and it asked about that column", /\/columns\/c12\/dependents$/.test(depCalls[0]), true);

  const result = S.reverseAuditResults;
  check("the table was matched to its module", result.length, 1);
  check("with one orphan", result[0].unmatched.map((c) => c.columnName), ["Retired Score"]);
  check("carrying what it takes down with it",
    result[0].unmatched[0].dep.views.map((v) => v.viewName), ["Lead Funnel"]);

  const html = el("reverse-audit-results").innerHTML;
  check("the report names the orphan", html.indexOf("Retired Score") >= 0, true);
  check("and what breaks with it", html.indexOf("Lead Funnel") >= 0, true);
  check("the export is offered", el("btn-reverse-audit-export")._c.has("hidden"), false);

  /* **********************************************************************
   *   The_Report_Says_What_To_Do_About_It
   *
   *   Both routes Zoho itself offers, but concrete: which items to clear,
   *   or the exact name and field type to rebuild. The type is derived
   *   from the Analytics column, which is the only record of what the
   *   field was once CRM has lost it.
   ********************************************************************** */

  check("it names the exact field to rebuild",
    html.indexOf("with the exact name <b>Retired Score</b>") >= 0, true);
  check("and the CRM type to rebuild it as, read off the column",
    html.indexOf("as a <b>Number</b> field") >= 0, true);
  check("and offers clearing the dependents as the alternative",
    html.indexOf("remove <b>Retired Score</b> from the 1 item above") >= 0, true);
  check("and admits where the column type cannot tell field types apart",
    html.indexOf("also covers Long Integer") >= 0, true);

  //==========// every column type a 3,669 column scan of a large org produced, so an
  //==========// orphan is never reported without a type to rebuild it as
  const REAL_COLUMN_TYPES = ["Plain Text", "Number", "Date", "Currency",
    "Decimal Number", "Multi Line Text", "Yes/No Decision", "Positive Number",
    "URL", "Geo Column", "Percentage", "E-Mail", "Auto Number"];
  check("every Analytics column type maps to a CRM field type",
    REAL_COLUMN_TYPES.filter((t) => !sandbox.crmTypeForColumn(t)), []);
  check("and an unrecognised one degrades rather than throwing",
    sandbox.crmTypeForColumn("Some Future Type"), null);


  /* **********************************************************************
   *   A_Healthy_Org_Reports_Nothing_And_Spends_Nothing
   ********************************************************************** */

  S.tables = [{
    wsId: "ws1", wsName: "Zoho One Workspace", viewId: "t2", viewName: "Leads (Zoho CRM)",
    columns: LEADS_TABLE.columns.filter((c) => c.columnName !== "Retired Score"),
  }];
  S.depCache = {};
  depCalls = [];

  await sandbox.runReverseAudit();

  check("a healthy sync reports no orphans",
    S.reverseAuditResults[0].unmatched.length, 0);
  check("and costs no metered calls at all", depCalls.length, 0);
  check("the empty result says so out loud",
    /nothing here points at a broken sync/.test(el("reverse-audit-results").innerHTML), true);

  /* **********************************************************************
   *   Ambiguous_Table_Names_Are_Skipped_Rather_Than_Guessed
   ********************************************************************** */

  check("a table naming exactly one module matches it",
    sandbox.matchModuleForTable({ viewName: "Leads" }).api_name, "Leads");
  check("a table naming no module is skipped",
    sandbox.matchModuleForTable({ viewName: "Warehouse Stock" }), null);

  S.modules = [
    { api_name: "Leads", id: "1", plural_label: "Leads", singular_label: "Lead" },
    { api_name: "Sales_Leads", id: "2", plural_label: "Sales Leads", singular_label: "Sales Lead" },
  ];
  //==========// "Leads Archive" contains only one module name, so resolving it is
  //==========// right. "Sales Leads Archive" contains both and must not be guessed at.
  check("a suffixed name still resolves when only one module fits",
    sandbox.matchModuleForTable({ viewName: "Leads Archive" }).api_name, "Leads");
  check("a name that could be either module is skipped, not guessed",
    sandbox.matchModuleForTable({ viewName: "Sales Leads Archive" }), null);

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL REVERSE AUDIT CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
