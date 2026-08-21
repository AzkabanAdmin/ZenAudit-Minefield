"use strict";

/* **********************************************************************
 *   Shared_State
 ********************************************************************** */

/*
 *   Every file reads and writes S; nothing else holds cross-feature data.
 *   Each scan source stores its results in a list plus a matching
 *   <name>Scanned flag, and SCANS in sources.js is what walks those pairs
 *   when caching, restoring and summarising a scan.
 */

var S = {
  orgId: null,
  workspaces: [],     // {workspaceId, workspaceName, selected}
  folders: [],        // {folderId, folderName, wsId, wsName, selected}
  tables: [],         // {wsId, wsName, viewId, viewName, columns:[{columnId, columnName}]}
  queryTables: [],    // {wsId, wsName, viewId, viewName, sql}
  analyticsScanned: false,
  functions: [],      // {id, name, code}
  functionsScanned: false,
  reports: [],        // {id, name, folderName, moduleApiName, joins, refs:[{apiName, kind}]}
  reportsScanned: false,
  reportsSkippedStale: 0,
  //==========// matching keys off moduleId; moduleApiName is kept for display
  //==========// only (see currentModuleId in fields.js for why)
  workflowFieldUpdates: [], // {id, name, moduleApiName, moduleId, fieldApiName, value, valueType, featureType}
  workflowFieldUpdatesScanned: false,
  // functionActions is what wires a function to a module: a rule on Accounts
  // that invokes Call_X proves Call_X is about Accounts, even when its own
  // code never names a module (see functionTouchesModule in fields.js).
  workflowRules: [], // {id, name, moduleApiName, moduleId, triggerFields, criteriaFields, functionActions:[{name, id}]}
  workflowRulesScanned: false,
  scoringRules: [], // {id, name, moduleApiName, moduleId, criteriaFields:[apiName]}
  scoringRulesScanned: false,
  blueprintFields: [], // {id, name, moduleApiName, moduleId, fieldApiName, pipelineName}
  blueprintFieldsScanned: false,
  //==========// webhooks are the one source matched on moduleApiName: a merge tag
  //==========// names its module as text, with no id to fall back on
  webhookActions: [], // {id, name, moduleApiName, fieldRefs:[{moduleApiName, fieldApiName}]}
  webhookActionsScanned: false,
  connectedWorkflowRules: [], // {id, name, moduleApiName, moduleId, triggerFields:[apiName], criteriaFields:[apiName]}
  connectedWorkflowRulesScanned: false,
  viewCount: 0,
  //==========// a scan that could not read every table has to say so, rather than
  //==========// letting a verdict imply coverage it does not have
  viewsUnreadable: 0,
  //==========// what a scan would cost, from the listing pass (see Scan_Plan)
  plan: null,
  //==========// filename when the data on screen was loaded rather than scanned
  importedFrom: null,
  //==========// how long the last real scan took, which decides whether saving it
  //==========// is worth suggesting
  scanStartedAt: null,
  lastScanSeconds: null,
  modules: [],
  fields: [],
  results: {},        // field api_name -> usage result (see checkField)
  depCache: {},       // columnId -> dependents payload
  activeField: null,
  scannedAt: null,
  checking: false,
  scanning: false,
  sdkReady: false,
  filter: "all",
  crmZgid: null,
  moduleFieldsCache: {},   // module api_name -> [{label, api_name}], for the reverse audit
  reverseAuditResults: []  // [{table, module, unmatched}], see reverse-audit.js
};
var SCAN_KEY = "fieldcheck.scan.v3";
