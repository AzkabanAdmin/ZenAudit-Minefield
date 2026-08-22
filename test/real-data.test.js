"use strict";
//==========// Runs matching against a real cached scan from a large, messy org:
//==========// hundreds of Analytics tables and Deluge functions.
//==========//
//==========// The assertions are properties rather than a list of expected function
//==========// names, so refreshing the fixture from a different org does not
//==========// invalidate them. Real field and module pairs are taken from the org's
//==========// own automation data, which is ground truth: a workflow field update
//==========// names both the module and the field it writes.
//==========//
//==========// The fixture is a real scan of Zenatta's shared testing org and is
//==========// deliberately NOT committed: a scan carries Deluge source verbatim, and
//==========// ours held a live API key the first time we tried. So this suite skips
//==========// unless someone supplies their own. To make one, run a scan, use Save
//==========// scan to file, and drop it at test/fixtures/scan-cache.json.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CACHE = path.join(__dirname, "fixtures", "scan-cache.json");
if (!fs.existsSync(CACHE)) {
  console.log("SKIP real-data suite: test/fixtures/scan-cache.json is not present");
  process.exit(0);
}

const APP = path.join(__dirname, "..", "app", "js");
const els = { "module-pick": { value: "Deals", selectedOptions: [{ textContent: "Deals" }] } };
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

const S = sandbox.S;
const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
for (const k of ["functions", "tables", "queryTables", "reports", "workflowRules",
  "workflowFieldUpdates", "scoringRules", "blueprintFields", "webhookActions",
  "connectedWorkflowRules"]) {
  S[k] = cache[k] || [];
}
for (const k of Object.keys(cache)) {
  if (k.endsWith("Scanned")) S[k] = cache[k];
}

//==========// every module the org's own automations mention
const moduleNames = new Set();
for (const list of [S.workflowFieldUpdates, S.workflowRules, S.blueprintFields, S.scoringRules]) {
  for (const r of list) if (r.moduleApiName) moduleNames.add(r.moduleApiName);
}
S.modules = [...moduleNames].map((n, i) => ({
  api_name: n, id: String(i + 1), plural_label: n, singular_label: n,
}));

//==========// real field and module pairs, declared by the org rather than invented
const pairs = [];
const seenPair = new Set();
function addPair(module, field) {
  const key = module + "." + field;
  if (module && field && !seenPair.has(key)) { seenPair.add(key); pairs.push({ module, field }); }
}
S.workflowFieldUpdates.forEach((fu) => addPair(fu.moduleApiName, fu.fieldApiName));
S.blueprintFields.forEach((bp) => addPair(bp.moduleApiName, bp.fieldApiName));

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

function hits(module, apiName, custom) {
  els["module-pick"] = { value: module, selectedOptions: [{ textContent: module }] };
  return sandbox.functionHits({ api_name: apiName, label: apiName, custom: !!custom });
}

//==========// every function whose source mentions the name as a whole token. The
//==========// ceiling for any text search, so a hit outside this set is invented.
function mentions(apiName) {
  const re = new RegExp("(^|[^A-Za-z0-9_-])" +
    apiName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z0-9_-]|$)");
  return new Set(S.functions.filter((f) => re.test(f.code)).map((f) => f.name));
}

console.log("corpus: " + S.functions.length + " functions, " + S.tables.length + " tables, " +
  pairs.length + " field/module pairs declared by automations\n");

/* **********************************************************************
 *   Corpus_Is_What_We_Think
 ********************************************************************** */

check("the fixture has a substantial function corpus", S.functions.length >= 100, true);
check("and a substantial table corpus", S.tables.length >= 100, true);
check("automations declare real field pairs to test with", pairs.length >= 5, true);

/* **********************************************************************
 *   A_Hit_Is_Never_Invented
 *
 *   The strongest property available without hand-labelling every
 *   function: a reported hit must always be a function that really does
 *   contain the name as a whole token.
 ********************************************************************** */

let invented = 0;
let comparisons = 0;
for (const p of pairs) {
  const ceiling = mentions(p.field);
  for (const custom of [true, false]) {
    comparisons++;
    for (const h of hits(p.module, p.field, custom)) {
      if (!ceiling.has(h.name)) invented++;
    }
  }
}
check("no hit falls outside the set of functions that mention the name", invented, 0);
console.log("   checked " + comparisons + " field and strictness combinations");

/* **********************************************************************
 *   Strict_Is_A_Subset_Of_Loose
 *
 *   Requiring the module anchor can only remove hits, never add them.
 ********************************************************************** */

let notSubset = 0;
for (const p of pairs) {
  const loose = new Set(hits(p.module, p.field, true).map((h) => h.name));
  for (const h of hits(p.module, p.field, false)) if (!loose.has(h.name)) notSubset++;
}
check("anchoring only ever removes hits", notSubset, 0);

/* **********************************************************************
 *   Hyphenated_Neighbours_Are_Not_References
 *
 *   Content-Type appears in almost every invokeurl header block in this
 *   org, and used to read as a reference to a field named Type.
 ********************************************************************** */

const contentTypeFns = S.functions.filter((f) => /Content-Type/.test(f.code)).map((f) => f.name);
check("the corpus really does contain Content-Type headers", contentTypeFns.length >= 5, true);

const typeLoose = hits("Deals", "Type", true).map((h) => h.name);
const fromHeaderOnly = contentTypeFns.filter((name) => {
  const fn = S.functions.filter((f) => f.name === name)[0];
  //==========// functions where the only occurrence of Type is the header
  return !/(^|[^A-Za-z0-9_-])Type([^A-Za-z0-9_-]|$)/.test(fn.code);
});
check("no function is reported for Type on the strength of a Content-Type header",
  typeLoose.filter((n) => fromHeaderOnly.includes(n)), []);

/* **********************************************************************
 *   Counts_And_Snippets_Describe_Real_Occurrences
 ********************************************************************** */

let badCount = 0;
let emptySnippet = 0;
for (const p of pairs) {
  for (const h of hits(p.module, p.field, true)) {
    if (!(h.count >= 1)) badCount++;
    if (!h.snippet || !h.snippet.trim()) emptySnippet++;
  }
}
check("every hit reports at least one reference", badCount, 0);
check("every hit carries a snippet", emptySnippet, 0);

/* **********************************************************************
 *   Comments_Are_Stripped
 ********************************************************************** */

//==========// a name that only ever appears inside a comment must not be a hit
S.functions.push({
  id: "synthetic", name: "Only_In_A_Comment",
  code: 'x = zoho.crm.getRecordById("Deals", id);\n// clear the Synthetic_Marker_Field first\n',
});
check("a name only present in a comment is not a hit",
  hits("Deals", "Synthetic_Marker_Field", true).length, 0);
S.functions.pop();

/* **********************************************************************
 *   Speed
 *
 *   The detail panel checks a field on click, so a sweep over a corpus
 *   this size has to stay well inside a frame budget.
 ********************************************************************** */

const t0 = Date.now();
for (const p of pairs) hits(p.module, p.field, false);
const ms = Date.now() - t0;
console.log("   swept " + pairs.length + " fields across " + S.functions.length +
  " functions in " + ms + "ms");
check("a full sweep stays comfortably fast", ms < 2000, true);

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL REAL-DATA CHECKS PASSED");
process.exit(failures ? 1 : 0);
