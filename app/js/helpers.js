"use strict";

// DOM, URL, and text utilities plus the API transport layer.

function $(id) { return document.getElementById(id); }
function apiBase() { return $("dc").value; }
function webBase() { return apiBase().replace("analyticsapi.", "analytics."); }
function crmApiBase() { return apiBase().replace("https://analyticsapi.zoho", "https://www.zohoapis"); }
function crmWebBase() { return apiBase().replace("analyticsapi.zoho", "crm.zoho"); }
// Workspace-scoped URL opens the editable view, unlike /open-view/
function viewLink(wsId, viewId) { return webBase() + "/workspace/" + wsId + "/view/" + viewId; }
function functionsPageUrl() {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/functions/myFunctions"
    : crmWebBase() + "/crm/settings/functions";
}
// Deep links confirmed against a live org; without zgid resolved yet, fall
// back to the generic list page rather than guess whether an org-less path
// still accepts the record ID, same caution as functionsPageUrl's fallback.
function reportPageUrl(reportId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/tab/Reports/" + reportId
    : crmWebBase() + "/crm/tab/Reports";
}
function workflowRulePageUrl(ruleId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/workflow-rules/" + ruleId
    : crmWebBase() + "/crm/settings/workflow-rules";
}
function fieldUpdatePageUrl(fieldUpdateId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/field-updates/" + fieldUpdateId
    : crmWebBase() + "/crm/settings/field-updates";
}
function scoringRulePageUrl(ruleId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/scoring-rules/" + ruleId
    : crmWebBase() + "/crm/settings/scoring-rules";
}
function blueprintPageUrl(blueprintId, moduleApiName) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/blueprint/" + blueprintId + "?module=" + moduleApiName
    : crmWebBase() + "/crm/settings/blueprint";
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
// "Account Name", "Account_Name" and "account_name" all normalize to account_name
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function showError(msg) { var e = $("setup-error"); e.classList.remove("hidden"); e.textContent = msg; }
function clearError() { $("setup-error").classList.add("hidden"); }

// All external calls go through a named Connection so OAuth and CORS are
// handled server-side by CRM. This is the portability linchpin.
function invokeConn(connName, url, headers) {
  var req = { url: url, method: "GET", param_type: 1, parameters: {}, headers: headers || {} };
  return ZOHO.CRM.CONNECTION.invoke(connName, req).then(function (resp) {
    var body = resp && resp.details && resp.details.statusMessage;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { /* raw text, e.g. function code */ } }
    if (!body || body.status === "failure") {
      throw new Error("API error at " + url + "\n" + JSON.stringify(body || resp).slice(0, 500));
    }
    return body;
  });
}
function analyticsGet(path, config) {
  var url = apiBase() + "/restapi/v2" + path;
  if (config) url += (path.indexOf("?") < 0 ? "?" : "&") + "CONFIG=" + encodeURIComponent(JSON.stringify(config));
  return invokeConn($("conn-analytics").value.trim(), url, S.orgId ? { "ZANALYTICS-ORGID": S.orgId } : {});
}
function crmGet(path) {
  return invokeConn($("conn-crm").value.trim(), crmApiBase() + "/crm/v8" + path);
}
function booksGet(path) {
  var sep = path.indexOf("?") < 0 ? "?" : "&";
  return invokeConn($("conn-books").value.trim(),
    crmApiBase() + "/books/v3" + path + sep + "organization_id=" + S.booksOrgId);
}
// Run fn over items one at a time so we stay friendly with API limits
function runQueue(items, fn, onStep) {
  return items.reduce(function (p, item, i) {
    return p.then(function () {
      if (onStep) onStep(i + 1, items.length, item);
      return fn(item);
    });
  }, Promise.resolve());
}
