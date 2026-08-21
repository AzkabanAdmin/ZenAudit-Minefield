"use strict";
//==========// Exercises Deluge function matching, the one heuristic source. Its
//==========// rule is that a match counts only when the module is part of the
//==========// reference, so a generic API name like Name cannot pull in every
//==========// prose string and local variable in the org.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

//==========// a real standalone function from the live org, kept verbatim
const ACCOUNT_FOLDER_FN = fs.readFileSync(
  path.join(__dirname, "fixtures", "create_or_search_account_google_folder.dg"), "utf8");

const els = { "module-pick": { value: "Invoices", selectedOptions: [{ textContent: "Invoices" }] } };
const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent,
  document: { getElementById: (id) => els[id] || { value: "" }, createElement: () => ({}) },
  ZOHO: { CRM: { META: {} } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["state.js", "helpers.js", "sources.js", "fields.js"]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), sandbox, { filename: f });
}
const S = sandbox.S;
S.modules = [{ api_name: "Invoices", id: "M_INV", plural_label: "Invoices", singular_label: "Invoice" }];

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

//==========// standard field: generic name, so the module must be anchored
function hitsFor(apiName, code) {
  S.functions = [{ id: "1", name: "fn", code: code }];
  return sandbox.functionHits({ api_name: apiName, label: apiName, custom: false });
}

//==========// custom field: distinctive name, so matching is loose
function customHitsFor(apiName, code) {
  S.functions = [{ id: "1", name: "fn", code: code }];
  return sandbox.functionHits({ api_name: apiName, label: apiName, custom: true });
}

/* **********************************************************************
 *   Attribution_Is_Required
 *
 *   A match counts only when the module is part of the reference. These
 *   cases all came from a live org where the Invoices module's "Invoice
 *   Number" field has the API name "Name", and every one of them was
 *   reported as a hit before attribution became mandatory.
 ********************************************************************** */

check("a code comment is not a reference",
  hitsFor("Name", 'x = 1; // Keys: // Name (required) - folder display name').length, 0);
check("a prose string literal is not a reference",
  hitsFor("Name", 'info "Name: " + att.get("name");').length, 0);
check("a local variable called Name is not a reference",
  hitsFor("Name", 'Name = Account.get("Account_Name"); info Name;').length, 0);
check("an unattributed get is not a reference",
  hitsFor("Name", 'v = someRecord.get("Name");').length, 0);
check("input.Name is not attributable, so it is dropped",
  hitsFor("Name", "y = input.Name;").length, 0);

/* **********************************************************************
 *   Form_A_Variable_Tied_To_The_Module
 ********************************************************************** */

check("getRecordById on this module attributes the access",
  hitsFor("Name", 'inv = zoho.crm.getRecordById("Invoices", id); n = inv.get("Name");').length, 1);
check("getRecordById on another module does not",
  hitsFor("Name", 'd = zoho.crm.getRecordById("Deals", id); n = d.get("Name");').length, 0);
check("the dot form is attributed too",
  hitsFor("Name", 'inv = zoho.crm.getRecords("Invoices"); n = inv.Name;').length, 1);
check("a map passed to updateRecord for this module is attributed",
  hitsFor("Name", 'm = Map(); m.put("Name","INV-1"); zoho.crm.updateRecord("Invoices", id, m);').length, 1);
check("the data envelope unwrap carries the module through",
  hitsFor("Name", 'r = invokeurl [ url : "https://x/crm/v8/Invoices" ]; d = r.get("data"); n = d.get("Name");').length, 1);

/* **********************************************************************
 *   Form_B_One_Call_Naming_Module_And_Field
 ********************************************************************** */

check("a criteria string alongside the module is attributed",
  hitsFor("Name", 'r = zoho.crm.searchRecords("Invoices", "(Name:equals:INV-1)");').length, 1);
check("the same criteria against another module is not",
  hitsFor("Name", 'r = zoho.crm.searchRecords("Deals", "(Name:equals:INV-1)");').length, 0);

/* **********************************************************************
 *   Boundaries_And_Counting
 ********************************************************************** */

check("Account_Name is not a match for Name",
  hitsFor("Name", 'inv = zoho.crm.getRecordById("Invoices", id); a = inv.get("Account_Name");').length, 0);
check("lowercase get(\"name\") is not a match for Name",
  hitsFor("Name", 'inv = zoho.crm.getRecordById("Invoices", id); a = inv.get("name");').length, 0);

const counted = hitsFor("Name",
  'inv = zoho.crm.getRecordById("Invoices", id); a = inv.get("Name"); b = inv.get("Account_Name"); c = inv.Name;');
check("only attributed refs are counted", counted[0].count, 2);
check("the snippet shows an attributed ref",
  /inv\.get\("Name"\)/.test(counted[0].snippet), true);

//==========// api names under three characters are skipped as hopeless
check("very short api names are skipped",
  hitsFor("ID", 'inv = zoho.crm.getRecordById("Invoices", x); v = inv.get("ID");').length, 0);

/* **********************************************************************
 *   A_Real_Function_From_The_Org
 *
 *   Create_Or_Search_Account_Google_Folder names its module only through
 *   an invokeurl REST path, and holds the field name in a config variable
 *   before using it. Both are why it was being missed.
 ********************************************************************** */

