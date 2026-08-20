"use strict";
//==========// Minimal DOM/SDK shim so the widget's logic can run in Node.
//==========// Exercises verdicts, chips, detail rendering and CSV export
//==========// against synthetic scan data. Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

function makeEl(id) {
  const el = {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    children: [],
    dataset: {},
    style: {},
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on === undefined ? (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c)) : (on ? el._classes.add(c) : el._classes.delete(c))),
      contains: (c) => el._classes.has(c),
    },
    appendChild(c) { el.children.push(c); return c; },
    remove() {},
    addEventListener() {},
    setAttribute(k, v) { el.dataset[k] = v; },
    getAttribute(k) { return el.dataset[k]; },
    closest() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; },
    scrollIntoView() {},
    selectedOptions: [{ textContent: "Deals" }],
  };
  return el;
}

const els = {};
function $el(id) {
  if (!els[id]) els[id] = makeEl(id);
  return els[id];
}

const sandbox = {
  console,
  Promise,
  Date,
  Math,
  JSON,
  RegExp,
  Array,
  Object,
  String,
  Number,
  Boolean,
  isNaN,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
  URL: { createObjectURL: () => "blob:stub" },
  Blob: function () {},
  innerWidth: 1200,
  innerHeight: 800,
  navigator: {},
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  document: {
    body: makeEl("body"),
    documentElement: makeEl("html"),
    getElementById: $el,
    createElement: (t) => makeEl("new-" + t),
    querySelector: () => makeEl("q"),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  matchMedia: () => ({ matches: false }),
  ZOHO: {
    CRM: {
      META: { getModules: () => Promise.resolve({ modules: [] }), getFields: () => Promise.resolve({ fields: [] }) },
      CONNECTION: { invoke: () => Promise.resolve({}) },
      CONFIG: { getOrgInfo: () => Promise.resolve({ org: [{ zgid: "1" }] }) },
    },
    embeddedApp: { on() {}, init() {} },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

//==========// load in the same order widget.html does, minus the boot-only files
for (const f of ["state.js", "helpers.js", "sources.js", "loader.js", "fields.js", "ui.js"]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), ctx, { filename: f });
}

const S = sandbox.S;

/* ===== synthetic org ===== */
S.modules = [{ api_name: "Deals", id: "M_DEALS", plural_label: "Deals", singular_label: "Deal" }];
$el("module-pick").value = "Deals";
S.scannedAt = "Aug 20, 2026, 4:00 PM";

S.tables = [{
  wsId: "W1", wsName: "Sales WS", viewId: "V1", viewName: "Deals",
  columns: [{ columnId: "C_STAGE", columnName: "Stage" }, { columnId: "C_DEAD", columnName: "Dead Field" }],
}];
S.queryTables = [{ wsId: "W1", wsName: "Sales WS", viewId: "Q1", viewName: "Pipeline SQL", sql: "select Stage from deals" }];
S.analyticsScanned = true;

S.functions = [{ id: "F1", name: "updateStage", code: 'd = zoho.crm.getRecordById("Deals", x); s = d.get("Stage");' }];
S.functionsScanned = true;

S.workflowRules = [{ id: "WR1", name: "Stage Alert", moduleApiName: "Deals", moduleId: "M_DEALS", triggerFields: ["Stage"], criteriaFields: ["Stage"] }];
S.workflowRulesScanned = true;

S.blueprintFields = [{ id: "BP1", name: "Deal Flow", moduleApiName: "Deals", moduleId: "M_DEALS", fieldApiName: "Stage", pipelineName: "Standard" }];
S.blueprintFieldsScanned = true;

S.webhookActions = [{ id: "WH1", name: "Notify", moduleApiName: "Deals", fieldRefs: [{ moduleApiName: "Deals", fieldApiName: "Stage" }] }];
S.webhookActionsScanned = true;

S.connectedWorkflowRules = [{ id: "CW1", name: "Flow Rule", moduleApiName: "Deals", moduleId: "M_DEALS", triggerFields: ["Stage"], criteriaFields: [] }];
S.connectedWorkflowRulesScanned = true;

//==========// dependents come preloaded so no network call is attempted
S.depCache = {
  C_STAGE: { views: [{ viewName: "Pipeline Chart", viewId: "V9", reportType: "chart" }], customFormulas: [], aggregateFormulas: [] },
  C_DEAD: { views: [], customFormulas: [], aggregateFormulas: [] },
};

S.fields = [
  { api_name: "Stage", label: "Stage", type: "picklist", custom: false },
  { api_name: "Dead Field", label: "Dead Field", type: "text", custom: true },
  { api_name: "Ghost_Field", label: "Ghost Field", type: "text", custom: true },
];

/* ===== assertions ===== */
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "\n   got:      " + actual + "\n   expected: " + expected));
}
function report(name, v) { console.log("  " + name + ": " + v); }

