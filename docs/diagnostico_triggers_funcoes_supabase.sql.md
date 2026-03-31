# Diagnóstico e Correção de Erros de Trigger/Função no Supabase

## 1. Verificar triggers nas tabelas principais

```sql
-- Triggers na tabela orders
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'orders'
  AND event_object_schema = 'public';

-- Triggers na tabela order_machine_sessions
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'order_machine_sessions'
  AND event_object_schema = 'public';

-- Triggers na tabela low_efficiency_logs
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'low_efficiency_logs'
  AND event_object_schema = 'public';
```

## 2. Verificar funções relacionadas a low_efficiency

```sql
SELECT n.nspname as schema, p.proname as function, pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname ILIKE '%low_efficiency%';
```

## 3. Remover triggers problemáticos (exemplo)

```sql
-- Substitua NOME_DO_TRIGGER e NOME_DA_TABELA pelos nomes encontrados
DROP TRIGGER IF EXISTS NOME_DO_TRIGGER ON public.NOME_DA_TABELA;
```

## 4. Corrigir função de low_efficiency_logs (exemplo de função correta)

```sql
CREATE OR REPLACE FUNCTION public.production_normalize_low_efficiency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
declare
  v_session record;
begin
  new.created_at := coalesce(new.created_at, timezone('utc', now()));
  new.updated_at := timezone('utc', now());
  new.started_at := coalesce(new.started_at, new.created_at, timezone('utc', now()));
  new.created_by := coalesce(new.created_by, new.started_by);
  new.closed_by := coalesce(new.closed_by, new.ended_by);
  new.started_by := coalesce(new.started_by, new.created_by);
  new.ended_by := coalesce(new.ended_by, new.closed_by);

  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'Baixa eficiencia com intervalo invalido: ended_at < started_at';
  end if;

  if new.session_id is not null then
    select s.id, s.order_id, s.machine_id
      into v_session
    from public.order_machine_sessions s
    where s.id = new.session_id;

    if not found then
      raise exception 'Sessao % nao encontrada para low_efficiency_logs', new.session_id;
    end if;

    if new.order_id is null then
      new.order_id := v_session.order_id;
    elsif new.order_id is distinct from v_session.order_id then
      raise exception 'order_id divergente da sessao na baixa eficiencia';
    end if;

    if new.machine_id is null then
      new.machine_id := v_session.machine_id;
    elsif new.machine_id is distinct from v_session.machine_id then
      raise exception 'machine_id divergente da sessao na baixa eficiencia';
    end if;
  end if;

  return new;
end;
$$;
```

## 5. Remover views conflitantes (se necessário)

```sql
DROP VIEW IF EXISTS public.low_efficiency_logs;
```

---

> **Dica:** Sempre faça backup antes de remover triggers, views ou funções!
> Se precisar de comandos específicos para triggers/funções encontradas, envie os nomes que eu monto o SQL exato.
