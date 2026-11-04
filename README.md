# Prism — 3D Visualization Studio

Prism 2.0 is a local-only studio for exploring varied tabular datasets through interactive 3D charts and chapter-based data stories. The release artifact is one self-contained HTML file: no backend, database, account, telemetry, hosting, or internet connection.

## Open the finished app

Double-click `Open Prism 3D Studio.cmd` to launch the interactive app in your default browser. You can also open `dist/3d-viz-studio.html` directly in a current version of Microsoft Edge, Google Chrome, or Firefox.

Do not use a static HTML preview pane: previewers intentionally disable JavaScript, so file selection and chart controls will appear but cannot respond. The launcher opens the same self-contained file in a full browser where all interactions are enabled.

No installation, local server, backend, account, or internet connection is required.

## Create a chart

1. Drop an `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, `.tsv`, `.json`, `.ndjson`, or `.jsonl` file onto the importer, or click **Choose a dataset**.
2. Choose a sheet or named JSON table when the file contains more than one. **Import settings** lets you specify a header row, headerless mode, delimiter, decimal convention, text date order, and percentage scale. Applying settings reloads the source and resets charts/stories only after success.
3. Select Scatter, Columns, Lollipop, or Surface. Scatter and Surface expose the deepest Plotly-specific controls.
4. Drag a highlighted field into a mapping slot. Clicking a field also assigns it to the active compatible slot.
5. Change a detected semantic type from the field menu when source data needs an explicit correction; Prism previews conversion quality first.
6. Use **Filters** for values, lists, blanks, dates, and numeric ranges such as `$10M`–`$50M`. Filters never modify source rows.
7. Add safe calculated fields with bracketed column references, for example `[Split Amount (USD)] * [Probability (%)]`.
8. Use **Appearance** for palettes, marker modes, surface contours, lighting, opacity, and rendering limits.
9. Use **Axes & Scene** for visible axis titles, units, ranges, direction, projection, aspect, camera presets, and saved custom viewpoints.
10. Use **Interaction** for zoom, Plotly controls, and presentation-resolution export settings; use **Quality** for Building, Needs attention, and Presentation ready guidance.
11. Save configured chart tiles, export a self-contained interactive `.html` chart, or save/open a `.prism.json` project. Project files preserve semantic configuration but exclude source rows.
12. Use **Story Builder** above the chart to capture up to eight scenes. Each chapter preserves its chart, filters, camera, takeaway, annotation, action, formatting, and up to three supporting metrics; deterministic chart signals can suggest editable range or outlier copy. **Present** opens a distraction-free interactive narrative.

Every supported field may be assigned to Scatter X and Y when its values can be represented as numeric, temporal, boolean, or deterministic categorical coordinates. Dense identifiers trigger readability guidance rather than silently producing an unusable axis.

Interactive HTML exports embed the Plotly runtime, rendered chart arrays, and active Story chapter. Recipients can double-click the file and rotate, pinch, zoom, hover, and reset the chart without a network connection.

The opening screen offers business, sensor measurement, and category-only sample datasets. Prism selects a defensible starting chart and explains alternatives under **Suggested views**. Recommendations use field evidence, usable coverage, distinctness, cardinality, and observed grid occupancy. They are heuristics, not statistical proof or cloud AI.

Category-only tables get a clearly labeled generated **Record count** measure. Tables with three varying numeric fields can use an observation scatter. Category/measure tables get aggregate views, with sum for additive quantities, average for generic measurements and rates, and count for record counts. Correct types or aggregation when your domain requires a different interpretation. Tables without enough usable dimensions show guidance instead of invented coordinates.

## Privacy model

- Spreadsheet bytes and parsed rows remain in browser memory.
- A deny-by-default content policy blocks outbound network connections.
- The app has no backend, network calls, persistent browser storage, cookies, telemetry, or analytics.
- Reloading or closing the page clears the imported dataset.
- Interactive HTML and JSON exports are generated locally.
- Configuration JSON includes mappings, settings, saved charts, and Story chapters but never source rows.

## Supported types and limits

Prism profiles text/category, identifier, number, currency, percentage, date, boolean, fiscal period, geography, and free-text semantics. Excel number formats are used when available; CSV values combine content profiling with Salesforce-aware column-name cues. Every inferred type can be overridden with a conversion preview.

The import boundary is **50,000 nonempty data rows and 100 source columns per selected table**. A generated count measure does not consume a source column. Prism rejects tables beyond either boundary instead of silently truncating analysis. Imported files are limited to 250 MiB and project files to 10 MiB before parsing. A source also has a 200,000 physical-row limit, a 65,536-character cell limit, a 1,000-character header limit, and an eight-level JSON nesting limit. These are safety ceilings, not promises of equal performance for all shapes.

Delimited text must use UTF-8. Comma, semicolon, tab, and pipe separators are detected and can be corrected; quoted multiline fields and escaped quotes are supported. Raw text is preserved so leading-zero identifiers and large integers remain identifiable. Locale and date ambiguity is handled conservatively. Mixed currencies remain text until the user normalizes them. Unknown boolean tokens become invalid rather than false.

JSON accepts arrays of objects or an object containing named arrays of objects. Nested scalar object properties become escaped path columns (`~0` for `~`, `~1` for `/`). Nested arrays are rejected because flattening them would invent joins or multiply records. NDJSON errors identify the line. Spreadsheet formulas are never evaluated and macros never run; cached values are used, and missing formula results are reported.

Scatter charts render at most 8,000 deterministically selected observations. Aggregate charts render up to 60 category combinations after full-data aggregation and disclose hidden groups. Surfaces are bounded to 2,500 cells. **Bin numeric coordinates** explicitly groups continuous X/Y values into 2–50 equal-width intervals; bins and aggregate values are labeled. Missing cells remain gaps by default. Neither sampling nor encoded categorical spacing implies unbiased representation or continuous measurement.

Rows, filters, calculations, and chart construction stay inside a dedicated browser worker. The main page receives only field metadata, a 100-row preview (25 rows shown), diagnostics, recommendations, and Plotly chart specifications. Source bytes remain in memory for reinterpretation. Replacement imports use a separate candidate worker; failure or cancellation preserves the existing dataset. Import/query deadlines are 60/30 seconds. A failed worker rejects pending work and can be replaced by re-importing the source. Large synchronous UI-thread fallback is disabled.

Projects match fields by normalized labels, preventing unrelated columns from matching solely by position. Projects also record import conventions; apply those conventions before opening a project against a differently interpreted source. Project files never embed source rows; exported interactive charts do contain the rendered chart values and story content.

## Release verification and limitations

The release is verified in installed Chrome with WebGL enabled. Edge is installed, but enterprise policy blocks headless automation and remote debugging, so Edge remains unverified. Firefox is not available on the reference machine and is also unverified. Internet access is not required to use the delivered HTML.

Reference measurements and browser checks are recorded under `artifacts/universal-performance.json` and `artifacts/universal-browser-verification.json`. The performance fixture measures 50,000 rows × 20 numeric/mixed columns; import profiling targets 10 seconds and filtered chart construction targets 2 seconds on the documented Windows reference machine. Wide tables and complex workbook formats may be slower and use substantially more memory. Software-rendered browser timing is reported separately from worker computation. Low-memory devices may need smaller tables.

The release uses the official SheetJS 0.20.3 distribution with a pinned lockfile. Package-registry auditing alone may not cover externally distributed packages; the parser version was also checked against official SheetJS guidance. Third-party license notices are included in `THIRD_PARTY_NOTICES.md`. `dist/3d-viz-studio.sha256` identifies the built artifact. This is a focused tabular chart tool; PDFs, images, nested-array joins, geocoding, server databases, and unstructured text analysis are outside the supported contract.

## Development

The project requires Node.js and pnpm/npm only for modifying or rebuilding the source. The delivered HTML does not require them.

```powershell
pnpm install
npm test
npm run build
```

`npm run build` creates `dist/3d-viz-studio.html` by bundling the application modules and embedding SheetJS and Plotly. `npm run test:browser` runs the optional Playwright smoke test when the machine permits headless browser automation.

`npm run test:universal` checks the new dataset flows in installed Chrome and attempts Edge. System-policy blocks are recorded explicitly and never counted as passing checks; at least one browser must complete verification. Browser tests currently use this workstation's bundled Playwright path; change that path when running on another machine. `npm run verify:release` builds, runs all unit/integration/security/performance checks, and runs both browser suites. Release verification requires a suitable Windows browser automation environment. If Node is not on PATH, use its absolute executable path; the delivered artifact needs no Node runtime.

## Project structure

- `src/semantic/` — profiling, semantic cues, quality diagnostics, and reversible type overrides
- `src/data/` — reusable typed-vector and dictionary-encoding primitives
- `src/query/` — safe calculated fields, nested filters, and deterministic query execution
- `src/charts/` — versioned chart contracts, recommendations, compatibility, and chart health
- `src/security/` — import bounds, safe text utilities, and the offline network guard
- `src/data-types.js` — Excel-aware physical type inference and value formatting
- `src/workbook.js` — workbook parsing, sheet selection, and dataset construction
- `src/chart-schemas.js` — supported mapping roles and compatibility rules
- `src/aggregate.js` — deterministic grouping and aggregation
- `src/chart-builders.js` — Plotly specifications for the four focused 3D chart styles
- `src/story/` — bounded Story chapter state, sanitization, and scene snapshots
- `src/app.js` — local authoring, saved-chart, Story Builder, and presentation interactions
- `src/styles.css` — semantic white-first design system with accessible optional dark mode
- `scripts/build.mjs` — offline single-file bundler
- `src/import/` — shared limits, raw text/JSON adapters, import status, and domain samples
- `tests/` — unit, security, 50,000-row import/performance, workbook integration, artifact, and browser regression tests
