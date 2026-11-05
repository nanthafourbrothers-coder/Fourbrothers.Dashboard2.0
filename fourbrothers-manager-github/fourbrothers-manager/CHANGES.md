# Overview pictures (charts and diagrams for every upload)

**Not touched:** Supabase login, the database, your keys. No SQL to run. Same upload steps as before.

## New files (add)
| File | What it is |
| --- | --- |
| `src/lib/overview.ts` | The numbers behind the pictures: plain-words summary of a product, came-from / went-to flow, what is inside a file, every uploaded file as one flow |
| `src/components/ProductDiagrams.tsx` | Product popup: Opening + In - Out = On hand cards, sold/left bar, plain-words box, flow diagram (wide screens) / top-to-bottom flow (phones) |
| `src/components/UploadOverview.tsx` | Dashboard "Your uploaded files at a glance", plus the "what is in this file" card and file -> result -> screen row used on the import page |
| `tests/overview.test.ts` | Checks the above with made-up data (`npm run test:overview`) |

## Changed files (replace)
| File | Change |
| --- | --- |
| `src/components/charts.tsx` | Charts redraw to the real screen width (readable on phones), stock-on-hand panel under the in/out bars, tap a date to read it, new ring chart |
| `src/components/StockItemModal.tsx` | Product popup "Overview" tab: summary, sold/left bar, flow diagram, chart, rings by state and channel |
| `src/app/(app)/page.tsx` | Dashboard: uploaded files overview, rings for channel and state, period buttons no longer push the page wider than a phone |
| `src/components/ImportCard.tsx` | Shows what a file will add before saving, and a flow + overview after saving |
| `src/components/ui.tsx` | Header buttons can no longer overflow a phone screen |
| `package.json` | `test:overview` script |

---

# Dashboard 2.0 - what changed

Upload these files to GitHub with the same folder paths (replace the old ones). Vercel rebuilds by itself.
**Not touched:** Supabase login (`src/lib/auth.tsx`, `src/app/login`), the database (`supabase/schema.sql`), your keys. No SQL to run.

## New files (add)
| File | What it is |
| --- | --- |
| `src/lib/analysis.ts` | Opening / in / out / on hand for any period, filters, customer history, other products sold in the same place |
| `src/components/charts.tsx` | In/out/on-hand chart and clickable bars |
| `src/components/PeriodPicker.tsx` | Today, 7 / 30 days, month, financial year, all, custom from-to |
| `src/components/StockExcelModal.tsx` | "Update stock from Excel": counted today, or opening stock |
| `src/components/LowStockAlert.tsx` | "Needs attention" box with your own limit (default 100) and Update stock button at the bottom |
| `src/lib/backupZip.ts` | Full website backup as one ZIP (JSON, one CSV per table, sales register, receipts, sections, shipment files) |
| `tests/analysis.test.ts`, `tests/e2e-mobile.mjs` | Checks against your two Excel files and a phone-width page test |
| `.gitignore` | Keeps node_modules, .next, env files and data files out of GitHub |

## Changed files (replace)
| File | Change |
| --- | --- |
| `src/components/StockItemModal.tsx` | Product popup: period, filters (state, city, channel, party, godown), charts, customers, locations, all lines, count |
| `src/app/(app)/stock/page.tsx` | Simple list (product, current stock, status, last sold), Excel update, low-stock box, guided empty state |
| `src/app/(app)/movements/page.tsx` | Sales register (date, party, voucher no, city, state, item, qty) and Receipts, with filters |
| `src/app/(app)/page.tsx` | Dashboard: low-stock box, top customers, most received |
| `src/app/(app)/settings/page.tsx` | Lock switch for imported data, full ZIP backup |
| `src/app/(app)/activity/page.tsx` | Activity log with kinds, period filter, counts |
| `src/app/(app)/users/page.tsx`, `src/lib/permissions.ts` | "View only" role, role table, last action per user |
| `src/app/(app)/sections/[slug]/page.tsx`, `sections/page.tsx` | Imported rows locked, adding rows by hand allowed |
| `src/components/AppShell.tsx` | Simpler menu, phone bottom bar, alert bell |
| `src/lib/stock.ts`, `src/lib/data/useStock.ts` | Low-stock limit, lock setting |
| `src/components/ui.tsx`, `ImportCard.tsx`, `shipments/page.tsx` | Phone layout fixes |

## Rules built in
- Imported data (stock items, stock lines, sections) cannot be edited or deleted while the lock is on (Settings). **Adding by hand is always allowed.** Shipments stay fully editable.
- This lock is in the screens only. For a lock in the database as well, ask for a Supabase policy.
- Neither Excel file has opening stock or a godown column: set opening stock with "Update stock from Excel", and "location" means buyer state, city and channel.
- The two files share no identical product names, so use Name matching once; every later upload then links itself.
