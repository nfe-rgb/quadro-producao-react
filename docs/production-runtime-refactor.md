# Runtime de Produção Normalizado

## O que sai da tabela `orders`

Os campos abaixo deixam de ser fonte de verdade para histórico de produção:

- `started_at`
- `started_by`
- `interrupted_at`
- `interrupted_by`
- `restarted_at`
- `restarted_by`
- `loweff_started_at`
- `loweff_ended_at`
- `loweff_by`
- `loweff_notes`

Eles devem ser tratados como legado temporário até a execução da migration final:

- [supabase/migrations/20260327_0004_drop_legacy_order_runtime_columns.sql](supabase/migrations/20260327_0004_drop_legacy_order_runtime_columns.sql)

## Nova fonte de verdade

- `orders`: dados essenciais, fila, metadados comerciais e status corrente
- `order_machine_sessions`: histórico de produção por máquina
- `machine_stops`: paradas vinculadas à sessão
- `low_efficiency_logs`: baixa eficiência vinculada à sessão
- `production_orders_runtime_v`: read model único para o frontend

## Ordem de aplicação

1. Executar [supabase/migrations/20260327_0001_production_runtime_model.sql](supabase/migrations/20260327_0001_production_runtime_model.sql)
2. Executar [supabase/migrations/20260327_0002_production_runtime_rpcs.sql](supabase/migrations/20260327_0002_production_runtime_rpcs.sql)
3. Executar [supabase/migrations/20260327_0003_production_runtime_audit_and_backfill.sql](supabase/migrations/20260327_0003_production_runtime_audit_and_backfill.sql)
4. Validar a fila `production_migration_review_queue`
5. Validar frontend e relatórios usando `production_orders_runtime_v`
6. Executar [supabase/migrations/20260327_0004_drop_legacy_order_runtime_columns.sql](supabase/migrations/20260327_0004_drop_legacy_order_runtime_columns.sql)

## Regras operacionais novas

- toda transição crítica passa por RPC
- toda sessão ativa é única por ordem e por máquina
- toda parada aberta é única por máquina
- toda baixa eficiência aberta é única por sessão
- troca de máquina fecha a sessão anterior e abre outra na máquina nova
- envio para fila fecha sessão e qualquer evento aberto antes da reordenação

## RPCs principais

- `production_start_order`
- `production_stop_order`
- `production_resume_order`
- `production_enter_low_efficiency`
- `production_exit_low_efficiency`
- `production_move_order_machine`
- `production_send_to_queue`
- `production_finalize_order`
- `production_sanitize_open_state`

## Checklist de corte

- Painel e PainelTV sem consulta direta de baixa eficiência
- Hook `useOrders` lendo `production_orders_runtime_v`
- Registro calculando indicadores com a camada `productionIntervals`
- Apontamento normalizando sobreposição de paradas por turno
- Leituras administrativas e analíticas migradas para o read model onde aplicável

## Revisão manual obrigatória

Depois do backfill, revisar:

- ordens com `ORDER_MACHINE_DIVERGENCE`
- paradas duplicadas abertas
- baixa eficiência duplicada aberta
- sessões abertas duplicadas
- intervalos inválidos

Os itens pendentes ficam em `production_migration_review_queue`.