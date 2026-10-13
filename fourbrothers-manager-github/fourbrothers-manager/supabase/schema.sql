-- FOURBROTHERS MANAGER database schema for Supabase (free plan is enough).
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- It is safe to run again later: every statement is written to be repeatable.

-- ============================================================
-- 1. Users and roles
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'viewer' check (role in ('admin','manager','staff','viewer')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- The very first account that signs up becomes the active admin.
-- Every later account starts inactive until an admin approves it in the Users screen.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when first_user then 'admin' else 'viewer' end,
    first_user
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers used by the security rules below.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.can_read()   returns boolean language sql stable as $$ select public.my_role() is not null $$;
create or replace function public.can_write()  returns boolean language sql stable as $$ select public.my_role() in ('admin','manager','staff') $$;
create or replace function public.can_manage() returns boolean language sql stable as $$ select public.my_role() in ('admin','manager') $$;
create or replace function public.is_admin()   returns boolean language sql stable as $$ select public.my_role() = 'admin' $$;

-- Lets the login page know whether the first admin still has to be created.
create or replace function public.needs_setup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.profiles)
$$;
grant execute on function public.needs_setup() to anon, authenticated;

-- ============================================================
-- 2. Core tables
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  ext_key text unique,
  sku text,
  name text not null,
  category text,
  unit text,
  location text,
  opening_qty numeric not null default 0,
  reorder_level numeric not null default 0,
  price numeric,
  cost numeric,
  shopify_qty numeric,
  shopify_handle text,
  vendor text,
  status text not null default 'active' check (status in ('active','archived')),
  image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_sku_idx on public.products (sku);
create index if not exists products_name_idx on public.products (lower(name));
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

-- Different spellings of a product name (Tally name, purchase book name, Shopify name) point to one product.
-- product_id = null means "this name is not a stock item, ignore it".
create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  alias_key text not null unique,
  product_id uuid references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists product_aliases_product_idx on public.product_aliases (product_id);

-- Every file you import is recorded here so the whole import can be undone later.
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  kind text not null,
  destination text not null,
  row_count integer not null default 0,
  inserted integer not null default 0,
  skipped integer not null default 0,
  summary jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  type text not null check (type in ('IN','OUT','ADJUST')),
  product_id uuid references public.products(id) on delete set null,
  raw_name text not null,
  qty numeric not null,
  party text,
  address text,
  city text,
  state text,
  pincode text,
  gstin text,
  voucher_type text,
  voucher_no text,
  channel text,
  location text,
  source text not null default 'manual',
  batch_id uuid references public.import_batches(id) on delete cascade,
  dedupe_key text unique,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_date_idx on public.stock_movements (date desc);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id);
create index if not exists stock_movements_voucher_idx on public.stock_movements (voucher_no);
create index if not exists stock_movements_batch_idx on public.stock_movements (batch_id);

-- "Sections": any Excel/CSV/PDF you upload as a new section becomes a dataset with its own columns.
create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  columns jsonb not null default '[]'::jsonb,
  source_file text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists datasets_touch on public.datasets;
create trigger datasets_touch before update on public.datasets for each row execute function public.touch_updated_at();

