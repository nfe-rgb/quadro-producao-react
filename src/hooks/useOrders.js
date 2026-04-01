import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SUPABASE_CACHE_SCOPE, supabase } from '../lib/supabaseClient'
import { MAQUINAS, MOTIVOS_PARADA } from '../lib/constants'
import { localDateTimeToISO, jaIniciou } from '../lib/utils'
import {
  buildRegistroGroups,
  deriveRuntimeOrders,
  isMissingRelationError,
  mapLowEffLogsForUi,
  mapRuntimeOrder,
  mapStopsForUi,
} from '../lib/productionRuntime'

const RUNTIME_VIEW_STORAGE_KEY = `production_runtime_view_availability:${SUPABASE_CACHE_SCOPE}`

function readCachedAvailability(storageKey) {
  if (typeof window === 'undefined') return 'unknown'
  try {
    const value = window.sessionStorage.getItem(storageKey)
    return value === 'available' || value === 'missing' ? value : 'unknown'
  } catch {
    return 'unknown'
  }
}

function writeCachedAvailability(storageKey, value) {
  if (typeof window === 'undefined') return
  try {
    if (value === 'available' || value === 'missing') {
      window.sessionStorage.setItem(storageKey, value)
    } else {
      window.sessionStorage.removeItem(storageKey)
    }
  } catch {
    // Ignora indisponibilidade de sessionStorage no navegador.
  }
}

let runtimeViewAvailability = readCachedAvailability(RUNTIME_VIEW_STORAGE_KEY)
let sessionsTableAvailability = 'unknown'

