import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ensureAnonymousSession, SUPABASE_CACHE_SCOPE, supabase } from '../lib/supabaseClient'
import { MAQUINAS, MOTIVOS_PARADA } from '../lib/constants'
import { localDateTimeToISO } from '../lib/utils'
import { getScheduledStopWindowAt, SCHEDULED_STOP_REASON } from '../lib/shifts'
import {
  buildRegistroGroups,
  deriveRuntimeOrders,
  isMissingRelationError,
  mapLowEffLogsForUi,
  mapRuntimeOrder,
  mapScheduledStopsForUi,
  mapStopsForUi,
} from '../lib/productionRuntime'

const RUNTIME_VIEW_STORAGE_KEY = `production_runtime_view_availability:${SUPABASE_CACHE_SCOPE}`
const SCHEDULED_STOPS_TABLE_STORAGE_KEY = `scheduled_machine_stops_availability:${SUPABASE_CACHE_SCOPE}`
const SCHEDULED_STOPS_TABLE = 'scheduled_machine_stops'

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
let scheduledStopsTableAvailability = readCachedAvailability(SCHEDULED_STOPS_TABLE_STORAGE_KEY)

function countByOrderId(rows) {
  const counts = {}
  for (const row of rows || []) {
    const key = row?.order_id != null ? String(row.order_id) : null
    if (!key) continue
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function normalizeOptionalOrderField(value) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : null
}

const ORDERS_CACHE_KEY = `cached_production_orders_v1:${SUPABASE_CACHE_SCOPE}`;

function saveOrdersToCache(orders) {
  try {
    localStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(orders));
  } catch {
    return
  }
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

function mergeScheduledStopRows(...collections) {
  const map = new Map()
  for (const collection of collections) {
    for (const row of collection || []) {
      const key = String(row?.event_key || row?.id || '')
      if (!key) continue
      map.set(key, row)
    }
  }
  return Array.from(map.values())
}

function isPinnedToPanel(order) {
  const status = String(order?.status || '').trim().toUpperCase()
  const underlyingStatus = String(order?.underlying_status || '').trim().toUpperCase()

  return Boolean(
    (status && status !== 'AGUARDANDO')
    || (underlyingStatus && underlyingStatus !== 'AGUARDANDO')
    || String(order?.active_session_id || '').trim()
    || order?.scheduled_stop_active
  )
}

function compareMachineOrderPriority(left, right) {
  const leftPinned = isPinnedToPanel(left) ? 1 : 0
  const rightPinned = isPinnedToPanel(right) ? 1 : 0
  if (leftPinned !== rightPinned) return rightPinned - leftPinned

  const leftPos = Number.isFinite(Number(left?.pos)) ? Number(left.pos) : 999999
  const rightPos = Number.isFinite(Number(right?.pos)) ? Number(right.pos) : 999999
  if (leftPos !== rightPos) return leftPos - rightPos

  const leftCreatedAt = Date.parse(left?.created_at || '') || 0
  const rightCreatedAt = Date.parse(right?.created_at || '') || 0
  return leftCreatedAt - rightCreatedAt
}

function getScheduledStopValidationMessage() {
  return 'Máquina em parada programada no horário do Brasil. A produção só pode operar de segunda a sexta entre 05:00 e 22:00, e no sábado entre 05:00 e 13:00.'
}

function isScheduledStopRowActiveNow(stop, nowIso = new Date().toISOString()) {
  if (!stop || stop?.ended_at) return false

  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(nowMs)) return false

  const startedAtMs = Date.parse(stop?.started_at || '')
  const expectedEndAtMs = Date.parse(stop?.expected_end_at || '')

  if (Number.isFinite(startedAtMs) && startedAtMs > nowMs) return false
  if (Number.isFinite(expectedEndAtMs) && expectedEndAtMs <= nowMs) return false

  return !!getScheduledStopWindowAt(nowIso)
}

