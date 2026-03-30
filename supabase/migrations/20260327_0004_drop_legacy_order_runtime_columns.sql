begin;

-- Execute esta migration somente depois de validar:
-- 1. O frontend inteiro consumindo production_orders_runtime_v e order_machine_sessions.
-- 2. Nenhum fluxo ainda gravando started_at / interrupted_at / restarted_at diretamente em orders.
-- 3. A fila de revisao manual vazia ou conscientemente aceita.

alter table public.orders
  drop column if exists started_at,
  drop column if exists started_by,
  drop column if exists interrupted_at,
  drop column if exists interrupted_by,
  drop column if exists restarted_at,
  drop column if exists restarted_by,
  drop column if exists loweff_started_at,
  drop column if exists loweff_ended_at,
  drop column if exists loweff_by,
  drop column if exists loweff_notes;

commit;