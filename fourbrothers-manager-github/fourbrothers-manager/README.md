# FOURBROTHERS MANAGER

Stock in and out, shipments with photos, and a data hub for fourbrothers.in. Upload Excel, CSV, PDF, JSON or ZIP files and get clean, searchable, editable tables.

Built with Next.js, Supabase (login, database, file storage) and Vercel. Both Vercel and Supabase have free plans that are enough to start.

## What it does

| Area | What you get |
| --- | --- |
| Import files | Tally invoice register and purchase book, Shopify inventory, products, orders, sales reports and discounts are recognised. Anything else becomes a generic table. Preview first, edit cells, duplicates skipped, every import can be undone. |
| Stock in and out | One ledger of purchases (in) and sales (out). Search, filter by date, name, city, party, invoice. Edit any cell. Add lines by hand. Export CSV, Excel, PDF, JSON. |
| Stock items | Stock on hand, low and out of stock flags, Shopify quantity comparison, merge and archive, stock count adjustments. |
| Name matching | Tally, the purchase book and Shopify spell products differently. Link a name once and every later import links itself. |
| Sections | Every new spreadsheet can become its own section with its own page in the menu. Edit cells, add rows, rename or add columns, export. |
| Shipments and photos | Customer, phone, city, invoice, courier, tracking, status, with any number of photos or files (any type). Search by anything including file names. Import and export CSV. |
| Dashboard | In vs out chart, top items, sales by channel and state, items to restock, latest entries. |
| Users | Admin, manager, staff, viewer. Admin adds users and resets passwords. |
| Connect | Shopify live sync, Tally through its Excel exports, and an API address (POST /api/ingest) for anything else. |
| Backup | One click JSON backup and restore, per table CSV and Excel export, activity log. |

Roles: viewer can only look. Staff can add and edit stock lines, shipments and section rows. Manager can also import, edit stock items and sections, delete, and run the Shopify sync. Admin can also manage users and settings.

## Try it on your computer (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase keys the app runs in demo mode: no login, data stays in this browser. Good for trying your files.

## Put it online for free (about 20 minutes)

### 1. Database and login (Supabase)

1. Create a free account at supabase.com and make a new project. Pick the region closest to you (Mumbai if offered). Save the database password.
2. Open **SQL Editor, New query**, paste the whole of `supabase/schema.sql`, press **Run**. It is safe to run again later.
3. Open **Authentication, Providers, Email** and switch **Confirm email** off. Also switch off **Allow new users to sign up** after you have created your own admin (step 5), so strangers cannot create accounts.
4. Open **Project Settings, API** and copy the Project URL, the `anon` key and the `service_role` key.

### 2. Hosting (Vercel)

1. Put this folder in a GitHub repository (do not upload the `samples` folder, it holds customer data).
2. On vercel.com choose **Add New, Project**, pick the repository. Framework is detected as Next.js.
3. Before pressing Deploy, open **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `INGEST_API_KEY` (any long random text)
   - Shopify values from step 4 if you want live sync.
4. Deploy. Open the address Vercel gives you.

### 3. First sign in

The first account created becomes the admin. On the login page choose to create the first admin, enter your name, email and password. After that, add everyone else from **Users, Add a user**.

### 4. Shopify live sync (optional)

Shopify CSV exports work without this. For live sync:

1. In Shopify admin open **Settings, Apps and sales channels, Develop apps** and create an app (or use the Dev Dashboard).
2. Give it read access to products, inventory, locations and orders.
3. Install it and copy the Admin API access token (starts with `shpat_`).
4. In Vercel add `SHOPIFY_STORE_DOMAIN` (like `fourbrothers.myshopify.com`) and `SHOPIFY_ADMIN_TOKEN`, then redeploy.
5. In the app open **Shopify, Tally, API** and press Fetch inventory or Fetch orders. Without the read all orders permission Shopify only returns the last 60 days of orders.

### 5. Using it the first time

1. **Import files**: upload the Tally register and purchase book. Check the preview and save.
2. **Name matching**: press Create an item for each name, or link names to your Shopify items.
3. **Import files**: upload the Shopify inventory file and choose Opening stock. Then in **Settings** set **Count stock from** to the date of that file. Older Tally lines stay saved but are not counted twice.
4. From then on upload new Tally exports as often as you like. Lines already saved are skipped.

## Things to know

- **Free plan limits.** Supabase free: 500 MB database, 1 GB file storage, and the project pauses after 7 days with no activity (open the dashboard and press Restore). There are no automatic backups on the free plan, so use **Settings, Download backup** regularly. Vercel Hobby is for non commercial use. For a business, Vercel Pro or another host is the proper fit.
- **Files.** Excel `.xlsx`, CSV, TSV, JSON, text, PDF with a text layer, and ZIP are read. Old `.xls` and `.ods` files must be saved as `.xlsx` first. Scanned PDFs and photos need OCR, which is not included. Photos and documents attached to shipments are stored as they are, any type.
- **Tally** is linked through its Excel exports and the API address. Tally Prime has no public cloud connection.
- **Shopify orders are not counted as stock out.** Your Tally invoices already include online sales, so counting both would double the sales.
- **Customer data.** Orders and Tally registers contain names, phones and addresses. Keep the Supabase and Vercel accounts protected with strong passwords and two step login.

## Adding features later

The code is organised so new screens are small:

- `src/app/(app)/<name>/page.tsx` is a screen. Add a link in `src/components/AppShell.tsx`.
- `src/lib/data/store.ts` gives every screen `useTable("table")` and `db.insert/update/remove`. Add a table in `supabase/schema.sql` and `src/lib/types.ts`.
- `src/components/DataGrid.tsx` gives search, filters, sorting, editing, selection and export to any table in a few lines.
- `src/lib/parse/` holds one reader per file layout. To support a new layout, add a reader and list it in `detect.ts`.
- `src/app/api/` holds server routes.

## Tests

```bash
npm run test:parsers     # reads your sample files and checks exact totals (needs ./samples)
npm run build
BASE=http://localhost:3000 SAMPLE_DIR=./samples npm run test:e2e   # browser test with Playwright
```