function applyPersistedScheduledStopsToOrders(orders, scheduledStops) {
  const openScheduledStopsByOrderId = new Map()
  const nowIso = new Date().toISOString()

  for (const stop of scheduledStops || []) {
    if (!isScheduledStopRowActiveNow(stop, nowIso)) continue
    const orderKey = stop?.order_id != null ? String(stop.order_id).trim() : ''
    if (!orderKey) continue

    const existing = openScheduledStopsByOrderId.get(orderKey)
    const existingStartedAt = Date.parse(existing?.started_at || '') || 0
    const candidateStartedAt = Date.parse(stop?.started_at || '') || 0
    if (!existing || candidateStartedAt >= existingStartedAt) {
      openScheduledStopsByOrderId.set(orderKey, stop)
    }
  }

  return (orders || []).map((order) => {
    const orderKey = order?.source_order_id != null
      ? String(order.source_order_id)
      : (order?.id != null ? String(order.id) : '')
    const scheduledStop = openScheduledStopsByOrderId.get(orderKey)
    if (!scheduledStop || order?.finalized) return order

    return {
      ...order,
      underlying_status: order?.underlying_status || order?.status || null,
      underlying_reason: order?.underlying_reason || order?.reason || null,
      status: 'PARADA',
      reason: scheduledStop.reason || SCHEDULED_STOP_REASON,
      scheduled_stop_active: true,
      scheduled_stop_reason: scheduledStop.reason || SCHEDULED_STOP_REASON,
      scheduled_stop_started_at: scheduledStop.started_at || null,
      scheduled_stop_ends_at: scheduledStop.expected_end_at || scheduledStop.ended_at || null,
    }
  })
}

