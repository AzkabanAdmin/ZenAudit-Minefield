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

function hitsFor(apiName, code) {
  S.functions = [{ id: "1", name: "fn", code: code }];
  return sandbox.functionHits({ api_name: apiName, label: apiName });
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

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL DELUGE CHECKS PASSED");
process.exit(failures ? 1 : 0);
