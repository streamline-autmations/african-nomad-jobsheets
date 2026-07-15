-- African Nomad Job Sheet Automation System — Phase 1 schema.
-- Project: wnsjzxotknadqvznnijw — a dedicated project for this system (not the
-- shared mgqfoorchhbtlhvqscbl project originally referenced in the context
-- doc; Christiaan provided this project instead, and it started empty).
-- Applied via the Supabase MCP apply_migration tool.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference/lookup tables
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Mirror of QBD's customer list. Populated by the QBD Bridge (Phase 3) once a
-- CustomerQuery/CustomerAdd round-trip confirms the QBD ListID; rows can also
-- exist here pre-sync (qbd_list_id null) while a create_customer action is
-- still sitting in qbd_sync_queue.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  qbd_list_id text unique,
  name text not null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.common_expenses (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Core table
-- ---------------------------------------------------------------------------

create table if not exists public.job_sheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid references public.customers(id),
  customer_name_raw text not null default '',
  job_description text not null default '',
  event_date date,

  -- NOTE: 'accepted' / 'invoice_queued' / 'invoiced' states described in the
  -- approval-gates section of the context doc are intentionally NOT in this
  -- constraint yet — Phase 2 only builds the draft -> approved transition.
  -- Extend this check (and qbd_sync_queue.action) in a follow-up migration
  -- when the invoice-acceptance flow is built, rather than guessing the
  -- shape now.
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'queued', 'synced', 'failed')),

  client_lines jsonb not null default '[]'::jsonb,
  expense_lines jsonb not null default '[]'::jsonb,

  client_subtotal numeric(12, 2) not null default 0,
  vat_amount numeric(12, 2) not null default 0,
  client_total numeric(12, 2) not null default 0,
  expense_total numeric(12, 2) not null default 0,

  gross_profit numeric(12, 2) not null default 0,
  profit_margin_pct numeric(6, 2) not null default 0,

  nsa_fee numeric(12, 2) not null default 0,
  sibanye_fee numeric(12, 2) not null default 0,
  tuscany_fee numeric(12, 2) not null default 0,
  total_fees numeric(12, 2) not null default 0,

  net_profit numeric(12, 2) not null default 0,
  net_margin_pct numeric(6, 2) not null default 0,

  qbd_estimate_txn_id text,
  qbd_invoice_txn_id text,

  created_at timestamptz not null default now(),
  approved_at timestamptz,
  synced_at timestamptz
);

create index if not exists job_sheets_company_id_idx on public.job_sheets(company_id);
create index if not exists job_sheets_customer_id_idx on public.job_sheets(customer_id);
create index if not exists job_sheets_status_idx on public.job_sheets(status);
create index if not exists job_sheets_created_at_idx on public.job_sheets(created_at desc);

-- Defense-in-depth: whatever sets status to 'approved' also gets approved_at
-- stamped, even if the calling app code forgets to set it explicitly. This
-- table is the audit trail for the one non-negotiable approval gate in the
-- whole system, so it shouldn't depend solely on the frontend remembering.
create or replace function public.job_sheets_stamp_approved_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists job_sheets_stamp_approved_at_trg on public.job_sheets;
create trigger job_sheets_stamp_approved_at_trg
  before update on public.job_sheets
  for each row execute function public.job_sheets_stamp_approved_at();

-- ---------------------------------------------------------------------------
-- Sync mechanism
-- ---------------------------------------------------------------------------

create table if not exists public.qbd_sync_queue (
  id uuid primary key default gen_random_uuid(),
  job_sheet_id uuid not null references public.job_sheets(id) on delete cascade,
  action text not null
    check (action in ('create_customer', 'create_estimate', 'create_invoice', 'create_bill')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'confirmed', 'failed')),
  qbd_txn_id text,
  error_message text,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create index if not exists qbd_sync_queue_job_sheet_id_idx on public.qbd_sync_queue(job_sheet_id);
create index if not exists qbd_sync_queue_status_idx on public.qbd_sync_queue(status);

-- The core approval gate, enforced at the database layer rather than trusting
-- the app alone: NO row can be queued — including create_customer — for a
-- job sheet that hasn't actually been approved. The context doc is explicit
-- that "nothing before approval touches the sync queue," full stop, so this
-- applies to every action, not just the financial ones. The customer dropdown
-- "doesn't exist yet" fallback in Phase 2 stages the new customer's name on
-- the job_sheets row itself (customer_name_raw) and only becomes a real
-- create_customer queue row inside approve_job_sheet() below, at the same
-- moment the estimate is queued.
create or replace function public.qbd_sync_queue_requires_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sheet_status text;
begin
  select status into sheet_status from public.job_sheets where id = new.job_sheet_id;

  if sheet_status is null then
    raise exception 'qbd_sync_queue.job_sheet_id % does not reference an existing job_sheets row', new.job_sheet_id;
  end if;

  if sheet_status not in ('approved', 'queued', 'synced') then
    raise exception
      'job_sheet % must be approved before a % can be queued (current status: %)',
      new.job_sheet_id, new.action, sheet_status;
  end if;

  return new;
end;
$$;

