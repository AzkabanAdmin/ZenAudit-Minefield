# ZenAudit MineField

**Know what breaks before you delete a field.**

A Zoho CRM web tab widget that inventories every field in every module and shows exactly where each one is actually used, across Zoho Analytics, CRM Deluge functions, CRM reports, and six kinds of CRM automation. Pick a module, click a field (or check all of them at once), and get a verdict backed by Zoho's own dependency data.

Built for the Zenatta 2026 Summer Design Competition (Track 1: Widget Development).

## Why

When you delete a CRM field, Zoho warns you about some workflows and blueprints. It says nothing about Zoho Analytics or Deluge code. The field disappears, and days later a client's dashboard is broken, a query table errors out, or a function starts failing silently.

Today the only real "solution" is opening every report and script by hand. ZenAudit MineField closes that gap, and doubles as a dead-field detector for org cleanup engagements: fields that nothing references anywhere are exactly the ones safe to retire.

## What it checks

Each scan source is an independent toggle. Turn on only what you need; the more you enable, the more confident the "safe to delete" verdict becomes.

| Source | What it finds | Default |
|---|---|---|
| **Zoho Analytics** | Dependent views, formula columns, aggregate formulas, and query table SQL | On |
| **CRM Deluge functions** | Function code that references the field's API name | On |
| **CRM Automations** | Six sub-scans in one toggle (below) | Off |
| **CRM Reports** | Report columns and filter criteria | Off |
| **Zoho Books** | Same-named Books fields, informational only | Off |
| **Reverse Analytics Audit** | Runs the opposite direction, standalone (below) | Off |

**CRM Automations** covers workflow field updates, workflow rules (triggers and firing criteria tracked separately, since "fires the rule" and "filters the rule" are different facts), scoring rules, blueprints, webhooks, and connected workflows (Zoho Flow-triggered rules).

**Reverse Analytics Audit** asks the opposite question: which columns exist in Analytics but have no matching CRM field? That surfaces orphans left behind by a renamed or deleted field, so it's where to start if your Analytics sync broke and you don't know why. It runs standalone and locks out the other sources while selected.

Shown as "Soon" in the UI and not yet built: CRM Dashboards, CRM Lookup Fields, and a standalone function scan.

## How confident is each result?

Not every source can be equally certain, so the app never pretends otherwise. This is the single most important thing to understand when reading a verdict.

| Tier | Sources | How it matches |
|---|---|---|
| **Exact** | Analytics, workflow field updates, workflow rules, scoring rules, blueprints, connected workflows | Zoho's own dependency engine by `columnId`, or module **id** + field API name straight from the API |
| **High** | CRM reports, webhooks | Report refs resolved through the report's own joins; webhook `${!Module.Field}` merge tags. Report references more than one join hop deep are labeled **unverified** rather than treated as certain |
| **Heuristic** | CRM Deluge functions | Word-boundary regex on the field's API name, narrowed by inferring which module each Deluge variable belongs to, so a Contacts-scoped `First_Name` doesn't bleed into a Leads audit |
| **Informational** | Zoho Books | Name match only, because Zoho's CRM-Books sync mapping isn't readable via API. Displayed alongside the verdict but **never** counted toward it |

Automation matching keys off module **id**, not API name, because different CRM endpoints disagree about the same module's name string (Deals reports as "Potentials" from Blueprints in some orgs). The id is consistent everywhere.

## Verdicts

- **`N` in use** — something depends on this field. The detail panel breaks the number down by source, each with a link out to the exact view, report, rule, or settings page so you can fix it before deleting.
- **unused** — synced to Analytics, and Zoho's dependency engine reports nothing depending on it.
- **not synced** / **not in Analytics** — no matching column exists at all, and nothing else references it. Also safe, and usually a dead field.
- **no Books match** — only appears on a Books-only scan, where no usage source was checked.

## Using it

**1. Connect and scan.** Pick your data center and org, toggle the sources you want, then Scan. Analytics workspace and folder pickers appear only for the Reverse Analytics Audit, which is the one operation that needs the extra narrowing. Results cache in `localStorage`, so "Use cached scan" skips a re-scan next time.

**2. Fields.** Pick a module. Click any field to check it on demand, or **Check all fields** to badge the whole module at once. Filter chips (In use / Unused / Not in Analytics / Unchecked) carry live counts, and the search box filters by label or API name.

**3. Usage.** The detail panel shows every place the field is used, grouped by source, with code and SQL snippets where relevant and deep links into CRM and Analytics. **Export CSV** turns the whole module into a client-ready audit artifact. **Recheck this field** re-runs a single field against fresh data.

Three themes (dark by default, light, and zen) via the header dropdown, persisted between sessions.

## One-time org setup

**1. Connections** — Setup > Developer Space > Connections > Create Connection, service **Zoho OAuth**. Authorize each after creating it. Custom link names are fine, just enter them in the widget's settings panel.

