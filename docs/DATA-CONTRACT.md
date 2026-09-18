# Data contract — the Blue Prism work-queue CSV

This is what you need to know to plug a real Blue Prism export into the dashboard as a test, without touching any code. If you follow this file, the dashboard will read your data the same way it reads the mock data today.

## 1. What to replace

Replace this file, and only this file:

```
data/mock/BPAWorkQueueItem.csv
```

That path is the single swap point for the whole dashboard. Put a real Blue Prism work-queue export there (in the exact shape described below) and everything downstream — the charts, the KPIs, the cost calculations — rebuilds from it with no other changes.

Everything else the dashboard needs is reference data, not transaction data, and it lives separately:

- `data/reference/reference.json` — spokes, propositions, processes, queue-to-process mapping, grade rates, VDI/resource costs, people costs, exception-classification patterns. This is UI-editable: use **Administration** in the app rather than hand-editing the JSON.
- Adding a brand-new Blue Prism queue that isn't already known to the dashboard means adding a queue mapping in **Administration → Propositions & processes → queue mappings** (or, equivalently, adding a row to `reference.json`'s `queueMap`). The CSV itself never needs to change to add a queue — only the reference data does.

## 2. The 16 columns

The CSV must have exactly these 16 columns, with these exact (case-sensitive) header names, in this exact order. This mirrors a standard Blue Prism 7.2 `BPAWorkQueueItem` export, plus `QueueName`.

