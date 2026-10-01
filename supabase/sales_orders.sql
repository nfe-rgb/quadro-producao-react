-- Execute este script no SQL Editor do Supabase.
-- Cria pedidos de venda com saldo controlado por quantidade faturada.

begin;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  customer_order_number text not null,
  customer text not null,
  delivery_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint sales_orders_identifier_nonblank check (btrim(identifier) <> ''),
  constraint sales_orders_customer_order_nonblank check (btrim(customer_order_number) <> ''),
  constraint sales_orders_customer_nonblank check (btrim(customer) <> '')
);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  code text not null,
  description text not null,
  color text null,
  quantity numeric(14, 3) not null,
  unit_value numeric(14, 4) not null default 0,
  ipi_percent numeric(8, 4) not null default 0,
  invoiced_quantity numeric(14, 3) not null default 0,
  total_with_ipi numeric(14, 2) generated always as (
    round(quantity * unit_value * (1 + ipi_percent / 100), 2)
  ) stored,
  created_at timestamptz not null default timezone('utc', now()),
  constraint sales_order_items_quantity_positive check (quantity > 0),
  constraint sales_order_items_unit_value_nonnegative check (unit_value >= 0),
  constraint sales_order_items_ipi_nonnegative check (ipi_percent >= 0),
  constraint sales_order_items_invoiced_range check (invoiced_quantity >= 0 and invoiced_quantity <= quantity)
);

create index if not exists sales_order_items_order_idx
  on public.sales_order_items (sales_order_id);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  sales_order_item_id uuid not null references public.sales_order_items(id),
  sales_order_identifier text not null,
  invoice_number text not null,
  item_code text not null,
  item_description text not null,
  color text null,
  customer text not null,
  quantity numeric(14, 3) not null,
  unit_value numeric(14, 4) not null default 0,
  ipi_percent numeric(8, 4) not null default 0,
  invoice_value numeric(14, 2) generated always as (
    round(quantity * unit_value * (1 + ipi_percent / 100), 2)
  ) stored,
  invoice_date date not null default (timezone('America/Sao_Paulo', now())::date),
  created_at timestamptz not null default timezone('utc', now()),
  constraint sales_invoices_invoice_nonblank check (btrim(invoice_number) <> ''),
  constraint sales_invoices_quantity_positive check (quantity > 0)
);

create index if not exists sales_invoices_item_code_idx
  on public.sales_invoices (item_code, created_at desc);

create index if not exists sales_invoices_sales_order_item_idx
  on public.sales_invoices (sales_order_item_id, created_at desc);

alter table public.sales_invoices
  add column if not exists invoice_date date;

update public.sales_invoices
set invoice_date = timezone('America/Sao_Paulo', created_at)::date
where invoice_date is null;

alter table public.sales_invoices
  alter column invoice_date set default (timezone('America/Sao_Paulo', now())::date),
  alter column invoice_date set not null;

alter table public.sales_invoices
  add column if not exists unit_value numeric(14, 4),
  add column if not exists ipi_percent numeric(8, 4);

update public.sales_invoices invoice
set unit_value = item.unit_value,
    ipi_percent = item.ipi_percent
from public.sales_order_items item
where invoice.sales_order_item_id = item.id
  and (invoice.unit_value is null or invoice.ipi_percent is null);

alter table public.sales_invoices
  alter column unit_value set default 0,
  alter column unit_value set not null,
  alter column ipi_percent set default 0,
  alter column ipi_percent set not null,
  add column if not exists invoice_value numeric(14, 2) generated always as (
    round(quantity * unit_value * (1 + ipi_percent / 100), 2)
  ) stored;

create index if not exists sales_invoices_invoice_date_idx
  on public.sales_invoices (invoice_date);

drop function if exists public.register_sales_invoice(uuid, text, numeric);

create or replace function public.register_sales_invoice(
  p_sales_order_item_id uuid,
  p_invoice_number text,
  p_quantity numeric,
  p_invoice_date date default (timezone('America/Sao_Paulo', now())::date)
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.sales_order_items%rowtype;
  v_sales_order_identifier text;
  v_customer text;
  v_produced_quantity numeric;
  v_previously_invoiced numeric;
  v_available_quantity numeric;
  v_invoice_id uuid;
begin
  if nullif(btrim(coalesce(p_invoice_number, '')), '') is null then
    raise exception 'Informe o número da Nota Fiscal.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade faturada deve ser maior que zero.' using errcode = '22023';
  end if;

  select * into v_item
  from public.sales_order_items
  where id = p_sales_order_item_id
  for update;

  if not found then
    raise exception 'Item do pedido não encontrado.' using errcode = 'P0002';
  end if;

  if p_quantity > v_item.quantity - v_item.invoiced_quantity then
    raise exception 'Quantidade faturada excede o saldo do pedido (%).',
      v_item.quantity - v_item.invoiced_quantity using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_item.code));

  select so.identifier, so.customer
    into v_sales_order_identifier, v_customer
  from public.sales_orders so
  where so.id = v_item.sales_order_id;

  select coalesce(sum(ps.qty_pieces), 0)
    into v_produced_quantity
  from public.production_scans ps
  join public.orders o on o.id = ps.order_id
  where btrim(split_part(coalesce(o.product, ''), '-', 1)) = btrim(v_item.code);

  select coalesce(sum(si.quantity), 0)
    into v_previously_invoiced
  from public.sales_invoices si
  where si.item_code = v_item.code;

  v_available_quantity := greatest(0, v_produced_quantity - v_previously_invoiced);
  if p_quantity > v_available_quantity then
    raise exception 'Estoque insuficiente para faturar. Disponível: %.',
      v_available_quantity using errcode = '23514';
  end if;

  insert into public.sales_invoices (
    sales_order_item_id,
    sales_order_identifier,
    invoice_number,
    item_code,
    item_description,
    color,
    customer,
    quantity,
    unit_value,
    ipi_percent,
    invoice_date
  ) values (
    v_item.id,
    v_sales_order_identifier,
    btrim(p_invoice_number),
    v_item.code,
    v_item.description,
    v_item.color,
    v_customer,
    p_quantity,
    v_item.unit_value,
    v_item.ipi_percent,
    p_invoice_date
  ) returning id into v_invoice_id;

  update public.sales_order_items
  set invoiced_quantity = invoiced_quantity + p_quantity
  where id = v_item.id;

  return v_invoice_id;
end;
$$;

alter table public.orders
  add column if not exists sales_order_item_id uuid
  references public.sales_order_items(id) on delete set null;

alter table public.orders
  add column if not exists customer_order_number text;

create unique index if not exists orders_sales_order_item_id_unique
  on public.orders (sales_order_item_id)
  where sales_order_item_id is not null;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.sales_orders to anon, authenticated;
grant select, insert, update, delete on public.sales_order_items to anon, authenticated;
grant select on public.sales_invoices to anon, authenticated;
grant select, insert, update on public.orders to anon, authenticated;
grant execute on function public.register_sales_invoice(uuid, text, numeric, date) to anon, authenticated;

alter table public.sales_orders disable row level security;
alter table public.sales_order_items disable row level security;
alter table public.sales_invoices disable row level security;

commit;