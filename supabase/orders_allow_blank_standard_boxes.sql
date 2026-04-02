alter table public.orders
  alter column boxes drop not null,
  alter column standard drop not null;

update public.orders
set boxes = null
where boxes is not null
  and nullif(trim(boxes::text), '') is null;

update public.orders
set standard = null
where standard is not null
  and nullif(trim(standard::text), '') is null;