| Link name | Scope | Needed for |
|---|---|---|
| `analytics` | `ZohoAnalytics.metadata.read` | Analytics + reverse audit |
| `crm` | `ZohoCRM.settings.ALL` | Functions, reports, automations |
| `books` | `ZohoBooks.settings.READ` | Zoho Books check (optional) |

`ZohoCRM.settings.ALL` is known working. If your scope picker offers them separately, the minimal set is `settings.functions.READ`, `settings.reports.READ`, `settings.automation_actions.READ`, `settings.workflow_rules.READ`, `settings.scoring_rules.READ`, `settings.blueprint.READ`, and `settings.connected_workflows.READ`. Broader scopes (`ZohoAnalytics.fullaccess.all`, `ZohoBooks.fullaccess.all`) also work.

Click any scope chip in the widget to copy it.

**2. Widget** — Setup > Developer Space > Widgets > Create. Type **Web Tab**, hosting **External** pointing at `https://127.0.0.1:5000/app/widget.html` for development, or **Zoho** once packaged.

**3.** Add the widget as a web tab so it appears in the CRM tab bar.

Data centers supported: `.com`, `.eu`, `.in`, `.com.au`.

## Local development

```
npm install -g zoho-extension-toolkit
zet run
```

Open `https://127.0.0.1:5000` once and accept the self-signed certificate, then open the web tab inside CRM.

To ship: `zet validate`, then `zet pack`, and upload `dist/FieldCheck.zip` with Hosting set to Zoho. CRM serves the zip's `app/` folder as the web root, so set the Index Page to `/widget.html`, **not** `/app/widget.html`. Every change needs a re-pack and re-upload, so use the external URL during development.

## Architecture

No backend and no build step. Plain files loaded as ordered script tags sharing top-level globals.

Third-party dependencies, declared in full: **none in the application code**. The page loads Zoho's own Embedded App JS SDK and four Google Fonts (Raleway, Ubuntu, Quicksand, Karla) from their CDNs. `package.json` covers only the local zet dev server and ships nothing to the widget.

- CRM module and field metadata comes from `ZOHO.CRM.META`, which runs as the logged-in user and needs no setup.
- Everything else goes through `ZOHO.CRM.CONNECTION.invoke()` against named Connections, so OAuth and CORS are handled server-side by CRM. Each org configures the Connections once, which is what keeps the widget portable to any environment.
- The core insight: table view details expose each column's `columnId`, and Zoho's documented column-dependents endpoint returns every dependent view and formula directly, the same engine behind Analytics' own delete warnings. That makes Analytics results exact rather than scraped.

```
app/
  widget.html      markup only (loader scene, setup card, results panels)
  css/styles.css   all styling: light base, dark and zen themes, loader
  js/
    state.js         shared state object S + scan cache key
    helpers.js       DOM/URL/text utils, Connection transport, runQueue
    loader.js        full-screen loader (min-hold + boot lines) and mini loader
    settings.js      persisted settings, theme picker, setup-card toggles
    scan.js          the scan pipeline for every source, cache, finishScan
    fields.js        field loading, column matching, hit matchers, verdict math
    ui.js            icons, chips, filters, field list, detail panel, CSV export
    reverse-audit.js the standalone Analytics -> CRM audit
    main.js          boot wiring (PageLoad, SDK init, failsafe)
```

The scan only fetches deep detail for Analytics **Tables** (whose `columns` carry the `columnId`s) and **Query Tables** (their SQL). Every other view type is reached through the dependents API instead, which keeps the scan light.

Key API references:
- [Get View Details](https://www.zoho.com/analytics/api/v2/metadata-api/view-details.html) (`withInvolvedMetaInfo` returns table columns with `columnId`)
- [Get Column Dependents](https://www.zoho.com/analytics/api/v2/metadata-api/get-column-dependents.html)

## API behavior notes (confirmed against a live org)

- `ZOHO.CRM.CONNECTION.invoke` returns JSON responses wrapped in `{details: {statusMessage: ...}}`, but **file-download endpoints resolve as the raw text body itself**. `GET /crm/v8/settings/functions/{id}/code` is a file download, so both shapes have to be handled.
- Custom headers such as `ZANALYTICS-ORGID` pass through `CONNECTION.invoke` correctly.
- Analytics dependent views inside dashboards ("KPI widgets") come back with a bare numeric `viewName`; the UI collapses them into a count rather than showing meaningless ID rows.
- CRM reports are filtered by recency **before** fetching detail: not run in the past year, or never run and created over 6 months ago, means skipped. A year of unused reports would otherwise be hundreds of detail calls.
- List endpoints page at 200 per page (`info.more_records`). Automations paginate; the functions list call does not yet, so an org with 200+ functions would truncate.
- Blueprint per-transition mandatory fields aren't included: that API needs transition IDs with no documented way to enumerate them.

## Competition deliverables (due Aug 24)

- [ ] Deployed working widget in a live Zoho environment
- [ ] Source code repo
- [ ] Written summary: what it does, problem it solves, third-party libraries declared
- [ ] Screen recording or live demo link
