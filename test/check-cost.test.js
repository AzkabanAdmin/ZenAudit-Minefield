"use strict";
//==========// Counts the metered Analytics calls a field check makes, against the
//==========// real scan fixture. Dependents is one call per column, and Analytics
//==========// allows 60 a minute, so this count IS how long a Check All takes.
//==========//
//==========// Before the module restriction, checking one module queried every
//==========// same-named column in the whole org: "Created Time" alone exists in 146
//==========// of this org's 233 tables.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CACHE = path.join(__dirname, "fixtures", "scan-cache.json");
if (!fs.existsSync(CACHE)) {
  console.log("SKIP check-cost suite: test/fixtures/scan-cache.json is not present");
  process.exit(0);
}

const APP = path.join(__dirname, "..", "app", "js");

//==========// every dependents request is recorded rather than made
let calls = [];
const els = { "module-pick": { value: "Accounts", selectedOptions: [{ textContent: "Accounts" }] } };
const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent, Date, setTimeout: (f) => f(), clearTimeout: () => {},
  document: { getElementById: (id) => els[id] || { value: "" }, createElement: () => ({}) },
  ZOHO: { CRM: { META: {}, CONNECTION: { invoke: () => Promise.resolve({}) } } },
  localStorage: { getItem: () => null, setItem: () => {} },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["state.js", "helpers.js", "sources.js", "fields.js"]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), sandbox, { filename: f });
}

//==========// stand in for the network at the one place field checks reach it
sandbox.analyticsGet = function (pathname) {
  calls.push(pathname);
  return Promise.resolve({ data: { views: [], customFormulas: [], aggregateFormulas: [] } });
};

const S = sandbox.S;
const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
S.tables = cache.tables || [];
S.queryTables = cache.queryTables || [];
S.analyticsScanned = true;

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

//==========// the widget gets modules from the SDK, so build a plausible list and
//==========// take each module's fields from its own synced table
const MODULES = ["Accounts", "Contacts", "Leads", "Deals", "Invoices"];
S.modules = MODULES.map((n, i) => ({
  api_name: n, id: String(i + 1), plural_label: n, singular_label: n.replace(/s$/, ""),
}));

function tableFor(name) {
  const exact = S.tables.filter((t) => norm(t.viewName) === norm(name));
  const pool = exact.length ? exact : S.tables.filter((t) => norm(t.viewName).includes(norm(name)));
  return pool.sort((a, b) => (b.columns || []).length - (a.columns || []).length)[0];
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

//==========// how many columns anywhere in the org share a normalized name
const spread = new Map();
for (const t of S.tables) {
  for (const c of t.columns || []) {
    const k = norm(c.columnName);
    spread.set(k, (spread.get(k) || 0) + 1);
  }
}

async function checkAll(moduleName) {
  const t = tableFor(moduleName);
  if (!t) return null;
  els["module-pick"] = { value: moduleName, selectedOptions: [{ textContent: moduleName }] };
  S.results = {};
  S.depCache = {};
  calls = [];
  const fields = (t.columns || []).map((c) => ({
    api_name: c.columnName.replace(/\s+/g, "_"), label: c.columnName, custom: false,
  }));
  for (const f of fields) await sandbox.checkField(f);
  return { fields: fields.length, calls: calls.length, table: t.viewName };
}

(async function () {
  console.log("corpus: " + S.tables.length + " tables, " +
    S.tables.reduce((n, t) => n + (t.columns || []).length, 0) + " columns\n");

  /* **********************************************************************
   *   The_Generic_Column_Problem_Is_Real
   ********************************************************************** */

  const created = spread.get("created_time") || 0;
  console.log("   \"Created Time\" exists in " + created + " tables");
  check("a generic column name really does span most of the org", created > 100, true);

  /* **********************************************************************
   *   A_Check_All_Only_Queries_The_Module
   ********************************************************************** */

  const results = [];
  for (const m of MODULES) {
    const r = await checkAll(m);
    if (!r) continue;
    results.push({ module: m, ...r });
    console.log("   " + m.padEnd(10) + String(r.fields).padStart(4) + " fields  " +
      String(r.calls).padStart(4) + " calls  ~" + Math.round(r.calls * 1.1) + "s");
  }
  check("every module was measurable", results.length, MODULES.length);

  //==========// the unrestricted version queried every same-named column anywhere, so
  //==========// the ceiling is the sum of each field's org-wide spread
  for (const r of results) {
    const t = tableFor(r.module);
    let ceiling = 0;
    for (const c of t.columns || []) ceiling += spread.get(norm(c.columnName)) || 0;
    const ratio = ceiling / Math.max(1, r.calls);
    console.log("   " + r.module.padEnd(10) + "unrestricted would be " +
      String(ceiling).padStart(4) + " calls, so " + ratio.toFixed(1) + "x more");
    check(r.module + " costs far less than querying the whole org", ratio >= 2, true);
  }

  /* **********************************************************************
   *   Nothing_Is_Silently_Dropped
   ********************************************************************** */

  els["module-pick"] = { value: "Accounts", selectedOptions: [{ textContent: "Accounts" }] };
  S.results = {}; S.depCache = {}; calls = [];
  const field = { api_name: "Created_Time", label: "Created Time", custom: false };
  const r = await sandbox.checkField(field);

  check("the queried columns are only the module's own",
    r.columns.every((c) => c.primary), true);
  check("and the rest are recorded as unchecked rather than discarded",
    sandbox.uncheckedCount(r) > 0, true);
  check("queried plus unchecked accounts for every match",
    r.columns.length + sandbox.uncheckedCount(r), spread.get("created_time"));
  check("one call per queried column, no more", calls.length, r.columns.length);

  //==========// asking for them explicitly does spend the calls
  const before = calls.length;
  await sandbox.checkElsewhere(field);
  check("checking them anyway queries the rest", calls.length > before, true);
  check("and then nothing is left unchecked", sandbox.uncheckedCount(r), 0);

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL CHECK COST CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