drop trigger if exists qbd_sync_queue_requires_approval_trg on public.qbd_sync_queue;
create trigger qbd_sync_queue_requires_approval_trg
  before insert on public.qbd_sync_queue
  for each row execute function public.qbd_sync_queue_requires_approval();

-- Atomic approval action: flips a draft to approved and queues the sync
-- actions it needs, in one transaction, so the app can never end up in a
-- state where the status flipped but nothing was queued (or vice versa).
-- This is the only supported way to write to qbd_sync_queue from the app —
-- the frontend never inserts into that table directly.
create or replace function public.approve_job_sheet(p_job_sheet_id uuid)
returns public.job_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  sheet public.job_sheets;
begin
  select * into sheet from public.job_sheets where id = p_job_sheet_id for update;

  if sheet.id is null then
    raise exception 'job_sheet % not found', p_job_sheet_id;
  end if;

  if sheet.status <> 'draft' then
    raise exception 'job_sheet % is not in draft status (current status: %) — cannot re-approve', p_job_sheet_id, sheet.status;
  end if;

  update public.job_sheets
    set status = 'approved'
    where id = p_job_sheet_id
    returning * into sheet;

  if sheet.customer_id is null then
    insert into public.qbd_sync_queue (job_sheet_id, action, payload)
    values (
      p_job_sheet_id,
      'create_customer',
      jsonb_build_object('name', sheet.customer_name_raw)
    );
  end if;

  insert into public.qbd_sync_queue (job_sheet_id, action, payload)
  values (
    p_job_sheet_id,
    'create_estimate',
    jsonb_build_object(
      'company_id', sheet.company_id,
      'customer_id', sheet.customer_id,
      'customer_name_raw', sheet.customer_name_raw,
      'job_description', sheet.job_description,
      'event_date', sheet.event_date,
      'client_lines', sheet.client_lines,
      'client_subtotal', sheet.client_subtotal,
      'vat_amount', sheet.vat_amount,
      'client_total', sheet.client_total
    )
  );

  return sheet;
end;
$$;

grant execute on function public.approve_job_sheet(uuid) to anon;

-- ---------------------------------------------------------------------------
-- Supplier bill capture — stub only. Not wired into the app until a later
-- phase (flagged in the build order); table exists now so job_sheet_id FKs
-- and phase-3 QBD BillAdd payload shapes have somewhere stable to land.
-- ---------------------------------------------------------------------------

create table if not exists public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  job_sheet_id uuid references public.job_sheets(id) on delete set null,
  supplier_name text not null,
  amount numeric(12, 2) not null default 0,
  source text check (source in ('whatsapp', 'email')),
  status text not null default 'pending',
  qbd_bill_txn_id text,
  created_at timestamptz not null default now()
);

create index if not exists supplier_bills_job_sheet_id_idx on public.supplier_bills(job_sheet_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Following the sourcing engine's actual end state (see
-- 202606230001_allow_anon_no_auth_required.sql and
-- 202606270001_anon_admin_and_usage.sql in that project): no Supabase Auth /
-- login flow, RLS enabled on every table, broad access granted to the `anon`
-- role since this is an internal single-team tool, not a public-facing app.
--
-- Deliberate deviation from that pattern: no anon DELETE policy on
-- job_sheets, qbd_sync_queue, or supplier_bills. Those are financial audit
-- trail — the sourcing engine only opened up delete on its admin/catalogue
-- tables (saved_products), never on request/transaction history. Flag to
-- Christiaan if a "delete a draft" UI affordance turns out to be wanted;
-- that should be a soft-delete/status flag, not a real DELETE.
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.customers enable row level security;
alter table public.common_expenses enable row level security;
alter table public.job_sheets enable row level security;
alter table public.qbd_sync_queue enable row level security;
alter table public.supplier_bills enable row level security;

do $$ begin
  create policy "anon can read companies" on public.companies
    for select to anon using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can read customers" on public.customers
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can insert customers" on public.customers
    for insert to anon with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can update customers" on public.customers
    for update to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can read common expenses" on public.common_expenses
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can manage common expenses" on public.common_expenses
    for all to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can read job sheets" on public.job_sheets
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can insert job sheets" on public.job_sheets
    for insert to anon with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can update job sheets" on public.job_sheets
    for update to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Deliberately read-only for anon. Every write to this table goes through
-- approve_job_sheet() (security definer, bypasses RLS) from the app side, or
-- through the QBD Bridge's service_role key (Phase 3, also bypasses RLS)
-- writing back sync status/txn IDs. There is no legitimate direct-write path
-- from the frontend, so none is granted.
do $$ begin
  create policy "anon can read qbd sync queue" on public.qbd_sync_queue
    for select to anon using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can read supplier bills" on public.supplier_bills
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can insert supplier bills" on public.supplier_bills
    for insert to anon with check (true);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

insert into public.companies (name) values
  ('African Nomad'),
  ('Tuscany SA')
on conflict (name) do nothing;

insert into public.common_expenses (label) values
  ('Accommodation'),
  ('Casual Worker Labour'),
  ('Delivery / Transport'),
  ('Equipment Hire'),
  ('Fuel'),
  ('Catering / Food Cost'),
  ('Printing / Branding'),
  ('Venue Hire'),
  ('Staff Wages'),
  ('Miscellaneous')
on conflict (label) do nothing;
