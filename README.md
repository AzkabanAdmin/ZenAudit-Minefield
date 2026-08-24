# ZenAudit MineField

**Know what breaks before you delete a field.**

A Zoho CRM web tab widget that inventories every field in every module and shows exactly where each one is actually used, across Zoho Analytics, CRM Deluge functions, CRM reports, and six kinds of CRM automation. Pick a module, click a field (or check all of them at once), and get a verdict backed by Zoho's own dependency data.

Built for the Zenatta 2026 Summer Design Competition (Track 1: Widget Development).

## Why

When you delete a CRM field, Zoho warns you about some workflows and blueprints. It says nothing about Zoho Analytics or Deluge code. The field disappears, and days later a client's dashboard is broken, a query table errors out, or a function starts failing silently.

Today the only real "solution" is opening every report and script by hand. ZenAudit MineField closes that gap, and doubles as a dead-field detector for org cleanup engagements: fields that nothing references anywhere are exactly the ones safe to retire.

It is built for the orgs that actually need it, which are the messy ones.
On our own testing org that means 233 Analytics tables, 420 Deluge
functions and 65 workflow rules, so the widget plans a scan before running
it, stays inside Zoho's rate limits, says what it could not read, and lets
you keep a scan as a file rather than repeating it.

## What it checks

Each row below is one toggle. Turn on only what you need; the more you
enable, the more confident the "safe to delete" verdict becomes.

| Source | What it finds | Default |
|---|---|---|
| **Zoho Analytics** | Dependent views, formula columns, aggregate formulas, and query table SQL | On |
| **CRM functions and automations** | Deluge code plus six kinds of automation, seven sub-scans in one toggle (below) | On |
| **CRM Reports** | Report columns and filter criteria | Off |
| **Reverse Analytics Audit** | Runs the opposite direction, standalone (below) | Off |

**CRM functions and automations** covers Deluge function code, workflow field updates, workflow rules (triggers and firing criteria tracked separately, since "fires the rule" and "filters the rule" are different facts), scoring rules, blueprints, webhooks, and connected workflows (Zoho Flow-triggered rules).

They are one toggle because function matching uses the automation data: a
rule's action list is what ties a function to a module.

**Reverse Analytics Audit** asks the opposite question: which columns exist in Analytics but have no matching CRM field? That is where to start when your Analytics sync has broken and you don't know which field caused it. For every column it finds with nothing behind it, it then reports what in Analytics is built on that column, so you can see what you stand to lose before touching anything. It runs standalone and locks out the other sources while selected.

## How confident is each result?

Not every source can be equally certain, so the app never pretends otherwise. This is the single most important thing to understand when reading a verdict.

| Tier | Sources | How it matches |
|---|---|---|
| **Exact** | Analytics, workflow field updates, workflow rules, scoring rules, blueprints, connected workflows | Zoho's own dependency engine by `columnId`, or module **id** + field API name straight from the API |
| **High** | CRM reports, webhooks | Report refs resolved through the report's own joins; webhook `${!Module.Field}` merge tags. Report references more than one join hop deep are labeled **unverified** rather than treated as certain |
| **Heuristic** | CRM Deluge functions | Deluge has no dependency API, so this is a text search over comment-stripped source. Custom names are searched loosely; standard names additionally need the module anchored in the function (below) |

### How strict Deluge matching is, and why

The goal is to find every occurrence of a field, so the default is to
search loosely. The one thing that makes that unsafe is a generic API
name, and generic names are almost entirely a standard-field problem:
`Name`, `Owner`, `Email`, `Phone`. A custom field's API name is
org-specific, so `GDrive_ID` can be searched for anywhere without dragging
in prose.

So the two are treated differently:

- **Custom fields** are searched loosely, anywhere in any function.
- **Standard fields** additionally require the module to be anchored in
  the function. A CRM API call is where a module has to be named, so that
  is the anchor: a `zoho.crm.*` call or an `invokeurl` REST path like
  `/crm/v8/Accounts`.

Either way an occurrence has to look like a name rather than prose. Deluge
names a field with a complete quoted string, and that string is routinely
held in a config variable before use:

```
CRM_GDrive_ID = "GDrive_ID";
Update_Map.put(CRM_GDrive_ID, Folder_ID);
```

so the whole literal has to equal the API name. `"Name: "` and
`"Folder Name"` are prose. Criteria clauses like `(Stage:equals:Closed Won)`
and the `input.Stage` form count as names too, and a distinctive custom
name counts as a bare identifier as well.