function countByOrderId(rows) {
  const counts = {}
  for (const row of rows || []) {
    const key = row?.order_id != null ? String(row.order_id) : null
    if (!key) continue
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

const ORDERS_CACHE_KEY = `cached_production_orders_v1:${SUPABASE_CACHE_SCOPE}`;

function saveOrdersToCache(orders) {
  try {
    localStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(orders));
  } catch {}
}

function loadOrdersFromCache() {
  try {
    const raw = localStorage.getItem(ORDERS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function hasActiveSession(order) {
  return !!String(order?.active_session_id || '').trim()
}

export default function useOrders() {
  const [ordens, setOrdens] = useState(() => loadOrdersFromCache())
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([])
  const [sessions, setSessions] = useState([])
  const [lowEffLogs, setLowEffLogs] = useState([])
  const runtimeFallbackWarnedRef = useRef(false)
  const runtimeErrorFallbackWarnedRef = useRef(false)
  const sessionsFallbackWarnedRef = useRef(false)

  // Reduzido para buscar apenas o campo necessário
  const fetchScanCounts = useCallback(async (orderIds) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return {}

    const { data, error } = await supabase
      .from('production_scans')
      .select('order_id')
      .in('order_id', orderIds)

    if (error) {
      console.warn('Falha ao buscar contagem de scans:', error)
      return {}
    }

    return countByOrderId(data)
  }, [])

  // Reduzido: selecione apenas os campos realmente usados na UI
  const fetchOrdersBaseSnapshot = useCallback(async () => {
    const selectFields = 'id, machine_id, code, customer, product, color, qty, boxes, standard, due_date, notes, status, pos, finalized, finalized_at, created_at, updated_at';
    const [openRes, finalizedRes] = await Promise.all([
      supabase
        .from('orders')
        .select(selectFields)
        .eq('finalized', false)
        .order('pos', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('orders')
        .select(selectFields)
        .eq('finalized', true)
        .order('finalized_at', { ascending: false })
        .limit(200), // Reduzido para evitar excesso de dados
    ])
    return { openRes, finalizedRes }
  }, [])

  // ATENÇÃO: Este método faz várias queries grandes. Considere cachear resultados e aumentar intervalos de atualização!
  const fetchRuntimeSnapshot = useCallback(async () => {
    let openRes
    let finalizedRes
    let runtimeViewMissing = runtimeViewAvailability === 'missing'
    let runtimeViewErrored = false
    let shouldDeriveRuntime = runtimeViewMissing

    if (runtimeViewAvailability === 'unknown') {
      // Busca apenas campos essenciais para o painel
      const runtimeProbeRes = await supabase
        .from('production_orders_runtime_v')
        .select('id')
        .limit(1)

      if (isMissingRelationError(runtimeProbeRes.error, 'production_orders_runtime_v')) {
        runtimeViewAvailability = 'missing'
        writeCachedAvailability(RUNTIME_VIEW_STORAGE_KEY, 'missing')
        runtimeViewMissing = true
      } else if (!runtimeProbeRes.error) {
        runtimeViewAvailability = 'available'
        writeCachedAvailability(RUNTIME_VIEW_STORAGE_KEY, 'available')
      }
    }

    if (!runtimeViewMissing) {
      // Busca apenas campos essenciais para o painel
      const selectFields = [
        'id',
        'machine_id',
        'code',
        'customer',
        'product',
        'color',
        'qty',
        'boxes',
        'standard',
        'due_date',
        'notes',
        'status',
        'pos',
        'finalized',
        'created_at',
        'updated_at',
        'finalized_at',
        'finalized_by',
        'started_at',
        'started_by',
        'restarted_at',
        'restarted_by',
        'interrupted_at',
        'interrupted_by',
        'loweff_started_at',
        'loweff_ended_at',
        'loweff_notes',
        'loweff_reason',
        'active_session_id',
        'active_machine_id',
        'active_session_started_at',
        'active_session_started_by',
        'active_stop_started_at',
        'active_stop_reason',
        'active_stop_notes',
        'session_count',
      ].join(', ')
      const [runtimeOpenRes, runtimeFinalizedRes] = await Promise.all([
        supabase
          .from('production_orders_runtime_v')
          .select(selectFields)
          .eq('finalized', false)
          .order('pos', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('production_orders_runtime_v')
          .select(selectFields)
          .eq('finalized', true)
          .order('finalized_at', { ascending: false })
          .limit(200), // Reduzido para evitar excesso de dados
      ])

      openRes = runtimeOpenRes
      finalizedRes = runtimeFinalizedRes
      runtimeViewMissing = isMissingRelationError(runtimeOpenRes.error, 'production_orders_runtime_v')
        || isMissingRelationError(runtimeFinalizedRes.error, 'production_orders_runtime_v')
      runtimeViewErrored = !!runtimeOpenRes.error || !!runtimeFinalizedRes.error
      shouldDeriveRuntime = runtimeViewMissing || runtimeViewErrored

      if (runtimeViewMissing) {
        runtimeViewAvailability = 'missing'
        writeCachedAvailability(RUNTIME_VIEW_STORAGE_KEY, 'missing')
      } else if (!runtimeOpenRes.error && !runtimeFinalizedRes.error) {
        runtimeViewAvailability = 'available'
        writeCachedAvailability(RUNTIME_VIEW_STORAGE_KEY, 'available')
      }
    }

    if (runtimeViewMissing) {
      if (!runtimeFallbackWarnedRef.current) {
        console.warn('View production_orders_runtime_v não encontrada no Supabase. Reconstruindo o runtime a partir de orders + sessões/eventos.')
        runtimeFallbackWarnedRef.current = true
      }
    } else if (runtimeViewErrored && !runtimeErrorFallbackWarnedRef.current) {
      console.warn('Falha ao consultar production_orders_runtime_v. Reconstruindo o runtime a partir de orders + sessões/eventos.')
      runtimeErrorFallbackWarnedRef.current = true
    }

    if (!runtimeViewMissing && runtimeViewErrored && openRes?.error) {
      console.warn('Falha ao carregar ordens abertas do runtime:', openRes.error)
    }
    if (!runtimeViewMissing && runtimeViewErrored && finalizedRes?.error) {
      console.warn('Falha ao carregar ordens finalizadas do runtime:', finalizedRes.error)
    }

    const baseSnapshot = await fetchOrdersBaseSnapshot()
    const baseOpenRows = baseSnapshot?.openRes?.data || []
    const baseFinalizedRows = baseSnapshot?.finalizedRes?.data || []
    const runtimeOpenRows = openRes?.data || []
    const runtimeFinalizedRows = finalizedRes?.data || []

    const runtimeLooksIncomplete = !runtimeViewMissing
      && !runtimeViewErrored
      && runtimeOpenRows.length === 0
      && baseOpenRows.length > 0

    if (runtimeLooksIncomplete) {
      shouldDeriveRuntime = true
      if (!runtimeErrorFallbackWarnedRef.current) {
        console.warn('View production_orders_runtime_v retornou vazia para ordens abertas. Reconstituindo o painel a partir de orders + sessões/eventos.')
        runtimeErrorFallbackWarnedRef.current = true
      }
    }

    const relevantSourceRows = shouldDeriveRuntime
      ? [...baseOpenRows, ...baseFinalizedRows]
      : [...runtimeOpenRows, ...runtimeFinalizedRows]
    const relevantIds = Array.from(new Set(relevantSourceRows.map((order) => order?.id).filter(Boolean)))

    const [rawSessionsRes, stopsRes, lowEffRes] = await Promise.all([
      sessionsTableAvailability !== 'missing' && relevantIds.length
        ? supabase
            .from('order_machine_sessions')
            .select('id, order_id, machine_id, started_at, ended_at, started_by, ended_by, end_reason')
            .in('order_id', relevantIds)
            .order('started_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      relevantIds.length
        ? supabase
            .from('machine_stops')
            .select('id, order_id, machine_id, started_at, resumed_at, reason, notes')
            .in('order_id', relevantIds)
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      relevantIds.length
        ? supabase
            .from('low_efficiency_logs')
            .select('id, order_id, machine_id, started_at, ended_at, reason, notes')
            .in('order_id', relevantIds)
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    const sessionsRes = isMissingRelationError(rawSessionsRes.error, 'order_machine_sessions')
      ? { data: [], error: null }
      : rawSessionsRes

    if (isMissingRelationError(rawSessionsRes.error, 'order_machine_sessions')) {
      sessionsTableAvailability = 'missing'
    } else if (!rawSessionsRes.error) {
      sessionsTableAvailability = 'available'
    }

    if (isMissingRelationError(rawSessionsRes.error, 'order_machine_sessions') && !sessionsFallbackWarnedRef.current) {
      console.warn('Tabela order_machine_sessions não encontrada no Supabase. O runtime ficará incompleto até o schema normalizado ser aplicado.')
      sessionsFallbackWarnedRef.current = true
    }

    if (sessionsRes.error) {
      console.warn('Falha ao carregar sessões de produção:', sessionsRes.error)
    }
    if (stopsRes.error) {
      console.warn('Falha ao carregar paradas normalizadas:', stopsRes.error)
    }
    if (lowEffRes.error) {
      console.warn('Falha ao carregar baixa eficiência normalizada:', lowEffRes.error)
    }

    const runtimeOrders = shouldDeriveRuntime
      ? deriveRuntimeOrders(relevantSourceRows, sessionsRes.data || [], stopsRes.data || [], lowEffRes.data || [])
      : []
    const openOrders = shouldDeriveRuntime
      ? runtimeOrders.filter((order) => !order?.finalized)
      : runtimeOpenRows.map(mapRuntimeOrder)
    const finalizedOrders = shouldDeriveRuntime
      ? runtimeOrders.filter((order) => !!order?.finalized)
      : runtimeFinalizedRows.map(mapRuntimeOrder)
    const scanCounts = await fetchScanCounts(openOrders.map((order) => order.id))

    const normalizedOpenOrders = openOrders.map((order) => ({
      ...order,
      scanned_count: Number(scanCounts[String(order.id)] || 0),
    }))

    const normalizedFinalizedOrders = finalizedOrders.map((order) => ({
      ...order,
      scanned_count: Number(order.scanned_count || 0),
    }))

    const canPersistOpenOrders = shouldDeriveRuntime
      ? !baseSnapshot?.openRes?.error
      : !openRes?.error
    const canPersistFinalizedOrders = shouldDeriveRuntime
      ? !baseSnapshot?.finalizedRes?.error
      : !finalizedRes?.error

    if (canPersistOpenOrders) {
      setOrdens(normalizedOpenOrders)
      saveOrdersToCache(normalizedOpenOrders)
    }
    if (canPersistFinalizedOrders) {
      setFinalizadas(normalizedFinalizedOrders)
    }
    setSessions(sessionsRes.data || [])
    setParadas(mapStopsForUi(stopsRes.data || []))
    setLowEffLogs(mapLowEffLogsForUi(lowEffRes.data || []))
  }, [fetchOrdersBaseSnapshot, fetchScanCounts])

  async function fetchOrdensAbertas() {
    await fetchRuntimeSnapshot()
  }

  async function fetchOrdensFinalizadas() {
    await fetchRuntimeSnapshot()
  }

  async function fetchParadas() {
    await fetchRuntimeSnapshot()
  }

  useEffect(() => {
    // Tenta buscar do Supabase, se falhar, carrega do cache
    fetchRuntimeSnapshot().then(() => {
      // Se não vier nada do Supabase, mantém o cache
      if (ordens.length === 0) {
        const cached = loadOrdersFromCache();
        if (cached.length > 0) setOrdens(cached)
      }
    }).catch(() => {
      const cached = loadOrdersFromCache();
      if (cached.length > 0) setOrdens(cached)
    })

    const trackedTables = ['orders', 'order_machine_sessions', 'machine_stops', 'low_efficiency_logs']
    const channels = trackedTables.map((tableName) => (
      supabase
        .channel(`production-runtime-${tableName}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, () => {
          fetchRuntimeSnapshot()
        })
        .subscribe()
    ))

    const scansChannel = supabase
      .channel('production-runtime-scans')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'production_scans' }, (payload) => {
        const orderId = payload?.new?.order_id != null ? String(payload.new.order_id) : null
        if (!orderId) return

        setOrdens((previous) => previous.map((order) => (
          String(order.id) === orderId
            ? { ...order, scanned_count: Number(order.scanned_count || 0) + 1 }
            : order
        )))
      })
      .subscribe()

    return () => {
      channels.forEach((channel) => {
        try {
          supabase.removeChannel(channel)
        } catch (error) {
          console.warn('Falha ao remover canal realtime:', error)
        }
      })
      try {
        supabase.removeChannel(scansChannel)
      } catch (error) {
        console.warn('Falha ao remover canal de scans realtime:', error)
      }
    }
  }, [fetchRuntimeSnapshot])

  const ativosPorMaquina = useMemo(() => {
    const map = Object.fromEntries(MAQUINAS.map((machineId) => [machineId, []]))
    ordens.forEach((order) => {
      if (!order?.finalized && map[order.machine_id]) {
        map[order.machine_id].push(order)
      }
    })
    for (const machineId of MAQUINAS) {
      map[machineId] = [...map[machineId]].sort((left, right) => {
        const leftPos = Number.isFinite(Number(left?.pos)) ? Number(left.pos) : 999999
        const rightPos = Number.isFinite(Number(right?.pos)) ? Number(right.pos) : 999999
        return leftPos - rightPos
      })
    }
    return map
  }, [ordens])

  const lastFinalizadoPorMaquina = useMemo(() => {
    const map = Object.fromEntries(MAQUINAS.map((machineId) => [machineId, null]))
    for (const order of finalizadas) {
      if (!order?.machine_id || !order?.finalized_at) continue
      const previousTs = map[order.machine_id] ? new Date(map[order.machine_id]).getTime() : 0
      const currentTs = new Date(order.finalized_at).getTime()
      if (currentTs > previousTs) map[order.machine_id] = order.finalized_at
    }
    return map
  }, [finalizadas])

  const registroGrupos = useMemo(() => buildRegistroGroups([...ordens, ...finalizadas], sessions, paradas, lowEffLogs), [ordens, finalizadas, sessions, paradas, lowEffLogs])

  async function criarOrdem(form, setForm, setTab) {
    if (!form.code.trim()) return

    const { data: last, error: lastError } = await supabase
      .from('orders')
      .select('pos')
      .eq('machine_id', form.machine_id)
      .eq('finalized', false)
      .order('pos', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastError) {
      alert('Erro ao obter posição: ' + lastError.message)
      return
    }

    const nextPos = (last?.pos ?? -1) + 1
    const novo = {
      machine_id: form.machine_id,
      code: form.code,
      customer: form.customer,
      product: form.product,
      color: form.color,
      qty: form.qty,
      boxes: form.boxes,
      standard: form.standard,
      due_date: form.due_date || null,
      notes: form.notes,
      status: 'AGUARDANDO',
      pos: nextPos,
      finalized: false,
    }

    const { error } = await supabase.from('orders').insert([novo])
    if (error) {
      alert('Erro ao criar ordem: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
    setForm({ code: '', customer: '', product: '', color: '', qty: '', boxes: '', standard: '', due_date: '', notes: '', machine_id: 'P1' })
    setTab('painel')
  }

  async function atualizar(ordemParcial) {
    const before = ordens.find((order) => String(order.id) === String(ordemParcial.id))
      || finalizadas.find((order) => String(order.id) === String(ordemParcial.id))
    if (!before) return

    if (before.machine_id !== ordemParcial.machine_id) {
      const moveRes = await supabase.rpc('production_move_order_machine', {
        p_order_id: String(ordemParcial.id),
        p_target_machine: ordemParcial.machine_id,
        p_effective_at: new Date().toISOString(),
        p_actor: null,
        p_insert_at: null,
      })

      if (moveRes.error) {
        alert('Erro ao mover ordem de máquina: ' + moveRes.error.message)
        return
      }
    }

    const payload = {
      machine_id: ordemParcial.machine_id,
      code: ordemParcial.code,
      customer: ordemParcial.customer,
      product: ordemParcial.product,
      color: ordemParcial.color,
      qty: ordemParcial.qty,
      boxes: ordemParcial.boxes,
      standard: ordemParcial.standard,
      due_date: ordemParcial.due_date || null,
      notes: ordemParcial.notes,
      pos: ordemParcial.pos ?? null,
    }

    const { error } = await supabase.from('orders').update(payload).eq('id', ordemParcial.id)
    if (error) {
      alert('Erro ao atualizar: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function finalizar(ordem, payload) {
    const iso = localDateTimeToISO(payload.data, payload.hora)
    const { error } = await supabase.rpc('production_finalize_order', {
      p_order_id: String(ordem.id),
      p_finalized_at: iso,
      p_actor: payload.por,
    })

    if (error) {
      alert('Erro ao finalizar: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function enviarParaFila(ordemAtiva, opts) {
    const machineList = [...(ativosPorMaquina[ordemAtiva.machine_id] || [])].sort((left, right) => {
      const leftPos = Number.isFinite(Number(left?.pos)) ? Number(left.pos) : 999999
      const rightPos = Number.isFinite(Number(right?.pos)) ? Number(right.pos) : 999999
      return leftPos - rightPos
    })

    const activeOrder = machineList[0]
    const promotedOrder = machineList[1]

    if (!activeOrder || !promotedOrder) {
      alert('Não há itens suficientes na fila para promover.')
      return
    }

    const effectiveAt = opts?.data && opts?.hora
      ? localDateTimeToISO(opts.data, opts.hora)
      : new Date().toISOString()

    const { error } = await supabase.rpc('production_send_to_queue', {
      p_order_id: String(activeOrder.id),
      p_promoted_order_id: String(promotedOrder.id),
      p_effective_at: effectiveAt,
      p_actor: opts?.operador || null,
    })

    if (error) {
      alert('Erro ao enviar ordem para a fila: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function confirmarInicio({ ordem, operador, data, hora }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return
    }

    const { error } = await supabase.rpc('production_start_order', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_started_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_machine_id: ordem.machine_id,
    })

    if (error) {
      alert('Erro ao iniciar: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function validarSobreposicaoParada({ machineId }) {
    const aberta = paradas.find((stop) => stop.machine_id === machineId && !stop.ended_at)
    if (aberta) {
      return 'Já existe uma parada aberta nesta máquina. Encerre antes de registrar outra.'
    }
    return null
  }

  async function confirmarParada({ ordem, operador, motivo, obs, data, hora }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return
    }
    if (!String(motivo || '').trim()) {
      alert('Selecione o motivo da parada.')
      return
    }

    if (!hasActiveSession(ordem)) {
      alert('Esta ordem está sem sessão ativa. Regularize iniciando a produção novamente antes de registrar a parada.')
      return
    }

    const overlapMsg = await validarSobreposicaoParada({ machineId: ordem.machine_id })
    if (overlapMsg) {
      alert(overlapMsg)
      return
    }

    const { error } = await supabase.rpc('production_stop_order', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_started_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_reason: String(motivo).trim(),
      p_notes: obs || null,
    })

    if (error) {
      alert('Erro ao registrar parada: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function confirmarRetomada({ ordem, operador, data, hora, targetStatus }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return
    }

    if (!hasActiveSession(ordem)) {
      alert('Esta ordem está sem sessão ativa. Regularize iniciando a produção novamente antes de retomar.')
      return
    }

    const { error } = await supabase.rpc('production_resume_order', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_resumed_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_target_status: targetStatus || 'PRODUZINDO',
    })

    if (error) {
      alert('Erro ao retomar produção: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function confirmarBaixaEf({ ordem, operador, data, hora, obs }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return
    }

    if (!hasActiveSession(ordem)) {
      alert('Esta ordem está sem sessão ativa. Regularize iniciando a produção novamente antes de registrar baixa eficiência.')
      return
    }

    const { error } = await supabase.rpc('production_enter_low_efficiency_v3', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_started_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_reason: null,
      p_notes: obs || null,
    })

    if (error) {
      alert('Erro ao registrar baixa eficiência: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  async function confirmarEncerrarBaixaEf({ ordem, targetStatus, data, hora }) {
    if (!data || !hora) {
      alert('Preencha data e hora.')
      return
    }

    const { error } = await supabase.rpc('production_exit_low_efficiency', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_ended_at: localDateTimeToISO(data, hora),
      p_actor: null,
      p_target_status: targetStatus || 'PRODUZINDO',
    })

    if (error) {
      alert('Erro ao encerrar baixa eficiência: ' + error.message)
      return
    }

    await fetchRuntimeSnapshot()
  }

  const onStatusChange = async (ordem, targetStatus) => {
    const atual = ordem.status
    const currentStatus = String(atual || '').toUpperCase()
    const activeSession = hasActiveSession(ordem)

    if (targetStatus === 'AGUARDANDO' && currentStatus !== 'AGUARDANDO') {
      return { action: 'alert', message: 'Após iniciar a produção, não é permitido voltar para "Aguardando".' }
    }

    if (!activeSession && currentStatus !== 'AGUARDANDO') {
      return {
        action: 'alert',
        message: 'Esta ordem está marcada em operação, mas está sem sessão ativa. Use "Iniciar Produção" para regularizar antes de trocar para parada, retomada ou baixa eficiência.',
      }
    }

    if (targetStatus === 'BAIXA_EFICIENCIA' && atual !== 'BAIXA_EFICIENCIA') {
      const now = new Date()
      return {
        action: 'openLowEffModal',
        payload: {
          ordem,
          operador: '',
          obs: '',
          data: now.toISOString().slice(0, 10),
          hora: now.toTimeString().slice(0, 5),
        },
      }
    }

    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PRODUZINDO') {
      const now = new Date()
      return {
        action: 'openLowEffEndModal',
        payload: {
          ordem,
          targetStatus: 'PRODUZINDO',
          operador: '',
          data: now.toISOString().slice(0, 10),
          hora: now.toTimeString().slice(0, 5),
        },
      }
    }

    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PARADA') {
      const now = new Date()
      return {
        action: 'openStopModal',
        payload: {
          ordem,
          operador: '',
          motivo: MOTIVOS_PARADA[0],
          obs: '',
          data: now.toISOString().slice(0, 10),
          hora: now.toTimeString().slice(0, 5),
        },
      }
    }

    if (targetStatus === 'PARADA' && atual !== 'PARADA') {
      const now = new Date()
      return {
        action: 'openStopModal',
        payload: {
          ordem,
          operador: '',
          motivo: MOTIVOS_PARADA[0],
          obs: '',
          data: now.toISOString().slice(0, 10),
          hora: now.toTimeString().slice(0, 5),
        },
      }
    }

    if (atual === 'PARADA' && targetStatus !== 'PARADA') {
      const now = new Date()
      return {
        action: 'openResumeModal',
        payload: {
          ordem,
          operador: '',
          data: now.toISOString().slice(0, 10),
          hora: now.toTimeString().slice(0, 5),
          targetStatus,
        },
      }
    }

    return { action: 'statusSet', newStatus: targetStatus }
  }

  return {
    ordens,
    finalizadas,
    paradas,
    sessions,
    lowEffLogs,
    fetchOrdensAbertas,
    fetchOrdensFinalizadas,
    fetchParadas,
    criarOrdem,
    atualizar,
    enviarParaFila,
    finalizar,
    confirmarInicio,
    confirmarParada,
    confirmarRetomada,
    confirmarBaixaEf,
    confirmarEncerrarBaixaEf,
    ativosPorMaquina,
    registroGrupos,
    lastFinalizadoPorMaquina,
    onStatusChange,
  }
}