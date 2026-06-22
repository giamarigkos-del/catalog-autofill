-- Catalog Intake — αρχικό schema
-- Τρέξε αυτό στο SQL Editor του νέου Supabase project (ξεχωριστό από το Project 2)

create extension if not exists "pgcrypto";

create table sessions (
  id uuid primary key default gen_random_uuid(),
  store_name text,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'exported')),
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);

create table items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  price numeric(10,2),
  description text,
  confidence text check (confidence in ('high', 'low')),
  notes text,
  sort_order int not null default 0
);

create table option_groups (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  title text not null,
  type text not null check (type in ('required_single', 'optional_multi')),
  sort_order int not null default 0
);

create table options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references option_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0,
  sort_order int not null default 0
);

-- Ευρετήρια για γρήγορο φόρτωμα ανά session
create index idx_categories_session on categories(session_id);
create index idx_items_category on items(category_id);
create index idx_option_groups_item on option_groups(item_id);
create index idx_options_group on options(option_group_id);

-- RLS: ενεργό, αλλά απλό permissive policy.
-- Δεν χρειάζεται multi-tenant πολυπλοκότητα — το frontend είναι ήδη
-- πίσω από password gate (όπως το intelligence.html), άρα το anon key
-- δεν είναι δημόσια εκτεθειμένο. Αν αργότερα χρειαστεί πιο αυστηρό
-- access control, προσθέτουμε auth.uid()-based policies εδώ.
alter table sessions enable row level security;
alter table categories enable row level security;
alter table items enable row level security;
alter table option_groups enable row level security;
alter table options enable row level security;

create policy "allow all - sessions" on sessions for all using (true) with check (true);
create policy "allow all - categories" on categories for all using (true) with check (true);
create policy "allow all - items" on items for all using (true) with check (true);
create policy "allow all - option_groups" on option_groups for all using (true) with check (true);
create policy "allow all - options" on options for all using (true) with check (true);