Comments are stripped before matching, and matching is case-sensitive
because Deluge field access is: a lowercase `get("name")` provably is not
a reference to a field named `Name`.

Why it matters: on a live org, the Invoices module's "Invoice Number"
field has the API name `Name`. A bare text search reported 22 function
hits, every one of them a comment, a log string, or a local variable, and
marked 10 of the module's 29 fields "in use". The real answer was zero. A
verdict full of irrelevant hits teaches you to ignore the verdict, which
defeats the tool.

A function can also be anchored by how automation wires it. A workflow
rule's detail response lists the functions it invokes, which is an exact
statement from CRM about which module a function serves, and it is the only
thing that anchors a thin wrapper whose whole body is a call to a
standalone function.

The remaining gap is a standard field passed into a function as an
argument, where the binding lives in CRM's workflow configuration rather
than in the code or in any API response we can reach.
`test/real-data.test.js` pins the behaviour against a real org of 420
Deluge functions and 233 Analytics tables.

Every source counts toward the verdict. There is deliberately no "informational" tier: a result you can't act on is noise, so sources that could only ever report a name coincidence were removed rather than shipped with a disclaimer.

Automation matching keys off module **id**, not API name, because different CRM endpoints disagree about the same module's name string (Deals reports as "Potentials" from Blueprints in some orgs). The id is consistent everywhere.

## Verdicts

- **`N` in use**: something depends on this field. The detail panel breaks the number down by source, each with a link out to the exact view, report, rule, or settings page so you can fix it before deleting.
- **unused**: synced to Analytics, and Zoho's dependency engine reports nothing depending on it.
- **not synced** / **not in Analytics**: no matching column exists at all, and nothing else references it. Also safe, and usually a dead field.

## Using it

**1. Connect and scan.** Pick your data center and org, toggle the sources you want, then Scan.

The plan runs itself when the tab opens, so the table is there before you
ask. Listing what exists costs a few seconds and about a dozen API calls;
reading the detail costs one metered call per Analytics table, per function
and per rule, which is thousands of calls and minutes of waiting. So the
plan shows what a scan would cost, broken down by Analytics folder and by
CRM source, sorted by what each one costs, with a bar per row and a running
total. Unticking a row strikes it through and takes it off the total.

The plan follows the switches above it without re-listing. Turning a source
off drops its section and its time from the total, and unticking a
workspace pill drops that workspace's folders the same way. Turning a
source on after the listing was taken says so on the panel rather than
quietly understating the cost, and **Re-check scan size** folds it in.

The plan is cached per org, so reopening the tab shows the last listing
instantly with the time it was taken, and **Re-check scan size** refreshes
it. It also doubles as the connection check: nothing downstream of the
Analytics call runs without it, so a first run with no Connections set up
gets the setup guide rather than a plan, and any CRM source that cannot be
listed says so on its own row instead of failing the whole thing.

Folders are the useful lever. A consolidated workspace mixes several apps,
and for a CRM field audit most of those tables are noise. On our own
testing org 126 of the 233 tables sit in Zoho Books folders that a CRM
field audit never needs, so unticking those roughly halves the run: about
four and a half minutes becomes about two.

Zoho meters Analytics metadata at 60 calls a minute, so a big scan is
genuinely slow. The widget says how long up front, shows the time
remaining as it goes, and hands the otter a coffee for runs over three
minutes.

The workspace picker is always available. Folders are chosen in the scan
plan, where each one carries a table count and a time, rather than as a
flat list of pills: a real org has dozens, and unlabelled pills are no
help. The reverse audit keeps its own folder pills, narrowed to the CRM
data folder, because it reads every column and unrelated apps are pure
noise for it.

Results also cache in `localStorage`, so **Use cached scan** skips a
re-scan. The cache is keyed to the CRM org, since `localStorage` is scoped
to `crm.zoho.com` rather than to the org.

**Save the scan.** A big scan is minutes of metered calls, so it should not
be something you repeat. **Save scan to file** writes the whole result as
JSON, and **Load scan from file** reads it straight back, on any machine,
without spending a single call. After a run that took more than about a
minute and a half the widget offers to save it, since the browser cache is
convenient but fragile: it gets cleared, it is per browser, and a large org
can exceed its size limit.

A loaded file is checked before anything reads it, and a scan taken in a
different org loads with a standing warning that says so, because verdicts
from the wrong org would look entirely plausible.

