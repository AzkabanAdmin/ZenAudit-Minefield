"use strict";
//==========// Runs matching against a real cached scan from a live org: 45 Deluge
//==========// functions, 49 Analytics tables, 16 workflow rules.
//==========//
//==========// The cache holds a real org's function source, so it is gitignored
//==========// rather than committed. Without it this suite skips. To refresh it,
//==========// run a scan in the widget and export the localStorage scan key to
//==========// test/fixtures/scan-cache.json.
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
const els = { "module-pick": { value: "Accounts", selectedOptions: [{ textContent: "Accounts" }] } };
const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent, Date,
  document: { getElementById: (id) => els[id] || { value: "" }, createElement: () => ({}) },
  ZOHO: { CRM: { META: {} } },
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
S.modules = ["Accounts", "Deals", "Invoices", "Contacts"].map((n, i) => ({
  api_name: n, id: String(i + 1), plural_label: n, singular_label: n.replace(/s$/, ""),
}));

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

function names(module, apiName, custom) {
  els["module-pick"] = { value: module, selectedOptions: [{ textContent: module }] };
  return sandbox.functionHits({ api_name: apiName, label: apiName, custom: !!custom })
    .map((h) => h.name).sort();
}

//==========// every function whose source mentions the name at a word boundary,
//==========// ignoring attribution entirely. The recall ceiling for a text search.
function mentions(apiName) {
  const re = new RegExp("(^|[^A-Za-z0-9_])" + apiName + "([^A-Za-z0-9_]|$)");
  return S.functions.filter((f) => re.test(f.code)).map((f) => f.name).sort();
}

console.log("loaded " + S.functions.length + " functions, " + S.tables.length + " tables\n");

/* **********************************************************************
 *   Custom_Fields_Reach_The_Recall_Ceiling
 *
 *   A distinctive custom name should be found in every function that
 *   mentions it, which is what makes the verdict trustworthy.
 ********************************************************************** */

check("GDrive_ID is found in every function that mentions it",
  names("Accounts", "GDrive_ID", true), mentions("GDrive_ID"));
check("Shared_Google_Folder likewise",
  names("Accounts", "Shared_Google_Folder", true), mentions("Shared_Google_Folder"));

/* **********************************************************************
 *   Standard_Fields_Stay_Precise
 ********************************************************************** */

//==========// the case that started this: Name on Invoices matched 22 functions,
//==========// every one of them a comment, a log string, or a local variable
check("Invoices.Name matches no functions", names("Invoices", "Name"), []);

//==========// but a standard field genuinely used through a module-tied variable
//==========// is still found
check("Deals.Deal_Name is found in all four real callers",
  names("Deals", "Deal_Name"),
  ["Automatic_Deal_Name", "Create_Or_Search_Deal_Folder",
    "Create_Or_Search_Deal_Google_Folder", "Rename Deal Record to Service and Name"]);
check("Accounts.Account_Name is found where it is read",
  names("Accounts", "Account_Name"), ["Test Using AC"]);
check("Deals.Amount is found where it is read", names("Deals", "Amount"), ["Automatic_Deal_Name"]);

/* **********************************************************************
 *   Comments_Are_Not_References
 ********************************************************************** */

//==========// the Account folder function mentions GDrive_ID twice, once in a
//==========// comment telling you to clear the field. Only the real one counts.
els["module-pick"] = { value: "Accounts", selectedOptions: [{ textContent: "Accounts" }] };
const accountFolder = sandbox.functionHits(
  { api_name: "GDrive_ID", label: "GDrive ID", custom: true })
  .filter((h) => h.name === "Create_Or_Search_Account_Google_Folder")[0];
check("the commented mention is not counted", accountFolder.count, 1);
check("the counted one is the config assignment",
  /CRM_GDrive_ID = "GDrive_ID"/.test(accountFolder.snippet), true);

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL REAL-DATA CHECKS PASSED");
process.exit(failures ? 1 : 0);