| # | Column | Type | Format / allowed values | Required? | Example | Notes — what the dashboard does with it |
|---|---|---|---|---|---|---|
| 1 | `ID` | text | Blue Prism's item GUID, or any string unique per item | **Yes** — a blank ID silently drops the row | `905714FD-6C41-E1FC-7935-D7331ABE6435` | The item's identity. Also the merge key: in production, a later `LastUpdatedDate` for the same `ID` overwrites the earlier row (see rule 3). Must be unique in the file — see rule 3. |
| 2 | `KeyValue` | text | Free text, blank allowed | No | `POL-9000005` | Business key (e.g. policy/case number). Used to count distinct **cases** vs. work items — a case with a two-stage process (e.g. a pension transfer's initiation and completion) reuses the same `KeyValue` across two queue items. |
| 3 | `Priority` | integer | Any whole number | No | `2` | Carried through only; not used in any calculation. |
| 4 | `Status` | text | One of: `Completed`, `Exception`, `Pending`, `Deferred` | No, but see Note | `Completed` | Informational — **the dashboard does not branch on this text.** It derives the real outcome from which date columns are populated (rule 3). Get `Status` right anyway: it is how a human (and this contract's validator) sanity-checks the file, and a real Blue Prism export always carries it. |
| 5 | `Tags` | text | Free text, blank allowed | No | `Source: Broker` | Carried through only. |
| 6 | `Resource` | text | The bot/VDI name that ran the item | No | `VDI-RPA-PROD-01` | Matched against `reference.json`'s `resources` list for utilisation and stale-VDI reporting. An unrecognised resource name is not an error — it just won't resolve to a spoke. |
| 7 | `Attempt` | integer | Whole number ≥ 1 | **Yes** | `1` | Retry counter — a system-exception retry is normally a **new row** (new `ID`, same `KeyValue`, `Attempt` incremented). |
| 8 | `LoadedDate` | datetime | See rule 3 (date/time format) | **Yes** | `2026-01-01 06:01:38` | When the item entered the queue. Used as the outcome date for still-pending items, and as the "did this arrive before it completed" sanity check. |
| 9 | `LastUpdatedDate` | datetime | See rule 3 | No — if blank, the build falls back to `CompletedDate`, then `ExceptionDate`, then `LockedDate`, then `LoadedDate` | `2026-01-01 07:13:16` | The change-detection field. In production this is what decides whether an incoming row for an already-known `ID` is newer and should overwrite it. |
| 10 | `DeferredDate` | datetime | See rule 3 | No | *(blank)* | Carried through only. |
| 11 | `LockedDate` | datetime | See rule 3 | No | *(blank)* | Carried through only (and used as a `LastUpdatedDate` fallback — see column 9). |
| 12 | `CompletedDate` | datetime | See rule 3 | Required when `Status` is `Completed` | `2026-01-01 07:13:16` | **Presence of this column, not the `Status` text, is what makes an item "Completed."** |
| 13 | `Worktime` | integer | Whole seconds, ≥ 0 | **Yes** | `108` | Bot execution time. Drives every cost figure: `estate cost = Worktime × (hub £/bot-second + spoke £/bot-second)`, and (for completed items) benefit via the process's standard minutes value. Must be in **seconds**, not milliseconds or a duration string. |
| 14 | `ExceptionDate` | datetime | See rule 3 | Required when `Status` is `Exception` | `2026-01-01 07:13:16` | **Presence of this column, not the `Status` text, is what makes an item an "Exception."** |
| 15 | `ExceptionReason` | text | Free text; see rule 3 for the classification convention | Required when `Status` is `Exception` | `Business Exception: Documentation missing or incomplete` | Classified into Business/System exception — see rule 3. |
| 16 | `QueueName` | text | Must match a `queueName` in `reference.json`'s `queueMap` to count toward any process/spoke figure | **Yes** | `INSURANCE_NEW_BUS` | Resolves the item to a process (and, through the process, a spoke). An unmapped queue name does not break the build — the item is still counted for resource/utilisation purposes but contributes to no process, spoke, or £ figure, and the build prints an unmapped-queue warning. |

An item's outcome is always exactly one of **Completed**, **Exception**, or **Pending** — decided in this order: `CompletedDate` set → Completed; else `ExceptionDate` set → Exception; else → Pending. Do not populate both `CompletedDate` and `ExceptionDate` on the same row.

## 3. Rules

- **Encoding**: UTF-8. Do not save from Excel as "CSV (Comma delimited)" without checking the encoding — Excel on Windows sometimes writes a BOM-less ANSI file instead. A UTF-16 file (as Excel's "Unicode Text" export produces) will not be read correctly and `data:validate` will refuse it outright.
- **Header row**: required, and must be the exact 16 names from the table above, in that exact order (case-sensitive).
- **Delimiter**: comma-separated.
- **Quoting**: standard RFC 4180 — wrap a field in double quotes if it contains a comma, a double quote, or a line break, and double any internal quote (`"He said ""hi"""`).
- **Date/time format**: use **ISO 8601, `YYYY-MM-DDTHH:MM:SS`** (e.g. `2026-01-15T09:30:00`) for every date column. `YYYY-MM-DD HH:MM:SS` (a space instead of `T`) is also accepted — that is what the mock data and Blue Prism exports typically use. **Do not include a timezone offset or a trailing `Z`** — the loader appends `Z` itself and assumes the value is already in UTC, so a value that supplies its own offset will fail to parse. **Avoid `DD/MM/YYYY` and `MM/DD/YYYY` date-only values**: the loader's date parser is lenient enough to sometimes accept a date-only value as a plausible (but silently wrong) US-style `MM/DD/YYYY` date instead of rejecting it — a date-and-time value in that format is correctly rejected, but a bare date is not always. ISO 8601 avoids the ambiguity entirely; that is why it's the recommendation, not just a preference.
- **Timezone assumption**: everything is treated as UTC. If your Blue Prism environment logs in local time (e.g. BST), convert to UTC before export, or accept that summer-time rows will be off by an hour.
- **Worktime**: whole seconds, as an integer ≥ 0. If your source records worktime in milliseconds (common when pulling from Elastic — see section 6), divide by 1000 and round before writing the CSV.
- **`Status` vocabulary and outcome mapping**:

  | `Status` value | Maps to | What must also be true |
  |---|---|---|
  | `Completed` | Completed | `CompletedDate` populated |
  | `Exception` | Business exception **or** System exception | `ExceptionDate` and `ExceptionReason` populated; type is decided by `ExceptionReason`'s text — a reason starting `Business Exception:` or `System Exception:` (case-insensitive) is trusted outright; otherwise it's matched against a list of text patterns (e.g. anything containing "timeout", "citrix", "login failed" → System; anything containing "duplicate", "documentation", "outside tolerance" → Business) configured in `reference.json`'s `exceptionPatterns`; anything matching nothing defaults to **Business** |
  | `Pending` | Pending | no `CompletedDate` or `ExceptionDate` |
  | `Deferred` | Pending | same as above — `Deferred` is treated identically to `Pending` (it has no `CompletedDate`/`ExceptionDate` either) |

  Again: it is the presence of `CompletedDate`/`ExceptionDate` that actually decides the outcome, not the `Status` text — keep them consistent with each other regardless.

- **One row per work item ID, latest state**: a real production pull is incremental — the same `ID` can appear in more than one day's export as it changes state (e.g. loaded → completed). In production, the row with the newer `LastUpdatedDate` for a given `ID` overwrites the older one; the older state is not kept. **For a single one-off test file** (which is what this contract is mainly for), put exactly one row per `ID` — its current, final state — and don't include earlier superseded states in the same file. The validator (`data:validate`) reports duplicate `ID`s as an error precisely because a single test file has no merge step to resolve them.
- **What makes a row rejected, and where**: this depends on which tool you run.
  - `npm run data:validate` (the tool in this repo, see section 4) treats a blank `ID`, an unparseable date, an invalid `Worktime`/`Attempt`/`Status`, or a duplicate `ID` as an **error**, prints every occurrence grouped by issue with line numbers, and exits with a non-zero code. It treats an unmapped `QueueName`, a `CompletedDate` before `LoadedDate`, and a missing/unexpected `ExceptionDate` as **warnings** — worth fixing, but they won't stop a build.
  - `npm run data:build` (the actual dashboard build) is more forgiving and does **not** produce a reject report: a blank-`ID` row is silently dropped, an unparseable date silently becomes blank, and an unmapped queue is silently counted for utilisation only (with one summary warning line printed to the console, not per-row). This is exactly why you should always run `data:validate` first — it is the only step that tells you what's wrong, before a bad file quietly produces a dashboard that just looks a bit off.

## 4. Check your file

Before building anything, run:

```
npm run data:validate -- path/to/your.csv
```

This checks, without changing any file:
- the header is exactly the 16 expected columns, in order (and tells you what's missing, extra, or out of order if not);
- every row's `ID` is non-blank and unique across the file;
- every date column that has a value parses under the accepted formats (rule 3), with a count of unparseable values per column and the first three offending line numbers;
- `Worktime` is a whole number ≥ 0;
- `Attempt` is a whole number ≥ 1;
- `Status` is one of the recognised values;
- `QueueName` is known to `reference.json`'s queue map (a warning, not an error, if not — you can still build, the item just won't count toward a process/spoke);
- `CompletedDate` is not earlier than `LoadedDate` (a warning);
- `ExceptionDate` is present exactly when `Status` is `Exception` (a warning either way it disagrees).

It prints a summary (rows checked, valid, rejected, rows with warnings), the top issues with counts and example line numbers, and exits with code `1` if there is any error, or `0` if the file is clean or only has warnings.

## 5. Build and view

1. Copy your CSV over the swap-point file:
   ```
   data/mock/BPAWorkQueueItem.csv
   ```
   (`npm run data:build -- path/to/your.csv` also works, with a relative or a full Windows path. Copying over the mock file is the simplest option.)
2. Run:
   ```
   npm run data:build
   ```
   This reads the CSV plus `data/reference/reference.json` and writes everything under `public/data/` (the view JSONs and `public/data/model.json`, the compact model the app aggregates client-side). Watch the console output — it prints the row count, the date window found, and (if any) an `UNMAPPED QUEUES:` line.
3. Run:
   ```
   npm run dev
   ```
   and open the app.
4. What to check first:
   - The header of any page should show **"Data to <date>"** matching the last date in your CSV, not a stale mock date — that confirms the app picked up your file.
   - Re-check the `npm run data:build` console output for any `UNMAPPED QUEUES:` warning — those items are being counted for resource activity but contribute nothing to any process, spoke, or £ figure until you map the queue in Administration.
   - Open `public/data/manifest.json` and check `sourceRows` and the `views` row counts look like what you expect from your file (roughly one row per queue item, minus any dropped blank-ID rows).

## 6. Going to production

Production pulls the same 16 columns straight from Elastic via `bp-sql-layer/ingest/elastic_to_csv.py` rather than a manually-placed file, and loads them through the SQL staging → merge pipeline instead of this repo's JS build script. See **PLAYBOOK.md sections 3 (Pulling from Elastic) and 4 (Loading and merging into SQL)** for the full production path, including the watermark/incremental-pull mechanism that lets the same `ID` show up across multiple pulls safely.

## 7. Worked example

Five rows: a completed item, a business exception, a system exception, a pending item, and a system-exception retry (same `KeyValue`, `Attempt` 2, new `ID`).

```csv
ID,KeyValue,Priority,Status,Tags,Resource,Attempt,LoadedDate,LastUpdatedDate,DeferredDate,LockedDate,CompletedDate,Worktime,ExceptionDate,ExceptionReason,QueueName
A1111111-0000-0000-0000-000000000001,POL-9000001,2,Completed,,VDI-RPA-PROD-01,1,2026-01-15T06:12:00,2026-01-15T07:04:00,,,2026-01-15T07:04:00,180,,,INSURANCE_NEW_BUS
B2222222-0000-0000-0000-000000000002,POL-9000002,2,Exception,,VDI-RPA-PROD-01,1,2026-01-15T06:20:00,2026-01-15T06:45:00,,,,90,2026-01-15T06:45:00,Business Exception: Documentation missing or incomplete,INSURANCE_NEW_BUS
C3333333-0000-0000-0000-000000000003,POL-9000003,1,Exception,,VDI-RPA-PROD-02,1,2026-01-15T06:30:00,2026-01-15T06:34:00,,,,40,2026-01-15T06:34:00,System Exception: Application timeout waiting for core system,INSURANCE_NEW_BUS
D4444444-0000-0000-0000-000000000004,POL-9000004,2,Pending,,VDI-RPA-PROD-01,1,2026-01-15T09:00:00,2026-01-15T09:00:00,,,,0,,,INSURANCE_NEW_BUS
E5555555-0000-0000-0000-000000000005,POL-9000003,2,Completed,,VDI-RPA-PROD-02,2,2026-01-15T06:35:00,2026-01-15T07:10:00,,,2026-01-15T07:10:00,150,,,INSURANCE_NEW_BUS
```

Note row 5: it shares `KeyValue` `POL-9000003` with row 3 (the system exception it retries), has a new `ID`, `Attempt` `2`, and its own `LoadedDate` shortly after the failed attempt — this is the standard Blue Prism retry-as-new-item pattern.