Promise.all(S.fields.map((f) => sandbox.checkField(f))).then(() => {
  const stage = S.results["Stage"];
  const dead = S.results["Dead Field"];
  const ghost = S.results["Ghost_Field"];

  console.log("\n--- Stage (used everywhere) ---");
  // 1 dependent view + 1 sql + 1 function + 1 trigger + 1 criteria + 1 blueprint + 1 webhook + 1 cwTrigger = 8
  check("hitCount(Stage)", sandbox.hitCount(stage), 8);
  check("categoryOf(Stage)", sandbox.categoryOf(S.fields[0]), "used");
  const u = sandbox.usageCounts(stage);
  report("usageCounts", JSON.stringify(u));
  check("analytics count (view + sql)", u.analytics, 2);
  check("triggers", u.triggers, 1);
  check("criteria", u.criteria, 1);
  check("blueprint", u.blueprint, 1);
  check("webhooks", u.webhooks, 1);
  check("cwTriggers", u.cwTriggers, 1);
  check("cwCriteria", u.cwCriteria, 0);

  console.log("\n--- Dead Field (synced, no dependents) ---");
  check("hitCount(Dead Field)", sandbox.hitCount(dead), 0);
  check("categoryOf(Dead Field)", sandbox.categoryOf(S.fields[1]), "clear");

  console.log("\n--- Ghost_Field (not in Analytics at all) ---");
  check("notSynced", ghost.notSynced, true);
  check("categoryOf(Ghost_Field)", sandbox.categoryOf(S.fields[2]), "na");
  check("naLabel", sandbox.naLabel(), "not synced");

  console.log("\n--- rendering ---");
  const chip = sandbox.chipFor(S.fields[0]);
  report("chip(Stage)", chip.replace(/<svg[\s\S]*?<\/svg>/g, "[svg]"));
  check("chip has 7 badges", (chip.match(/class='chip /g) || []).length, 7);

  sandbox.renderDetail(S.fields[0]);
  const html = $el("detail-body").innerHTML;
  const sections = (html.match(/id='section-[a-zA-Z]+'/g) || []);
  report("sections", sections.join(", "));
  check("recheck button present", /data-recheck='Stage'/.test(html), true);
  check("no leftover inline handler", /onclick=/.test(html), false);

  sandbox.renderDetail(S.fields[2]);
  report("na verdict", $el("detail-body").innerHTML.match(/<b>[^<]*<\/b>/)[0]);

  sandbox.renderDetail(S.fields[1]);
  report("clear verdict", $el("detail-body").innerHTML.match(/<div class='verdict clear'>[\s\S]*?<small>/)[0].replace(/\s+/g, " "));

  console.log("\n--- csv ---");
  report("usageList(Stage)", sandbox.usageList(stage).join(" | "));
  check("csv row count", sandbox.usageList(stage).length, 8);
  report("scope", sandbox.scopeSummary());

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
