begin;

alter table public.orders
  add column if not exists unit_value numeric(12, 4);

alter table public.orders
  drop constraint if exists orders_unit_value_nonnegative;

alter table public.orders
  add constraint orders_unit_value_nonnegative
  check (unit_value is null or unit_value >= 0);

comment on column public.orders.unit_value is
  'Valor unitario especifico da O.P.; quando nulo, usar items.unit_value como fallback.';

commit;
