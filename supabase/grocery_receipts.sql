-- Cupons de mercado e itens consumidos. Rode uma vez no SQL Editor do Supabase.

create table if not exists public.grocery_receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  store text not null default '',
  purchase_date date not null,
  total numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  receipt_id uuid not null references public.grocery_receipts(id) on delete cascade,
  purchase_date date not null,
  name text not null default '',
  product text not null,
  category text not null default 'Outros',
  quantity numeric(12,3) not null default 1,
  unit text not null default 'un',
  total_price numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists grocery_items_household_date_idx on public.grocery_items (household_id, purchase_date);
create index if not exists grocery_items_receipt_idx on public.grocery_items (receipt_id);

alter table public.grocery_receipts enable row level security;
alter table public.grocery_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['grocery_receipts', 'grocery_items'] loop
    execute format('drop policy if exists "%1$s_member_all" on public.%1$s', t);
    execute format($p$create policy "%1$s_member_all" on public.%1$s for all
      using (household_id in (select household_id from public.household_members where user_id = auth.uid()))
      with check (household_id in (select household_id from public.household_members where user_id = auth.uid()))$p$, t);
  end loop;
end $$;

alter publication supabase_realtime add table public.grocery_receipts;
alter publication supabase_realtime add table public.grocery_items;
