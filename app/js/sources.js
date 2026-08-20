"use strict";

/* **********************************************************************
 *   Usage_Source_Registry
 *
 *   Every place a CRM field can be referenced is described once, here,
 *   and every screen derives itself from these two tables: the field
 *   chips, the verdict prose, the detail panel sections, the CSV export,
 *   the scan summary line, and the "scope" footnote.
 *
 *   Adding a new source means adding a scan entry, a source entry, and a
 *   matcher. Nothing else needs to change.
 *
 *   Zoho Analytics is deliberately not in here. It is the only source
 *   answering through Zoho's dependency engine rather than a field-name
 *   match, so its results carry a different shape (columns and their
 *   dependents) and stay explicit in fields.js and ui.js.
 ********************************************************************** */

//==========// pluralize a count's unit: qty(3, "rule") -> "rules"
function qty(n, unit) { return unit + (n === 1 ? "" : "s"); }

/* **********************************************************************
 *   Scans
 *
 *   One entry per scan that can run, keyed by its S.<flag>. A scan is
 *   the unit the user toggles and the unit a verdict has to account for,
 *   which is why workflow rules appear once here but twice in SOURCES:
 *   one scan produces both trigger and criteria matches.
 *
 *   unit is singular; every display site pluralizes it through qty().
 ********************************************************************** */

var SCANS = [
  {
    flag: "functionsScanned", store: "functions",
    unit: "function", noun: "CRM Deluge functions",
    absence: "no CRM function references it"
  },
  {
    flag: "reportsScanned", store: "reports",
    unit: "report", noun: "CRM reports",
    absence: "no CRM report references it"
  },
  {
    flag: "workflowFieldUpdatesScanned", store: "workflowFieldUpdates",
    unit: "workflow field update", noun: "workflow field updates",
    absence: "no workflow field update references it"
  },
  {
    flag: "workflowRulesScanned", store: "workflowRules",
    unit: "workflow rule", noun: "workflow rule triggers and criteria",
    absence: "no workflow rule trigger or criteria references it"
  },
  {
    flag: "scoringRulesScanned", store: "scoringRules",
    unit: "scoring rule", noun: "scoring rules",
    absence: "no scoring rule references it"
  },
  {
    flag: "blueprintFieldsScanned", store: "blueprintFields",
    unit: "blueprint", noun: "blueprints",
    absence: "it doesn't govern a blueprint"
  },
  {
    flag: "webhookActionsScanned", store: "webhookActions",
    unit: "webhook", noun: "webhooks",
    absence: "no webhook references it"
  },
  {
    flag: "connectedWorkflowRulesScanned", store: "connectedWorkflowRules",
    unit: "connected workflow rule", noun: "connected workflow rules",
    absence: "no connected workflow rule references it"
  }
];

function ranScans() {
  return SCANS.filter(function (s) { return !!S[s.flag]; });
}

//==========// "CRM reports and blueprints", for the verdict headline
function ranScanNouns() {
  return ranScans().map(function (s) { return s.noun; });
}

//==========// "no CRM report references it, and it doesn't govern a blueprint"
function ranScanAbsences() {
  return ranScans().map(function (s) { return s.absence; });
}

//==========// "a, b and c" without a trailing-comma seam
function joinPhrases(parts, lastJoiner) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " " + lastJoiner + " " + parts[parts.length - 1];
}

/* **********************************************************************
 *   Sources
 *
 *   One entry per kind of match a field can have, in the order they are
 *   shown. `key` is both the S.results field and the id suffix of the
 *   detail-panel section, so the chip breakdown can link straight to it.
 *
 *   card() renders one hit; csv() flattens one hit into an export cell.
 *   Both receive the raw hit object built by the matcher in fields.js.
 ********************************************************************** */

