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
//==========//   SEMODULE, Host Name      Activities' own sync columns (Calls, Tasks, Meetings)
//==========//   every column at once     a new module whose table matched no field at all
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
   *   A_Table_Nothing_Matches_Is_Unverified_Not_All_Orphans
   *
   *   Found against a live org: a new custom module, synced to Analytics
   *   while it still had no records, came back with every one of its
   *   columns reported as a deleted field. A real synced table always
   *   matches something, since Created Time and Modified Time cannot be
   *   deleted, so matching nothing means the field list could not be read
   *   or the table was matched to the wrong module. Either way it must be
   *   said out loud, and must not cost a metered call per column.
   ********************************************************************** */

  const realCrmGet = sandbox.crmGet;
  const FIELDS_BY_MODULE = {
    Leads: LEADS_FIELDS,
    //==========// CRM answered, but with nothing in it
    Inspections: [],
    Sites: [
      { api_name: "Name", field_label: "Site Name", display_label: "Site Name", data_type: "text", type: "used" },
      { api_name: "Created_Time", field_label: "Created Time", display_label: "Created Time", data_type: "datetime", type: "used" },
      { api_name: "Modified_Time", field_label: "Modified Time", display_label: "Modified Time", data_type: "datetime", type: "used" },
      { api_name: "Region", field_label: "Region", display_label: "Region", data_type: "text", type: "used" },
      { api_name: "Owner", field_label: "Site Owner", display_label: "Site Owner", data_type: "ownerlookup", type: "used" },
    ],
  };
  sandbox.crmGet = function (p) {
    crmCalls.push(p);
    const mod = decodeURIComponent((p.match(/module=([^&]+)/) || [])[1] || "");
    return Promise.resolve(FIELDS_BY_MODULE[mod] ? { fields: FIELDS_BY_MODULE[mod] } : {});
  };
  S.modules = [
    { api_name: "Leads", id: "1", plural_label: "Leads", singular_label: "Lead" },
    { api_name: "Inspections", id: "3", plural_label: "Inspections", singular_label: "Inspection" },
    { api_name: "Sites", id: "4", plural_label: "Sites", singular_label: "Site" },
  ];
  const INSPECTIONS_TABLE = {
    wsId: "ws1", wsName: "Zoho One Workspace", viewId: "t3", viewName: "Inspections (Zoho CRM)",
    columns: [
      { columnId: "i1", columnName: "Inspection Name", dataType: "Plain Text", formula: "" },
      { columnId: "i2", columnName: "Created Time", dataType: "Date", formula: "" },
      { columnId: "i3", columnName: "Modified Time", dataType: "Date", formula: "" },
      { columnId: "i4", columnName: "Inspector", dataType: "Number", formula: "" },
    ],
  };
  S.tables = [INSPECTIONS_TABLE];
  S.moduleFieldsCache = {};
  S.depCache = {};
  crmCalls = []; depCalls = [];

  await sandbox.runReverseAudit();
  let raHtml = el("reverse-audit-results").innerHTML;

  check("an empty field list does not flag every column", S.reverseAuditResults.length, 0);
  check("and spends no metered calls on it", depCalls.length, 0);
  check("it is listed as could-not-verify rather than hidden",
    S.reverseAuditUnverified.map((u) => u.table.viewName), ["Inspections (Zoho CRM)"]);
  check("the page says why",
    /Could not verify/.test(raHtml) && /CRM returned no fields for Inspections/.test(raHtml), true);
  check("and does not claim the sync is healthy", /nothing here points at a broken sync/.test(raHtml), false);
  check("nor that no table matched a module", raHtml.indexOf("No scanned Analytics table") >= 0, false);
  check("nor offers to rebuild a field it cannot know is gone", raHtml.indexOf("To fix") >= 0, false);
  check("the export is not offered for it", el("btn-reverse-audit-export")._c.has("hidden"), true);
  check("the summary line counts it",
    /1 table could not be verified/.test(el("scan-progress").innerHTML), true);

  //==========// one workspace can hold "Inspections" and "Inspections (Zoho CRM)"
  S.tables = [INSPECTIONS_TABLE, Object.assign({}, INSPECTIONS_TABLE, { viewId: "t3b", viewName: "Inspections" })];
  S.moduleFieldsCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  check("every same-named table that cannot be verified is listed, not just the first",
    S.reverseAuditUnverified.map((u) => u.table.viewName).sort(), ["Inspections", "Inspections (Zoho CRM)"]);
  check("and the summary counts both", /2 tables could not be verified/.test(el("scan-progress").innerHTML), true);

  crmCalls = [];
  await sandbox.fetchModuleFields("Inspections");
  await sandbox.fetchModuleFields("Inspections");
  check("an empty field list is not cached, so the next read asks again", crmCalls.length, 2);

  //==========// a real field list, but the table is somebody else's: the shape a
  //==========// wrong-module name match produces
  S.tables = [{
    wsId: "ws1", wsName: "Zoho One Workspace", viewId: "t4", viewName: "Leads",
    columns: [
      { columnId: "w1", columnName: "Warehouse", dataType: "Plain Text", formula: "" },
      { columnId: "w2", columnName: "Bin Count", dataType: "Number", formula: "" },
    ],
  }];
  S.moduleFieldsCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  check("a table matching none of a real field list is unverified, not all orphans",
    [S.reverseAuditResults.length, S.reverseAuditUnverified.length, depCalls.length], [0, 1, 0]);
  check("and it says the columns did not line up, not that CRM was empty",
    /none of its columns match a Leads field/.test(el("reverse-audit-results").innerHTML), true);

  //==========// the guard must never swallow a real break, however bad. Only the
  //==========// primary field and the system columns survive here, which is as far as
  //==========// a real table can fall: the primary field cannot be deleted.
  const SITES_TABLE = {
    wsId: "ws1", wsName: "Zoho One Workspace", viewId: "t5", viewName: "Sites",
    columns: [
      { columnId: "s0", columnName: "Site Name", dataType: "Plain Text", formula: "" },
      { columnId: "s1", columnName: "Created Time", dataType: "Date", formula: "" },
      { columnId: "s2", columnName: "Gate Code", dataType: "Plain Text", formula: "" },
      { columnId: "s3", columnName: "Alarm Zone", dataType: "Plain Text", formula: "" },
      { columnId: "s4", columnName: "Key Holder", dataType: "Plain Text", formula: "" },
      { columnId: "s5", columnName: "Access Notes", dataType: "Multi Line Text", formula: "" },
    ],
  };
  S.tables = [SITES_TABLE];
  S.moduleFieldsCache = {}; S.depCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  check("a mostly-deleted table still names every gone column",
    S.reverseAuditResults[0].unmatched.map((c) => c.columnName),
    ["Gate Code", "Alarm Zone", "Key Holder", "Access Notes"]);
  check("and is not shelved as unverified", S.reverseAuditUnverified.length, 0);

  //==========// one verified orphan beside one unverifiable table: both shown, and
  //==========// the CSV carries only what is known, in the same six columns
  S.tables = [INSPECTIONS_TABLE, {
    wsId: "ws1", wsName: "Zoho One Workspace", viewId: "t6", viewName: "Sites",
    columns: [
      { columnId: "g1", columnName: "Site Name", dataType: "Plain Text", formula: "" },
      { columnId: "g2", columnName: "Created Time", dataType: "Date", formula: "" },
      { columnId: "g3", columnName: "Site Owner Name", dataType: "Plain Text", formula: "" },
      { columnId: "g4", columnName: "Inspection Grade", dataType: "Plain Text", formula: "" },
    ],
  }];
  S.moduleFieldsCache = {}; S.depCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  raHtml = el("reverse-audit-results").innerHTML;
  check("a real orphan beside live fields is still reported",
    S.reverseAuditResults.map((v) => v.unmatched.map((c) => c.columnName)), [["Inspection Grade"]]);
  check("with one dependents call, for it alone", depCalls.length, 1);
  check("and the unverifiable table is listed after it",
    raHtml.indexOf("Inspection Grade") >= 0 && raHtml.indexOf("Could not verify") > raHtml.indexOf("Inspection Grade"), true);

  let csvRows = null;
  const realDownloadCsv = sandbox.downloadCsv;
  sandbox.downloadCsv = (rows) => { csvRows = rows; };
  el("btn-reverse-audit-export").onclick();
  sandbox.downloadCsv = realDownloadCsv;
  check("the CSV carries only verified orphans, with the same six columns", csvRows,
    [["Analytics Table", "Workspace", "CRM Module", "Column", "Column Type", "Affected Analytics Items"],
     ["Sites", "Zoho One Workspace", "Sites", "Inspection Grade", "Plain Text", "1"]]);

  /* **********************************************************************
   *   A_Table_Matched_Only_On_Shared_Fields_Is_Unverified
   *
   *   Found against a live org: a new "Contractor Bids" module was missing
   *   from the module list, so its table "Contractor Bids (Zoho CRM)" was
   *   name-matched to Contractors. Created Time, Modified Time, Email and the
   *   like lined up, as they do between any two modules, and every real
   *   Contractor Bids field was reported as deleted. The columns below are
   *   the ones that live org reported.
   ********************************************************************** */

  FIELDS_BY_MODULE.Contractors = [
    { api_name: "Name", field_label: "Contractor Name", display_label: "Contractor Name", data_type: "text", type: "used" },
    { api_name: "Owner", field_label: "Contractor Owner", display_label: "Contractor Owner", data_type: "ownerlookup", type: "used" },
    { api_name: "Email", field_label: "Email", display_label: "Email", data_type: "email", type: "used" },
    { api_name: "Email_Opt_Out", field_label: "Email Opt Out", display_label: "Email Opt Out", data_type: "boolean", type: "used" },
    { api_name: "Created_Time", field_label: "Created Time", display_label: "Created Time", data_type: "datetime", type: "used" },
    { api_name: "Modified_Time", field_label: "Modified Time", display_label: "Modified Time", data_type: "datetime", type: "used" },
    { api_name: "Created_By", field_label: "Created By", display_label: "Created By", data_type: "ownerlookup", type: "used" },
    { api_name: "Modified_By", field_label: "Modified By", display_label: "Modified By", data_type: "ownerlookup", type: "used" },
    { api_name: "Tag", field_label: "Tag", display_label: "Tag", data_type: "text", type: "used" },
    { api_name: "Trade", field_label: "Trade", display_label: "Trade", data_type: "picklist", type: "used" },
  ];
  const savedModules = S.modules;
  //==========// Contractor Bids itself is absent, exactly as it was on the live org
  S.modules = [{ api_name: "Contractors", id: "20", plural_label: "Contractors", singular_label: "Contractor" }];
  const BIDS_TABLE = { wsId: "ws1", wsName: "Zoho One Workspace", viewId: "cb1", viewName: "Contractor Bids (Zoho CRM)",
    columns: ["Id", "Contractor Bids Name", "Contractor Bids Owner", "Email", "Secondary Email", "Email Opt Out",
      "Created Time", "Modified Time", "Created By", "Modified By", "Tag", "Bid Amount", "Bid Status",
      "Eligible Contractors", "Service"].map((n, i) =>
      ({ columnId: "cb" + i, columnName: n, dataType: "Plain Text", formula: "" })) };
  check("the bids table is name-matched to Contractors, as it was live",
    sandbox.matchModuleForTable(BIDS_TABLE).api_name, "Contractors");

  S.tables = [BIDS_TABLE];
  S.moduleFieldsCache = {}; S.depCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  raHtml = el("reverse-audit-results").innerHTML;
  check("a table matching only fields every module shares reports no orphans",
    S.reverseAuditResults.length, 0);
  check("and spends no metered calls", depCalls.length, 0);
  check("it is listed as could-not-verify, saying why",
    [S.reverseAuditUnverified.length,
     /nothing specific to Contractors/.test(raHtml)], [1, true]);
  check("and tells nobody to rebuild Bid Amount on Contractors", raHtml.indexOf("To fix") >= 0, false);

  //==========// the real Contractors table still audits, orphans and all
  S.tables = [BIDS_TABLE, { wsId: "ws1", wsName: "Zoho One Workspace", viewId: "c1", viewName: "Contractors (Zoho CRM)",
    columns: ["Contractor Name", "Email", "Created Time", "Trade", "License Number"].map((n, i) =>
      ({ columnId: "ct" + i, columnName: n, dataType: "Plain Text", formula: "" })) }];
  S.moduleFieldsCache = {}; S.depCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  check("while the real Contractors table beside it is audited, its real orphan reported",
    S.reverseAuditResults.map((v) => [v.table.viewName, v.unmatched.map((c) => c.columnName)]),
    [["Contractors (Zoho CRM)", ["License Number"]]]);
  check("and the bids table is listed as unverified, not as a skipped duplicate",
    [S.reverseAuditResults[0].skipped.length, S.reverseAuditUnverified.map((u) => u.table.viewName)],
    [0, ["Contractor Bids (Zoho CRM)"]]);
  /* **********************************************************************
   *   Linking_Modules_Are_Audited_As_Themselves
   *
   *   The cause of the Contractor Bids misfire. It is LinkingModule1, the
   *   module a multi-select lookup creates, and the module list left linking
   *   modules out, so its table could only ever be matched to something
   *   else. The field picker still leaves them out; the reverse audit does not.
   ********************************************************************** */

  const sf = (api, label, type) =>
    ({ api_name: api, field_label: label, display_label: label, data_type: type || "text", type: "used" });
  FIELDS_BY_MODULE.LinkingModule1 = [
    sf("Name", "Contractor Bids Name"), sf("Owner", "Contractor Bids Owner", "ownerlookup"),
    sf("Email", "Email", "email"), sf("Secondary_Email", "Secondary Email", "email"),
    sf("Email_Opt_Out", "Email Opt Out", "boolean"), sf("Created_Time", "Created Time", "datetime"),
    sf("Modified_Time", "Modified Time", "datetime"), sf("Created_By", "Created By", "ownerlookup"),
    sf("Modified_By", "Modified By", "ownerlookup"), sf("Tag", "Tag"),
    sf("Bid_Amount", "Bid Amount", "currency"), sf("Bid_Status", "Bid Status", "picklist"),
    sf("Eligible_Contractors", "Eligible Contractors", "lookup"), sf("Service", "Service", "lookup"),
  ];
  S.reverseModules = [
    { api_name: "Contractors", id: "20", plural_label: "Contractors", singular_label: "Contractor" },
    { api_name: "LinkingModule1", id: "21", plural_label: "Contractor Bids", singular_label: "Contractor Bid",
      generated_type: "linking" },
  ];
  check("a linking module's table is matched to the linking module",
    sandbox.matchModuleForTable(BIDS_TABLE).api_name, "LinkingModule1");
  check("the connector's (Zoho CRM) suffix does not stop an exact match",
    sandbox.matchModuleForTable({ viewName: "Contractors (Zoho CRM)" }).api_name, "Contractors");

  S.tables = [BIDS_TABLE];
  S.moduleFieldsCache = {}; S.depCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  check("and audited as itself, with nothing reported",
    [S.reverseAuditResults.map((v) => [v.module.api_name, v.unmatched.length]), S.reverseAuditUnverified.length],
    [[["LinkingModule1", 0]], 0]);
  check("so the live Contractor Bids misfire costs nothing", depCalls.length, 0);

  //==========// a module CRM refuses to describe must not end the whole audit
  S.reverseModules.push({ api_name: "Broken", id: "22", plural_label: "Broken Things", singular_label: "Broken Thing" });
  const okCrmGet = sandbox.crmGet;
  sandbox.crmGet = (p) => /module=Broken/.test(p) ? Promise.reject(new Error("API error")) : okCrmGet(p);
  S.tables = [BIDS_TABLE, { wsId: "ws1", wsName: "Zoho One Workspace", viewId: "bk1", viewName: "Broken Things",
    columns: [{ columnId: "bk", columnName: "Widget", dataType: "Plain Text", formula: "" }] }];
  S.moduleFieldsCache = {}; depCalls = [];
  let auditError = null;
  await sandbox.runReverseAudit().catch((e) => { auditError = e; });
  sandbox.crmGet = okCrmGet;
  check("one module whose fields cannot be read does not fail the audit", auditError, null);
  check("it is listed as unverified while the others are still audited",
    [S.reverseAuditUnverified.map((u) => u.module.api_name), S.reverseAuditResults.map((v) => v.module.api_name)],
    [["Broken"], ["LinkingModule1"]]);
  S.reverseModules = [];

  S.modules = savedModules;

  /* **********************************************************************
   *   Activities_Sync_Columns_Are_Not_Orphans
   *
   *   Found against a live org: Calls, Tasks and Meetings reported columns
   *   that ship with every CRM and cannot be deleted. Column lists are from
   *   Zoho's CRM connector data model. SEMODULE is the $se_module record
   *   property behind "Related To", and Meetings names its owner "Host", so
   *   the sync's owner column there is "Host Name", not "... Owner Name".
   ********************************************************************** */

  const sysField = (api, label, type) =>
    ({ api_name: api, field_label: label, display_label: label, data_type: type || "text", type: "used" });
  Object.assign(FIELDS_BY_MODULE, {
    Events: [sysField("Owner", "Host", "ownerlookup"), sysField("Event_Title", "Title"),
      sysField("What_Id", "Related To", "lookup"), sysField("Who_Id", "Contact Name", "lookup"),
      sysField("Created_Time", "Created Time", "datetime")],
    Calls: [sysField("Owner", "Call Owner", "ownerlookup"), sysField("Subject", "Subject"),
      sysField("What_Id", "Related To", "lookup"), sysField("Created_Time", "Created Time", "datetime")],
    Tasks: [sysField("Owner", "Task Owner", "ownerlookup"), sysField("Subject", "Subject"),
      sysField("What_Id", "Related To", "lookup"), sysField("Created_Time", "Created Time", "datetime")],
    //==========// a relabelled owner, and one whose data_type is not reported
    Deals: [sysField("Owner", "Account Manager", "ownerlookup"), sysField("Deal_Name", "Deal Name"),
      sysField("Inspector", "Inspector", "lookup")],
    Vendors: [{ api_name: "Owner", field_label: "Buyer", display_label: "Buyer", type: "used" },
      sysField("Vendor_Name", "Vendor Name")],
  });
  S.modules = [
    { api_name: "Events", id: "10", plural_label: "Meetings", singular_label: "Meeting" },
    { api_name: "Calls", id: "11", plural_label: "Calls", singular_label: "Call" },
    { api_name: "Tasks", id: "12", plural_label: "Tasks", singular_label: "Task" },
    //==========// what "Related To" can point at, a custom module included
    { api_name: "Accounts", id: "13", plural_label: "Accounts", singular_label: "Account" },
    { api_name: "Contacts", id: "14", plural_label: "Contacts", singular_label: "Contact" },
    { api_name: "Deals", id: "15", plural_label: "Deals", singular_label: "Deal" },
    { api_name: "Leads", id: "1", plural_label: "Leads", singular_label: "Lead" },
    { api_name: "Sites", id: "4", plural_label: "Sites", singular_label: "Site" },
  ];
  const col = (id, name) => ({ columnId: id, columnName: name, dataType: "Plain Text", formula: "" });
  const MEETINGS_TABLE = { wsId: "ws1", wsName: "Zoho One Workspace", viewId: "m1", viewName: "Meetings",
    columns: [col("m1", "Host"), col("m2", "Host Name"), col("m3", "Title"), col("m4", "Related To"),
      col("m5", "SEMODULE"), col("m6", "Contact Name"), col("m7", "Created Time"), col("m8", "Meeting Score"),
      col("m9", "Account ID"), col("m10", "Contact ID"), col("m11", "Deal_ID"), col("m12", "Site ID")] };
  const CALLS_TABLE = { wsId: "ws1", wsName: "Zoho One Workspace", viewId: "m2", viewName: "Calls",
    columns: [col("k1", "Call Owner"), col("k2", "Call Owner Name"), col("k3", "Subject"),
      col("k4", "Related To"), col("k5", "SEMODULE"), col("k6", "Created Time"), col("k7", "Lead ID")] };
  const TASKS_TABLE = { wsId: "ws1", wsName: "Zoho One Workspace", viewId: "m3", viewName: "Tasks",
    columns: [col("a1", "Task Owner"), col("a2", "Task Owner Name"), col("a3", "Subject"),
      col("a4", "Related To"), col("a5", "Se Module"), col("a6", "Created Time"), col("a7", "AccountID")] };

  S.moduleFieldsCache = {};
  const unmatchedIn = async (table, mod) =>
    sandbox.unmatchedColumns(table, await sandbox.fetchModuleFields(mod), { api_name: mod })
      .map((c) => c.columnName);
  const meetingsLeft = await unmatchedIn(MEETINGS_TABLE, "Events");
  const callsLeft = await unmatchedIn(CALLS_TABLE, "Calls");
  const tasksLeft = await unmatchedIn(TASKS_TABLE, "Tasks");

  const activityMisfires = [
    ["a Meetings host column (Host Name)", meetingsLeft, "Host Name"],
    ["the parent-module column (SEMODULE) in Meetings", meetingsLeft, "SEMODULE"],
    ["SEMODULE in Calls", callsLeft, "SEMODULE"],
    ["the Calls owner column (Call Owner Name)", callsLeft, "Call Owner Name"],
    ["a spaced variant (Se Module) in Tasks", tasksLeft, "Se Module"],
    ["the Tasks owner column (Task Owner Name)", tasksLeft, "Task Owner Name"],
    ["a parent-module id (Account ID) in Meetings", meetingsLeft, "Account ID"],
    ["a parent-module id (Contact ID) in Meetings", meetingsLeft, "Contact ID"],
    ["a parent-module id by api name (Deal_ID) in Meetings", meetingsLeft, "Deal_ID"],
    ["a custom parent module's id (Site ID) in Meetings", meetingsLeft, "Site ID"],
    ["a parent-module id (Lead ID) in Calls", callsLeft, "Lead ID"],
    ["an unspaced parent-module id (AccountID) in Tasks", tasksLeft, "AccountID"],
  ];
  for (const [label, left, column] of activityMisfires) {
    check(label + " is not an orphan", left.includes(column), false);
  }
  check("a genuinely deleted Meetings field is still reported", meetingsLeft, ["Meeting Score"]);
  check("and Calls and Tasks are clean", [callsLeft, tasksLeft], [[], []]);
  check("an id column naming no module is still reported in Meetings",
    await unmatchedIn({ columns: [col("g1", "Gate ID"), col("g2", "Title")] }, "Events"), ["Gate ID"]);
  check("and outside Activities a module id gets no pass (Account ID in Deals)",
    await unmatchedIn({ columns: [col("x1", "Account ID"), col("x2", "Deal Name")] }, "Deals"), ["Account ID"]);
  check("nor when no module is given, so the two-argument call is unchanged",
    sandbox.unmatchedColumns({ columns: [col("x3", "Account ID")] }, []).map((c) => c.columnName), ["Account ID"]);

  const dealCols = { columns: [col("d1", "Account Manager"), col("d2", "Account Manager Name"),
    col("d3", "Deal Name"), col("d4", "Inspector"), col("d5", "Inspector Name")] };
  check("a relabelled owner's companion (Account Manager Name) is not an orphan, " +
    "but a custom lookup gets no free <label> Name companion (Inspector Name)",
    await unmatchedIn(dealCols, "Deals"), ["Inspector Name"]);
  check("an Owner field is recognised by api_name even without ownerlookup",
    await unmatchedIn({ columns: [col("v1", "Buyer Name"), col("v2", "Vendor Name")] }, "Vendors"), []);

  S.tables = [MEETINGS_TABLE, CALLS_TABLE, TASKS_TABLE];
  S.moduleFieldsCache = {}; S.depCache = {}; depCalls = [];
  await sandbox.runReverseAudit();
  check("Activities tables run through the full audit buy dependents only for the real orphan",
    [depCalls.length, /\/columns\/m8\/dependents$/.test(depCalls[0])], [1, true]);
  check("and only Meetings is flagged",
    S.reverseAuditResults.filter((v) => v.unmatched.length).map((v) => v.module.api_name), ["Events"]);

  sandbox.crmGet = realCrmGet;
  S.modules = [{ api_name: "Leads", id: "1", plural_label: "Leads", singular_label: "Lead" }];

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