export default function useOrders() {
  const [ordens, setOrdens] = useState(() => loadOrdersFromCache())
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([])
  const [scheduledStops, setScheduledStops] = useState([])
  const [sessions, setSessions] = useState([])
  const [lowEffLogs, setLowEffLogs] = useState([])
  const [scheduledStopsTableState, setScheduledStopsTableState] = useState(() => scheduledStopsTableAvailability)
  const runtimeFallbackWarnedRef = useRef(false)
  const runtimeErrorFallbackWarnedRef = useRef(false)
  const sessionsFallbackWarnedRef = useRef(false)
  const scheduledStopsFallbackWarnedRef = useRef(false)
  const runtimeRefreshPromiseRef = useRef(null)
  const runtimeRefreshQueuedRef = useRef(false)

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

    if (scheduledStopsTableAvailability === 'unknown') {
      const scheduledProbeRes = await supabase
        .from(SCHEDULED_STOPS_TABLE)
        .select('event_key')
        .limit(1)

      if (isMissingRelationError(scheduledProbeRes.error, SCHEDULED_STOPS_TABLE)) {
        scheduledStopsTableAvailability = 'missing'
        writeCachedAvailability(SCHEDULED_STOPS_TABLE_STORAGE_KEY, 'missing')
        setScheduledStopsTableState('missing')
      } else if (!scheduledProbeRes.error) {
        scheduledStopsTableAvailability = 'available'
        writeCachedAvailability(SCHEDULED_STOPS_TABLE_STORAGE_KEY, 'available')
        setScheduledStopsTableState('available')
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

    const runtimeOpenRows = openRes?.data || []
    const runtimeFinalizedRows = finalizedRes?.data || []
    let baseSnapshot = null
    let baseOpenRows = []
    let baseFinalizedRows = []

    if (shouldDeriveRuntime || (!runtimeViewMissing && !runtimeViewErrored && runtimeOpenRows.length === 0)) {
      baseSnapshot = await fetchOrdersBaseSnapshot()
      baseOpenRows = baseSnapshot?.openRes?.data || []
      baseFinalizedRows = baseSnapshot?.finalizedRes?.data || []
    }

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

    const scheduledStopSelectFields = 'event_key, machine_id, order_id, reason, notes, started_at, expected_end_at, ended_at, started_by, ended_by, created_at, updated_at'
    const [rawSessionsRes, stopsRes, lowEffRes, scheduledStopsByOrderRes, openScheduledStopsRes] = await Promise.all([
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
            .select('id, order_id, machine_id, session_id, started_at, resumed_at, reason, notes')
            .in('order_id', relevantIds)
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      relevantIds.length
        ? supabase
            .from('low_efficiency_logs')
            .select('id, order_id, machine_id, session_id, started_at, ended_at, reason, notes')
            .in('order_id', relevantIds)
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      scheduledStopsTableAvailability === 'available' && relevantIds.length
        ? supabase
            .from(SCHEDULED_STOPS_TABLE)
            .select(scheduledStopSelectFields)
            .in('order_id', relevantIds.map((value) => String(value)))
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      scheduledStopsTableAvailability === 'available'
        ? supabase
            .from(SCHEDULED_STOPS_TABLE)
            .select(scheduledStopSelectFields)
            .is('ended_at', null)
            .order('started_at', { ascending: false })
            .limit(100)
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
    if (isMissingRelationError(scheduledStopsByOrderRes.error, SCHEDULED_STOPS_TABLE)
      || isMissingRelationError(openScheduledStopsRes.error, SCHEDULED_STOPS_TABLE)) {
      scheduledStopsTableAvailability = 'missing'
      writeCachedAvailability(SCHEDULED_STOPS_TABLE_STORAGE_KEY, 'missing')
      setScheduledStopsTableState('missing')
      if (!scheduledStopsFallbackWarnedRef.current) {
        console.warn('Tabela scheduled_machine_stops não encontrada no Supabase. O histórico de parada programada ficará apenas em memória até a tabela ser criada.')
        scheduledStopsFallbackWarnedRef.current = true
      }
    } else if (!scheduledStopsByOrderRes.error && !openScheduledStopsRes.error && scheduledStopsTableAvailability !== 'missing') {
      scheduledStopsTableAvailability = 'available'
      writeCachedAvailability(SCHEDULED_STOPS_TABLE_STORAGE_KEY, 'available')
      setScheduledStopsTableState('available')
    }

    if (scheduledStopsByOrderRes.error && !isMissingRelationError(scheduledStopsByOrderRes.error, SCHEDULED_STOPS_TABLE)) {
      console.warn('Falha ao carregar histórico persistido de parada programada:', scheduledStopsByOrderRes.error)
    }
    if (openScheduledStopsRes.error && !isMissingRelationError(openScheduledStopsRes.error, SCHEDULED_STOPS_TABLE)) {
      console.warn('Falha ao carregar paradas programadas em aberto:', openScheduledStopsRes.error)
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
    setScheduledStops(mapScheduledStopsForUi(mergeScheduledStopRows(scheduledStopsByOrderRes.data || [], openScheduledStopsRes.data || [])))
    setLowEffLogs(mapLowEffLogsForUi(lowEffRes.data || []))
  }, [fetchOrdersBaseSnapshot, fetchScanCounts])

  const scheduleRuntimeRefresh = useCallback(() => {
    if (runtimeRefreshPromiseRef.current) {
      runtimeRefreshQueuedRef.current = true
      return runtimeRefreshPromiseRef.current
    }

    const refreshPromise = fetchRuntimeSnapshot()
      .catch((error) => {
        console.warn('Falha ao atualizar runtime em segundo plano:', error)
      })
      .finally(() => {
        runtimeRefreshPromiseRef.current = null
        if (runtimeRefreshQueuedRef.current) {
          runtimeRefreshQueuedRef.current = false
          scheduleRuntimeRefresh()
        }
      })

    runtimeRefreshPromiseRef.current = refreshPromise
    return refreshPromise
  }, [fetchRuntimeSnapshot])

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
    const cached = loadOrdersFromCache();
    if (cached.length > 0) {
      setOrdens(cached)
    }

    fetchRuntimeSnapshot().catch(() => {
      if (cached.length > 0) setOrdens(cached)
    })

    const trackedTables = ['orders', 'order_machine_sessions', 'machine_stops', 'low_efficiency_logs']
    if (scheduledStopsTableState === 'available') trackedTables.push(SCHEDULED_STOPS_TABLE)
    const channels = trackedTables.map((tableName) => (
      supabase
        .channel(`production-runtime-${tableName}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, () => {
          scheduleRuntimeRefresh()
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
  }, [fetchRuntimeSnapshot, scheduleRuntimeRefresh, scheduledStopsTableState])

  const ativosPorMaquina = useMemo(() => {
    const ordensVisiveis = applyPersistedScheduledStopsToOrders(ordens, scheduledStops)
    const map = Object.fromEntries(MAQUINAS.map((machineId) => [machineId, []]))
    ordensVisiveis.forEach((order) => {
      if (!order?.finalized && map[order.machine_id]) {
        map[order.machine_id].push(order)
      }
    })
    for (const machineId of MAQUINAS) {
      map[machineId] = [...map[machineId]].sort(compareMachineOrderPriority)
    }
    return map
  }, [ordens, scheduledStops])

  const ordensVisiveis = useMemo(() => applyPersistedScheduledStopsToOrders(ordens, scheduledStops), [ordens, scheduledStops])

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

  const registroGrupos = useMemo(() => buildRegistroGroups([...ordensVisiveis, ...finalizadas], sessions, paradas, lowEffLogs, scheduledStops), [ordensVisiveis, finalizadas, sessions, paradas, lowEffLogs, scheduledStops])

  async function criarOrdem(form, setForm, setTab) {
    if (!form.code.trim()) return false

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
      return false
    }

    const nextPos = (last?.pos ?? -1) + 1
    const novo = {
      machine_id: form.machine_id,
      code: form.code,
      customer: form.customer,
      product: form.product,
      color: form.color,
      qty: form.qty,
      boxes: normalizeOptionalOrderField(form.boxes),
      standard: normalizeOptionalOrderField(form.standard),
      due_date: form.due_date || null,
      notes: form.notes,
      status: 'AGUARDANDO',
      pos: nextPos,
      finalized: false,
    }

    const { error } = await supabase.from('orders').insert([novo])
    if (error) {
      alert('Erro ao criar ordem: ' + error.message)
      return false
    }

    setForm({ code: '', customer: '', product: '', color: '', qty: '', boxes: '', standard: '', due_date: '', notes: '', machine_id: 'P1' })
    setTab('painel')
    void scheduleRuntimeRefresh()
    return true
  }

  async function atualizar(ordemParcial) {
    const before = ordens.find((order) => String(order.id) === String(ordemParcial.id))
      || finalizadas.find((order) => String(order.id) === String(ordemParcial.id))
    if (!before) return false

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
        return false
      }
    }

    const payload = {
      machine_id: ordemParcial.machine_id,
      code: ordemParcial.code,
      customer: ordemParcial.customer,
      product: ordemParcial.product,
      color: ordemParcial.color,
      qty: ordemParcial.qty,
      boxes: normalizeOptionalOrderField(ordemParcial.boxes),
      standard: normalizeOptionalOrderField(ordemParcial.standard),
      due_date: ordemParcial.due_date || null,
      notes: ordemParcial.notes,
      pos: ordemParcial.pos ?? null,
    }

    const { error } = await supabase.from('orders').update(payload).eq('id', ordemParcial.id)
    if (error) {
      alert('Erro ao atualizar: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function finalizar(ordem, payload) {
    const iso = localDateTimeToISO(payload.data, payload.hora)
    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_finalize_order', {
      p_order_id: String(ordem.id),
      p_finalized_at: iso,
      p_actor: payload.por,
    })

    if (error) {
      alert('Erro ao finalizar: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function enviarParaFila(ordemAtiva, opts) {
    const machineList = [...(ativosPorMaquina[ordemAtiva.machine_id] || [])].sort(compareMachineOrderPriority)

    const activeOrder = machineList[0]
    const promotedOrder = machineList[1]

    if (!activeOrder || !promotedOrder) {
      alert('Não há itens suficientes na fila para promover.')
      return false
    }

    const effectiveAt = opts?.data && opts?.hora
      ? localDateTimeToISO(opts.data, opts.hora)
      : new Date().toISOString()

    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_send_to_queue', {
      p_order_id: String(activeOrder.id),
      p_promoted_order_id: String(promotedOrder.id),
      p_effective_at: effectiveAt,
      p_actor: opts?.operador || null,
    })

    if (error) {
      alert('Erro ao enviar ordem para a fila: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function confirmarInicio({ ordem, operador, data, hora }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return false
    }

    if (getScheduledStopWindowAt(localDateTimeToISO(data, hora))) {
      alert(getScheduledStopValidationMessage())
      return false
    }

    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_start_order', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_started_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_machine_id: ordem.machine_id,
    })

    if (error) {
      alert('Erro ao iniciar: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function validarSobreposicaoParada({ machineId }) {
    const aberta = paradas.find((stop) => stop.machine_id === machineId && !stop.ended_at)
    if (aberta) {
      return 'Já existe uma parada aberta nesta máquina. Encerre antes de registrar outra.'
    }
    return null
  }

  async function confirmarParada({ ordem, operador, motivo, obs, data, hora, skipValidation = false }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return false
    }
    if (!String(motivo || '').trim()) {
      alert('Selecione o motivo da parada.')
      return false
    }

    if (!skipValidation && !hasActiveSession(ordem)) {
      alert('Esta ordem está sem sessão ativa. Regularize iniciando a produção novamente antes de registrar a parada.')
      return false
    }

    const overlapMsg = skipValidation ? null : await validarSobreposicaoParada({ machineId: ordem.machine_id })
    if (overlapMsg) {
      alert(overlapMsg)
      return false
    }

    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_stop_order', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_started_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_reason: String(motivo).trim(),
      p_notes: obs || null,
    })

    if (error) {
      alert('Erro ao registrar parada: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function confirmarRetomada({ ordem, operador, data, hora, targetStatus, skipValidation = false }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return false
    }

    if (getScheduledStopWindowAt(localDateTimeToISO(data, hora))) {
      alert(getScheduledStopValidationMessage())
      return false
    }

    if (!skipValidation && !hasActiveSession(ordem)) {
      alert('Esta ordem está sem sessão ativa. Regularize iniciando a produção novamente antes de retomar.')
      return false
    }

    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_resume_order', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_resumed_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_target_status: targetStatus || 'PRODUZINDO',
    })

    if (error) {
      alert('Erro ao retomar produção: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function confirmarBaixaEf({ ordem, operador, data, hora, obs, skipValidation = false }) {
    if (!operador || !data || !hora) {
      alert('Preencha operador, data e hora.')
      return false
    }

    if (getScheduledStopWindowAt(localDateTimeToISO(data, hora))) {
      alert(getScheduledStopValidationMessage())
      return false
    }

    if (!skipValidation && !hasActiveSession(ordem)) {
      alert('Esta ordem está sem sessão ativa. Regularize iniciando a produção novamente antes de registrar baixa eficiência.')
      return false
    }

    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_enter_low_efficiency_v3', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_started_at: localDateTimeToISO(data, hora),
      p_actor: operador,
      p_reason: null,
      p_notes: obs || null,
    })

    if (error) {
      alert('Erro ao registrar baixa eficiência: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  async function confirmarEncerrarBaixaEf({ ordem, targetStatus, data, hora }) {
    if (!data || !hora) {
      alert('Preencha data e hora.')
      return false
    }

    await ensureAnonymousSession()
    const { error } = await supabase.rpc('production_exit_low_efficiency', {
      p_order_id: String(ordem.source_order_id || ordem.id),
      p_ended_at: localDateTimeToISO(data, hora),
      p_actor: null,
      p_target_status: targetStatus || 'PRODUZINDO',
    })

    if (error) {
      alert('Erro ao encerrar baixa eficiência: ' + error.message)
      return false
    }

    void scheduleRuntimeRefresh()
    return true
  }

  const onStatusChange = async (ordem, targetStatus, options = {}) => {
    const skipValidation = Boolean(options?.skipValidation)
    const atual = ordem.status
    const currentStatus = String(atual || '').toUpperCase()
    const activeSession = hasActiveSession(ordem)

    if (!skipValidation && ordem?.scheduled_stop_active && targetStatus !== 'PARADA') {
      return { action: 'alert', message: getScheduledStopValidationMessage() }
    }

    if (targetStatus === 'AGUARDANDO' && currentStatus !== 'AGUARDANDO') {
      return { action: 'alert', message: 'Após iniciar a produção, não é permitido voltar para "Aguardando".' }
    }

    if (!skipValidation && !activeSession && currentStatus !== 'AGUARDANDO') {
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
    ordens: ordensVisiveis,
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