**Why a first field check is not instant.** The scan records each table's
columns, but not what depends on them. "What depends on this column" is a
separate Analytics call, one per column, metered at 60 a minute, with no
bulk equivalent. That call is the entire cost of a field check.

Two things keep it in hand. Only the module's own Analytics tables are
queried, since that is where a CRM field's column lives: on our testing org
that took a Check All from 331 calls to 34 on Accounts, and from 1,085 to
246 on Invoices. And every dependents result is saved with the scan, so it
is bought once. A second Check All after reloading is immediate, and a scan
loaded from a file arrives with everything you had already checked.

Same-named columns in tables outside the module are listed rather than
queried, with a note and a **Check them anyway** button, because a Created
Time in some other app's table is coincidence rather than a dependency. A
rescan deliberately discards saved dependents, since asking for a fresh
scan means asking for fresh answers.

**2. Fields.** Pick a module. Click any field to check it on demand, or **Check all fields** to badge the whole module at once. Filter chips (In use / Unused / not synced / Unchecked) carry live counts, and the search box filters by label or API name. The third chip reads **not in Analytics** until a scan has actually run, because until then the absence of a column says nothing. A field sitting on no layout is marked **off layout** in the list, since it is invisible in CRM and so the likeliest one to be deleted without a second thought.

**3. Usage.** The detail panel shows every place the field is used, grouped by source, with code and SQL snippets where relevant and deep links into CRM and Analytics. **Export CSV** turns the whole module into a client-ready audit artifact. **Recheck this field** re-runs a single field against fresh data.

Three themes (dark by default, light, and zen) via the header dropdown, persisted between sessions.

## One-time org setup

**1. Connections**. Setup > Developer Space > Connections > Create Connection, service **Zoho OAuth**. Authorize each after creating it. Custom link names are fine, just enter them in the widget's settings panel.

| Link name | Scope | Needed for |
|---|---|---|
| `analytics` | `ZohoAnalytics.metadata.read` | Analytics + reverse audit |
| `crm` | `ZohoCRM.settings.ALL` | Field lists, functions, reports, automations |

Two connections, that's the whole setup. `ZohoCRM.settings.ALL` is known working. If your scope picker offers them separately, the minimal set is `settings.functions.READ`, `settings.reports.READ`, `settings.automation_actions.READ`, `settings.workflow_rules.READ`, `settings.scoring_rules.READ`, `settings.blueprint.READ`, and `settings.connected_workflows.READ`. The broader `ZohoAnalytics.fullaccess.all` also works.

Click any scope chip in the widget to copy it. The widget runs in a
cross-origin iframe, where the Clipboard API is not permitted, so it falls
back to an older copy path and, failing that, selects the text for you.

**2. Widget**. Setup > Developer Space > Widgets > Create. Type **Web Tab**, hosting **External** pointing at `https://127.0.0.1:5000/app/widget.html` for development, or **Zoho** once packaged.

**3.** Add the widget as a web tab so it appears in the CRM tab bar.

Data centers supported: `.com`, `.eu`, `.in`, `.com.au`.

## Local development

```
npm install -g zoho-extension-toolkit
zet run
```

Open `https://127.0.0.1:5000` once and accept the self-signed certificate, then open the web tab inside CRM.

To ship: `zet validate`, then `zet pack`, and upload the zip it writes into `dist/` with Hosting set to Zoho. CRM serves the zip's `app/` folder as the web root, so set the Index Page to `/widget.html`, **not** `/app/widget.html`. Every change needs a re-pack and re-upload, so use the external URL during development.

## Tests

The widget has no build step and no browser test runner, so the logic
files are exercised in Node against a small DOM and SDK shim.

```
npm test
```

Every suite below is a plain Node script with no dependencies.