els["module-pick"] = { value: "Accounts", selectedOptions: [{ textContent: "Accounts" }] };

const accountHits = customHitsFor("GDrive_ID", ACCOUNT_FOLDER_FN);
check("a field name held in a config variable is found", accountHits.length, 1);
check("the snippet shows the assignment that names it",
  /CRM_GDrive_ID = "GDrive_ID"/.test(accountHits[0].snippet), true);
check("the second config field is found too",
  customHitsFor("Shared_Google_Folder", ACCOUNT_FOLDER_FN).length, 1);

//==========// the module is named only in the REST path, never via zoho.crm.*
check("an invokeurl REST path anchors the module",
  sandbox.functionTouchesModule(ACCOUNT_FOLDER_FN, "Accounts", {}), true);
check("a module the function never touches does not anchor",
  sandbox.functionTouchesModule(ACCOUNT_FOLDER_FN, "Invoices", {}), false);

//==========// "Folder Name: " is prose, but Subfolder.get("Name") is a real name
check("prose with a trailing colon and space is not a criteria clause",
  hitsFor("Name", ACCOUNT_FOLDER_FN).length, 1);

//==========// auditing a module this function never touches must yield nothing
els["module-pick"] = { value: "Invoices", selectedOptions: [{ textContent: "Invoices" }] };
//==========// a custom name is distinctive, so it is reported wherever it appears
check("a custom field is found whichever module is selected",
  customHitsFor("GDrive_ID", ACCOUNT_FOLDER_FN).length, 1);
check("Name on Invoices stays clean against this function",
  hitsFor("Name", ACCOUNT_FOLDER_FN).length, 0);

/* **********************************************************************
 *   Custom_Fields_Are_Searched_Loosely
 *
 *   A custom API name is org-specific, so it does not need the module
 *   anchored. A standard name like Name does, because it collides with
 *   prose and local variables everywhere.
 ********************************************************************** */

els["module-pick"] = { value: "Accounts", selectedOptions: [{ textContent: "Accounts" }] };

const noAnchor = 'x = Map(); x.put("Custom_Ref_ID", 1);';
check("a custom field needs no module anchor",
  customHitsFor("Custom_Ref_ID", noAnchor).length, 1);
check("a standard field still does",
  hitsFor("Custom_Ref_ID", noAnchor).length, 0);

//==========// a distinctive custom name is worth finding as a bare identifier
check("a custom field is found as a bare identifier",
  customHitsFor("Custom_Ref_ID", "Custom_Ref_ID = 5;").length, 1);
//==========// a bare identifier is how a field arrives as a function argument, so
//==========// it counts once the module is anchored, and only then
check("a standard field matches as a bare identifier once anchored",
  hitsFor("Stage", 'i = zoho.crm.getRecordById("Accounts", x); Stage = 5;').length, 1);
check("a standard field does not match as a bare identifier unanchored",
  hitsFor("Stage", "Stage = 5;").length, 0);

//==========// a longer identifier or string containing the name is still not a match
check("a custom name inside a longer identifier is not a match",
  customHitsFor("GDrive_ID", "Account_GDrive_ID = 5;").length, 0);
check("a custom name inside a longer string is not a match",
  customHitsFor("GDrive_ID", 'x = "Account_GDrive_ID";').length, 0);

//==========// looseness never overrides positive disproof
check("a custom field proven to belong to another module is dropped",
  customHitsFor("Custom_Ref_ID",
    'd = zoho.crm.getRecordById("Deals", id); v = d.get("Custom_Ref_ID");').length, 0);

/* **********************************************************************
 *   Automation_Wiring_Anchors_A_Function
 *
 *   A thin automation wrapper names no module in its own code. CRM knows
 *   which module fires it, so the rule action list supplies the anchor.
 ********************************************************************** */

const WRAPPER = "void automation.Call_Do_Thing(Int Account_ID, String Account_Name) " +
  "{ Response = standalone.Do_Thing(Account_ID, Account_Name); info Response; }";

function wrapperHits(module, apiName) {
  els["module-pick"] = { value: module, selectedOptions: [{ textContent: module }] };
  S.functions = [{ id: "9", name: "Call_Do_Thing", code: WRAPPER }];
  return sandbox.functionHits({ api_name: apiName, label: apiName, custom: false }).length;
}

S.workflowRulesScanned = false;
S.workflowRules = [];
check("with no wiring known, the wrapper is not anchored",
  wrapperHits("Accounts", "Account_Name"), 0);

//==========// teach it that an Accounts rule invokes this function
S.workflowRulesScanned = true;
S.workflowRules = [{
  id: "r1", name: "Call rule", moduleApiName: "Accounts", moduleId: "1",
  triggerFields: [], criteriaFields: [],
  functionActions: [{ name: "Call_Do_Thing", id: "a1" }],
}];
check("automation wiring anchors the wrapper",
  wrapperHits("Accounts", "Account_Name"), 1);

//==========// wiring to one module must not anchor a different one
check("wiring to Accounts does not anchor Deals",
  wrapperHits("Deals", "Deal_Name"), 0);

//==========// leave state clean for anything appended later
S.workflowRulesScanned = false;
S.workflowRules = [];

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL DELUGE CHECKS PASSED");
process.exit(failures ? 1 : 0);