var SOURCES = [
  {
    key: "functions", flag: "functionsScanned",
    chip: "src-fn", icon: "function",
    label: "CRM functions",
    unit: "CRM function reference",
    heading: function (f) { return "CRM Deluge functions referencing " + esc(f.api_name); },
    countUnit: "function",
    card: function (h) {
      return usageCard("function" + (h.count > 1 ? " (" + h.count + " references)" : ""),
        h.name, null, functionsPageUrl(), h.snippet, "Open Functions page &rarr;");
    },
    csv: function (h) { return "function: " + h.name; }
  },
  {
    key: "reports", flag: "reportsScanned",
    chip: "src-rpt", icon: "report",
    label: "CRM reports",
    unit: "CRM report reference",
    heading: function (f) { return "CRM reports referencing " + esc(f.api_name); },
    countUnit: "report",
    card: function (h) {
      return usageCard("report " + h.kind + (h.confident ? "" : " - unverified match"),
        h.reportName, h.folderName, reportPageUrl(h.reportId), "", "Open report &rarr;");
    },
    csv: function (h) { return "report " + h.kind + (h.confident ? "" : " (unverified)") + ": " + h.reportName; }
  },
  {
    key: "workflows", flag: "workflowFieldUpdatesScanned",
    chip: "src-wf", icon: "workflow",
    label: "workflow field updates",
    unit: "workflow field update reference",
    heading: function (f) { return "Workflow field updates referencing " + esc(f.api_name); },
    countUnit: "field update",
    card: function (h) {
      var val = Array.isArray(h.value) ? h.value.join(", ") : h.value;
      return usageCard("workflow field update", h.name, h.featureType || null, fieldUpdatePageUrl(h.id),
        val ? "sets to: " + val : "", "Open field update &rarr;");
    },
    csv: function (h) { return "workflow field update: " + h.name; }
  },
  {
    key: "triggers", flag: "workflowRulesScanned",
    chip: "src-trig", icon: "trigger",
    label: "workflow rule triggers",
    unit: "workflow rule trigger",
    tip: function (n) { return "used as a trigger in " + n + qty(n, " workflow rule"); },
    heading: function (f) { return "Workflow rules triggered off " + esc(f.api_name); },
    countUnit: "rule",
    card: function (h) {
      return usageCard("rule trigger", h.name, null, workflowRulePageUrl(h.id), "", "Open workflow rule &rarr;");
    },
    csv: function (h) { return "workflow rule trigger: " + h.name; }
  },
  {
    key: "criteria", flag: "workflowRulesScanned",
    chip: "src-crit", icon: "criteria",
    label: "workflow rule criteria",
    unit: "workflow rule criteria",
    tip: function (n) { return "used in firing criteria for " + n + qty(n, " workflow rule"); },
    heading: function (f) { return "Workflow rules with firing criteria on " + esc(f.api_name); },
    countUnit: "rule",
    card: function (h) {
      return usageCard("rule criteria", h.name, null, workflowRulePageUrl(h.id), "", "Open workflow rule &rarr;");
    },
    csv: function (h) { return "workflow rule criteria: " + h.name; }
  },
  {
    key: "scoring", flag: "scoringRulesScanned",
    chip: "src-score", icon: "scoring",
    label: "scoring rules",
    unit: "scoring rule",
    tip: function (n) { return "used in scoring criteria for " + n + qty(n, " scoring rule"); },
    heading: function (f) { return "Scoring rules referencing " + esc(f.api_name); },
    countUnit: "rule",
    card: function (h) {
      return usageCard("scoring rule", h.name, null, scoringRulePageUrl(h.id), "", "Open scoring rule &rarr;");
    },
    csv: function (h) { return "scoring rule: " + h.name; }
  },
  {
    key: "blueprint", flag: "blueprintFieldsScanned",
    chip: "src-blueprint", icon: "blueprint",
    label: "blueprints",
    unit: "blueprint",
    tip: function (n) { return "governs " + n + qty(n, " blueprint"); },
    heading: function (f) { return "Blueprints governed by " + esc(f.api_name); },
    countUnit: "blueprint",
    card: function (h) {
      return usageCard("blueprint", h.name, h.pipelineName || null,
        blueprintPageUrl(h.id, $("module-pick").value), "", "Open blueprint &rarr;");
    },
    csv: function (h) {
      return "blueprint: " + h.name + (h.pipelineName ? " (pipeline: " + h.pipelineName + ")" : "");
    }
  },
  {
    key: "webhooks", flag: "webhookActionsScanned",
    chip: "src-webhook", icon: "webhook",
    label: "webhooks",
    unit: "webhook",
    tip: function (n) { return "referenced in " + n + qty(n, " webhook"); },
    heading: function (f) { return "Webhooks referencing " + esc(f.api_name); },
    countUnit: "webhook",
    card: function (h) { return usageCard("webhook", h.name, null, null, ""); },
    csv: function (h) { return "webhook: " + h.name; }
  },
  {
    key: "cwTriggers", flag: "connectedWorkflowRulesScanned",
    chip: "src-cwtrig", icon: "trigger",
    label: "connected workflow triggers",
    unit: "connected workflow trigger",
    tip: function (n) { return "used as a trigger in " + n + qty(n, " connected workflow rule"); },
    heading: function (f) { return "Connected workflow rules triggered off " + esc(f.api_name); },
    countUnit: "rule",
    card: function (h) { return usageCard("connected automation trigger", h.name, null, null, ""); },
    csv: function (h) { return "connected workflow trigger: " + h.name; }
  },
  {
    key: "cwCriteria", flag: "connectedWorkflowRulesScanned",
    chip: "src-cwcrit", icon: "criteria",
    label: "connected workflow criteria",
    unit: "connected workflow criteria",
    tip: function (n) { return "used in firing criteria for " + n + qty(n, " connected workflow rule"); },
    heading: function (f) { return "Connected workflow rules with firing criteria on " + esc(f.api_name); },
    countUnit: "rule",
    card: function (h) { return usageCard("connected automation criteria", h.name, null, null, ""); },
    csv: function (h) { return "connected workflow criteria: " + h.name; }
  }
];

//==========// hits recorded for one source on one already-checked field
function hitsFor(result, src) { return result[src.key] || []; }

//==========// chip tooltip: a source's own phrasing, or the default "N x references"
function sourceTip(src, n) {
  return src.tip ? src.tip(n) : n + " " + qty(n, src.unit);
}