create table if not exists public.dataset_rows (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  batch_id uuid references public.import_batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dataset_rows_dataset_idx on public.dataset_rows (dataset_id);
create index if not exists dataset_rows_batch_idx on public.dataset_rows (batch_id);
drop trigger if exists dataset_rows_touch on public.dataset_rows;
create trigger dataset_rows_touch before update on public.dataset_rows for each row execute function public.touch_updated_at();

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  ship_date date not null default current_date,
  customer_name text not null,
  phone text,
  city text,
  state text,
  address text,
  invoice_no text,
  courier text,
  tracking_no text,
  status text not null default 'Pending' check (status in ('Pending','Packed','Dispatched','Delivered','Returned')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_date_idx on public.shipments (ship_date desc);
create index if not exists shipments_invoice_idx on public.shipments (invoice_no);
drop trigger if exists shipments_touch on public.shipments;
create trigger shipments_touch before update on public.shipments for each row execute function public.touch_updated_at();

create table if not exists public.shipment_files (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  path text not null,
  name text not null,
  mime text,
  size bigint,
  created_at timestamptz not null default now()
);
create index if not exists shipment_files_shipment_idx on public.shipment_files (shipment_id);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_email text,
  action text not null,
  entity text,
  entity_id text,
  detail text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create table if not exists public.settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- Stock on hand per product = opening + IN - OUT + ADJUST. Handy for Google Sheets / Power BI / other tools.
create or replace view public.stock_levels
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.category,
  p.location,
  p.opening_qty,
  coalesce(sum(m.qty) filter (where m.type = 'IN'), 0)     as qty_in,
  coalesce(sum(m.qty) filter (where m.type = 'OUT'), 0)    as qty_out,
  coalesce(sum(m.qty) filter (where m.type = 'ADJUST'), 0) as qty_adjust,
  p.opening_qty
    + coalesce(sum(m.qty) filter (where m.type = 'IN'), 0)
    - coalesce(sum(m.qty) filter (where m.type = 'OUT'), 0)
    + coalesce(sum(m.qty) filter (where m.type = 'ADJUST'), 0) as on_hand,
  p.reorder_level,
  p.shopify_qty
from public.products p
left join public.stock_movements m on m.product_id = p.id
where p.status = 'active'
group by p.id;

-- ============================================================
-- 3. Security rules (Row Level Security)
-- viewer  = read only
-- staff   = add and edit movements, shipments, section rows
-- manager = everything except user management and settings
-- admin   = everything
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.products        enable row level security;
alter table public.product_aliases enable row level security;
alter table public.import_batches  enable row level security;
alter table public.stock_movements enable row level security;
alter table public.datasets        enable row level security;
alter table public.dataset_rows    enable row level security;
alter table public.shipments       enable row level security;
alter table public.shipment_files  enable row level security;
alter table public.audit_log       enable row level security;
alter table public.settings        enable row level security;

do $$
declare
  t text;
begin
  -- everyone who is active can read everything except the audit log
  foreach t in array array['products','product_aliases','import_batches','stock_movements','datasets','dataset_rows','shipments','shipment_files','settings','profiles']
  loop
    execute format('drop policy if exists "read_%1$s" on public.%1$I', t);
    execute format('create policy "read_%1$s" on public.%1$I for select to authenticated using (public.can_read())', t);
  end loop;
end $$;

-- A signed in person can always read their own profile (needed to show "waiting for approval").
drop policy if exists "read_own_profile" on public.profiles;
create policy "read_own_profile" on public.profiles for select to authenticated using (id = auth.uid());

-- manager level tables
do $$
declare
  t text;
begin
  foreach t in array array['products','product_aliases','import_batches','datasets']
  loop
    execute format('drop policy if exists "ins_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "upd_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "del_%1$s" on public.%1$I', t);
    execute format('create policy "ins_%1$s" on public.%1$I for insert to authenticated with check (public.can_manage())', t);
    execute format('create policy "upd_%1$s" on public.%1$I for update to authenticated using (public.can_manage()) with check (public.can_manage())', t);
    execute format('create policy "del_%1$s" on public.%1$I for delete to authenticated using (public.can_manage())', t);
  end loop;
end $$;

-- staff level tables: staff can add and edit, only managers can delete
do $$
declare
  t text;
begin
  foreach t in array array['stock_movements','dataset_rows','shipments','shipment_files']
  loop
    execute format('drop policy if exists "ins_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "upd_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "del_%1$s" on public.%1$I', t);
    execute format('create policy "ins_%1$s" on public.%1$I for insert to authenticated with check (public.can_write())', t);
    execute format('create policy "upd_%1$s" on public.%1$I for update to authenticated using (public.can_write()) with check (public.can_write())', t);
    execute format('create policy "del_%1$s" on public.%1$I for delete to authenticated using (public.can_manage())', t);
  end loop;
end $$;

-- audit log: managers read, any active user can add a line
drop policy if exists "read_audit_log" on public.audit_log;
create policy "read_audit_log" on public.audit_log for select to authenticated using (public.can_manage());
drop policy if exists "ins_audit_log" on public.audit_log;
create policy "ins_audit_log" on public.audit_log for insert to authenticated with check (public.can_read());

-- settings and profiles: admin only for changes
drop policy if exists "ins_settings" on public.settings;
create policy "ins_settings" on public.settings for insert to authenticated with check (public.is_admin());
drop policy if exists "upd_settings" on public.settings;
create policy "upd_settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "del_settings" on public.settings;
create policy "del_settings" on public.settings for delete to authenticated using (public.is_admin());

drop policy if exists "upd_profiles" on public.profiles;
create policy "upd_profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "del_profiles" on public.profiles;
create policy "del_profiles" on public.profiles for delete to authenticated using (public.is_admin());

-- ============================================================
-- 4. File storage for shipment photos, invoices and any other file
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('shipment-files', 'shipment-files', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "shipment_files_read" on storage.objects;
create policy "shipment_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'shipment-files' and public.can_read());
drop policy if exists "shipment_files_insert" on storage.objects;
create policy "shipment_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'shipment-files' and public.can_write());
drop policy if exists "shipment_files_update" on storage.objects;
create policy "shipment_files_update" on storage.objects for update to authenticated
  using (bucket_id = 'shipment-files' and public.can_write());
drop policy if exists "shipment_files_delete" on storage.objects;
create policy "shipment_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'shipment-files' and public.can_manage());

-- ============================================================
-- 5. Live updates between users (Realtime)
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['products','product_aliases','stock_movements','datasets','dataset_rows','shipments','shipment_files','import_batches']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null; -- already added
    end;
  end loop;
end $$;