| Suite | What it holds down |
|---|---|
| `boot.test.js` | Loads every script in the exact order `widget.html` does, runs the `PageLoad` handler, and checks every entry the registries declare resolves to something real. Catches load-order and missing-identifier mistakes. |
| `theme-contrast.test.js` | Parses the stylesheet and asserts that any button hover which recolours text settles its own background, in all three themes. Guards a bug that shipped once, where link text went mint on mint. |
| `transport.test.js` | The shapes `CONNECTION.invoke` returns: a normal JSON body, a 204 empty list, an error body, a missing response. |
| `ratelimit.test.js` | The shared limiter, on a simulated clock: 269 calls stay under 60 a minute, a 6045 rejection is retried rather than lost, a non-rate-limit failure is not, and the time estimates. |
| `cache-org.test.js` | A cached scan is only offered when it belongs to the org on screen, plus the folder gating the scan plan relies on. |
| `scan-file.test.js` | Saving and loading a scan: a lossless round trip, the file's key set pinned so the shape cannot drift unnoticed, proof that a loaded scan yields the identical verdict without re-buying dependents, every way a bad file is refused, the real `onchange` handler driven with a stubbed reader, and when saving is offered. |
| `paging.test.js` | The shared paginator: multi-page collection, stopping on `more_records`, both query-separator forms, a missing response key. |
| `deluge.test.js` | Deluge matching in detail, including a real standalone function from a live org kept verbatim as a fixture. |
| `reverse-audit.test.js` | The reverse audit, with one named check per misfire it has produced against an org whose sync was healthy: a field off every layout, a read-only system lookup, a relabelled field reached by each of its three names, and the sync's own bookkeeping columns. Also that dependents are bought only for columns that really are orphaned, and that a healthy org reports nothing and spends nothing. |
| `check-cost.test.js` | Counts the metered calls a field check makes against the real fixture, so the cost is measured rather than assumed, and asserts that queried plus unchecked accounts for every match. |
| `real-data.test.js` | Matching against a real scan you supply: ours is 420 functions and 233 tables. Asserts properties rather than expected names, so refreshing the fixture does not invalidate it. No hit outside the set of functions that really mention the name; anchoring only ever removes hits; a full sweep stays fast. |
| `verdicts.test.js` | A synthetic org where one field is used by seven sources, one is synced but unreferenced, one is absent from Analytics, and one shares its name with a column in another module's table, then the hit counts, categories, chips, detail sections and CSV rows. That last field guards a crash: rendering it used to throw and leave the pane stuck on "Checking dependencies". |

`real-data.test.js` and `check-cost.test.js` need
`test/fixtures/scan-cache.json`, which is **not in the repo** and skips
cleanly when absent. `scan-file.test.js` uses it too when present, to prove
a genuine older export still loads. A scan captures Deluge source
verbatim, and function source in a real org routinely contains hardcoded
credentials: the first time we tried to commit ours, GitHub's push
protection caught a live Anthropic API key sitting in one of the functions.
So a scan file never goes into git.

To run that suite against your own org, scan, use **Save scan to file**, and
drop the result at `test/fixtures/scan-cache.json`. Its assertions are
properties rather than expected names, so any org's scan satisfies them.

These cover the analysis layer and the transport rules, not the live API
calls themselves, which need a real org.

## Architecture

No backend and no build step. Plain files loaded as ordered script tags sharing top-level globals.

Third-party dependencies, declared in full: **none in the application code**. The page loads Zoho's own Embedded App JS SDK and four Google Fonts (Raleway, Ubuntu, Quicksand, Karla) from their CDNs. `package.json` covers only the local zet dev server and ships nothing to the widget.

- The module list comes from `ZOHO.CRM.META.getModules()`, which runs as the logged-in user and needs no setup. Field lists do not: they come through the `crm` Connection from `/settings/fields?type=all`, because the SDK's `getFields` returns only fields sitting on a layout and so cannot see a field parked in Unused Items (see Known limits).
- Everything else goes through `ZOHO.CRM.CONNECTION.invoke()` against named Connections, so OAuth and CORS are handled server-side by CRM. Each org configures the Connections once, which is what keeps the widget portable to any environment.
- The core insight: table view details expose each column's `columnId`, and Zoho's documented column-dependents endpoint returns every dependent view and formula directly, the same engine behind Analytics' own delete warnings. That makes Analytics results exact rather than scraped.

```
app/
  widget.html      markup only (loader scene, setup card, results panels)
  css/styles.css   all styling: light base, dark and zen themes, loader
  js/
    state.js         shared state object S + scan cache key
    helpers.js       DOM/URL/text utils, Connection transport, rate limits
    sources.js       the SCANS + SOURCES registry every screen derives from
    loader.js        full-screen loader (min-hold + boot lines) and mini loader
    settings.js      persisted settings, theme picker, setup-card toggles
    scan.js          scan pipeline, scan plan, cache, save and load, summary
    fields.js        field loading, column matching, hit matchers, verdict math
    ui.js            icons, chips, filters, field list, detail panel, CSV export
    reverse-audit.js the standalone Analytics -> CRM audit
    main.js          boot wiring (PageLoad, SDK init, failsafe)
```

