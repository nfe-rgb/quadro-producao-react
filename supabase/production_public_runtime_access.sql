-- Execute este script no SQL Editor do Supabase.
-- Objetivo: deixar os apontamentos de produção acessíveis sem login obrigatório,
-- mantendo o login apenas como barreira de telas no frontend.

begin;

grant usage on schema public to anon, authenticated;

-- Tabelas usadas diretamente pelo frontend para leitura e apontamentos.
grant select, insert, update on public.orders to anon, authenticated;
grant select, insert, update on public.order_machine_sessions to anon, authenticated;
grant select, insert, update on public.machine_stops to anon, authenticated;
grant select, insert, update on public.low_efficiency_logs to anon, authenticated;
grant select, insert, update on public.production_scans to anon, authenticated;
grant select, insert, update on public.scrap_logs to anon, authenticated;
grant select, insert, update on public.injection_production_entries to anon, authenticated;
grant select, insert, update on public.shift_responsibles to anon, authenticated;
grant select on public.production_orders_runtime_v to anon, authenticated;
grant select on public.machine_priorities to anon, authenticated;

-- Remove RLS apenas do runtime de produção.
alter table public.orders disable row level security;
alter table public.order_machine_sessions disable row level security;
alter table public.machine_stops disable row level security;
alter table public.low_efficiency_logs disable row level security;
alter table public.production_scans disable row level security;
alter table public.scrap_logs disable row level security;
alter table public.injection_production_entries disable row level security;
alter table public.shift_responsibles disable row level security;
alter table public.machine_priorities disable row level security;

-- Garante execução das RPCs principais do runtime de produção.
-- Usa descoberta dinâmica para não falhar quando a assinatura real divergir.
do $$
declare
	fn_name text;
	fn_signature text;
begin
	foreach fn_name in array array[
		'production_start_order',
		'production_stop_order',
		'production_resume_order',
		'production_enter_low_efficiency',
		'production_enter_low_efficiency_v3',
		'production_exit_low_efficiency',
		'production_finalize_order',
		'production_send_to_queue',
		'production_move_order_machine',
		'production_sanitize_open_state'
	]
	loop
		for fn_signature in
			select format(
				'%I.%I(%s)',
				n.nspname,
				p.proname,
				pg_get_function_identity_arguments(p.oid)
			)
			from pg_proc p
			join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public'
				and p.proname = fn_name
		loop
			execute format(
				'grant execute on function %s to anon, authenticated',
				fn_signature
			);
		end loop;
	end loop;
end
$$;

commit;

-- Observações:
-- 1. Se alguma RPC nao receber grant, rode:
--    select n.nspname as schema_name,
--           p.proname as function_name,
--           pg_get_function_identity_arguments(p.oid) as identity_args
--    from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname like 'production_%'
--    order by p.proname;
--
-- 2. Se for usar sessão anônima no frontend, habilite também:
--    Authentication > Providers > Anonymous Sign-Ins > Enabled.
--
-- 3. Este script NAO mexe em estoque, cadastro de itens ou telas administrativas.