`sources.js` is the spine. Each scan is declared once and each kind of
match is declared once, and the field chips, verdict wording, detail
sections, CSV export, scan summary and cache all derive themselves from
those two tables. Adding a source means adding two entries and a matcher,
with no other file to remember. Analytics is deliberately outside the
registry: it is the only source answering through Zoho's dependency engine
rather than a name match, so its results carry a different shape.

The scan only fetches deep detail for Analytics **Tables** (whose `columns` carry the `columnId`s) and **Query Tables** (their SQL). Every other view type is reached through the dependents API instead, which keeps the scan light.

Key API references:
- [Get View Details](https://www.zoho.com/analytics/api/v2/metadata-api/view-details.html) (`withInvolvedMetaInfo` returns table columns with `columnId`)
- [Get Column Dependents](https://www.zoho.com/analytics/api/v2/metadata-api/get-column-dependents.html)

## API behavior notes (confirmed against a live org)

- `ZOHO.CRM.CONNECTION.invoke` returns JSON responses wrapped in `{details: {statusMessage: ...}}`, but **file-download endpoints resolve as the raw text body itself**. `GET /crm/v8/settings/functions/{id}/code` is a file download, so both shapes have to be handled.
- Custom headers such as `ZANALYTICS-ORGID` pass through `CONNECTION.invoke` correctly.
- Analytics dependent views inside dashboards ("KPI widgets") come back with a bare numeric `viewName`; the UI collapses them into a count rather than showing meaningless ID rows.
- CRM reports are filtered by recency **before** fetching detail: not run in the past year, or never run and created over 6 months ago, means skipped. A year of unused reports would otherwise be hundreds of detail calls.
- List endpoints page at 200 per page (`info.more_records`). Every list call goes through one shared paginator, so no source truncates on a large org.
- Zoho Analytics meters metadata calls at **60 a minute** and rejects the rest with error 6045. Every call is spaced to stay under that. Before this, a 269-table org read 49 tables and silently discarded the other 216, so verdicts rested on a fifth of the data. Anything still unreadable is now counted and reported rather than dropped.
- The scan cache is keyed to the CRM org. `localStorage` is scoped to `crm.zoho.com`, not to the org, so without that key switching orgs offers you the previous client's scan.
- Blueprint per-transition mandatory fields aren't included: that API needs transition IDs with no documented way to enumerate them.

## Known limits

Stated plainly, because a verdict you cannot calibrate is worth less than
one you can.

- **Deluge matching is a text search.** Zoho publishes no dependency API
  for Deluge, so a field name inside a prose string in an anchored function
  can still be reported. The rules above cut this hard, but they cannot
  reach zero.
- **A standard field passed in as a function argument is missed.** The
  binding between a CRM field and a function parameter is configured on the
  workflow action, and is not exposed by the functions list or the rule
  detail. Custom fields are unaffected, since they are matched loosely.
- **Blueprint per-transition fields are not included.** That API needs
  transition IDs, and there is no documented way to enumerate them. The
  single governing field per blueprint is covered.
- **Report matching covers columns and filters only.** Group by, sort by,
  aggregate functions and territory filters are deliberately out of scope,
  as is `relational_criteria` on workflow rules.
- **Report references more than one join hop deep are labelled
  unverified** rather than resolved, which would need an API call per
  intermediate module.
- **Webhook merge tags name their module as text**, so they are the one
  automation source matched on API name rather than module id, and cannot
  be corrected for the Deals/Potentials naming quirk.
- **A large scan is slow, and that is Zoho's limit, not ours.** Analytics
  meters metadata at 60 calls a minute. The plan tells you the cost before
  you commit, and saving the result to a file means paying it once.
- **The reverse audit finds, it does not fix.** It names the columns with
  no CRM field behind them and what breaks with each, but recovering the
  data or recreating the field is left to you.
- **A field must exist to be checked.** Both directions read the CRM
  settings endpoint with `type=all`, so fields sitting on no layout are
  included. Dropping that parameter silently returns layout fields only,
  which reads live fields as deleted and hides them from the field list.

## Competition deliverables (due Aug 24)

- [x] **Source code repo.**
- [x] **Written summary.** This README. Third-party dependencies are
      declared in full under Architecture: none in the application code.
- [x] **Running in a live Zoho environment.** Two, in fact: a small org and
      the messy shared testing org, both as CRM web tabs.
- [ ] **A build the judges can open themselves.** Needs `zet pack` and an
      upload with Hosting set to Zoho and Index Page `/widget.html`, not
      `/app/widget.html`. It runs today from the local zet dev server,
      which is fine for us and no use to a judge.
- [ ] **Screen recording.**
