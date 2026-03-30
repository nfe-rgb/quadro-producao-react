import React, { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { supabase } from '../lib/supabaseClient'
import { MAQUINAS } from '../lib/constants'
import { fmtDateTime, getTurnoAtual } from '../lib/utils'
import {
  calculateMachinePeriodMetrics,
  intersectIntervals,
  mapRecordsToIntervals,
  mergeIntervals,
  subtractIntervals,
  sumIntervals,
} from '../lib/productionIntervals'
import { ACTIVE_SHIFT_KEYS, getShiftLabel, getShiftWindowsInRange, normalizeShiftKey } from '../lib/shifts'
import GerenciamentoAvancado from './GerenciamentoAvancado'
import '../styles/Gestao.css'

const TYPE_OPTIONS = [
  { value: 'all', label: 'Tudo' },
  { value: 'order', label: 'O.S.' },
  { value: 'production', label: 'Produção' },
  { value: 'scrap', label: 'Refugo' },
  { value: 'stop', label: 'Paradas' },
]

const SHIFT_OPTIONS = [
  { value: 'all', label: 'Todos os turnos' },
  { value: '1', label: 'Turno 1' },
  { value: '2', label: 'Turno 2' },
]

const TYPE_LABELS = {
  order: 'O.S.',
  production: 'Produção',
  scrap: 'Refugo',
  stop: 'Parada',
}

const TYPE_BADGES = {
  order: 'is-order',
  production: 'is-production',
  scrap: 'is-scrap',
  stop: 'is-stop',
}

const DAILY_TARGET_VALUE = 35000
const DEFAULT_MONTHLY_VALUE_TARGET = 770000
const MONTHLY_VALUE_TARGETS = {
  '2026-03': 770000,
  '2026-04': 819000,
}
const DATA_PAGE_SIZE = 1000

function getTodayDate() {
  return DateTime.now().setZone('America/Sao_Paulo').toISODate()
}

function text(value) {
  return String(value ?? '').trim()
}

function lower(value) {
  return text(value).toLowerCase()
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(toNumber(value))
}

function formatCompactCurrency(value) {
  const numeric = toNumber(value)
  const abs = Math.abs(numeric)

  if (abs >= 1000000) {
    return `R$ ${(numeric / 1000000).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} mi`
  }

  if (abs >= 1000) {
    return `R$ ${(numeric / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil`
  }

  return `R$ ${numeric.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(toNumber(value))
}

function formatPieces(value) {
  return `${formatInteger(value)} pçs`
}

function formatWeightKg(value) {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(toNumber(value))} kg`
}

function formatPercent(value) {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(toNumber(value))}%`
}

function formatHours(value) {
  return `${toNumber(value).toFixed(1)} h`
}

function parsePiecesPerBox(value) {
  if (value == null) return 0
  const digitsOnly = String(value).replace(/[^0-9]/g, '')
  return digitsOnly ? Number.parseInt(digitsOnly, 10) : 0
}

function extractItemCodeFromOrderProduct(product) {
  const raw = text(product)
  if (!raw) return null
  return raw.split('-')[0]?.trim() || null
}

function getSectorByMachine(machineId) {
  const normalized = text(machineId).toUpperCase()
  if (normalized.startsWith('P')) return 'PET'
  if (normalized.startsWith('I')) return 'INJEÇÃO'
  return 'OUTROS'
}

function normalizeReason(value) {
  return lower(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function isCountedStopReason(reason) {
  return normalizeReason(reason) !== 'parada programada'
}

function getPiecesPerHour(itemMeta) {
  const cycleSeconds = toNumber(itemMeta?.cycleSeconds)
  const cavities = toNumber(itemMeta?.cavities)
  if (cycleSeconds <= 0 || cavities <= 0) return 0
  return (3600 / cycleSeconds) * cavities
}

function resolveShift(shift, timestamp) {
  const normalized = normalizeShiftKey(shift)
  if (normalized) return normalized
  return normalizeShiftKey(getTurnoAtual(timestamp || new Date().toISOString()))
}

function buildRange(startDate, endDate) {
  const zone = 'America/Sao_Paulo'
  const start = DateTime.fromISO(startDate || getTodayDate(), { zone }).startOf('day')
  const end = DateTime.fromISO(endDate || startDate || getTodayDate(), { zone }).endOf('day')
  if (!start.isValid || !end.isValid) {
    const today = DateTime.now().setZone(zone)
    return {
      start: today.startOf('day'),
      end: today.endOf('day'),
      startMs: today.startOf('day').toMillis(),
      endMs: today.endOf('day').toMillis(),
      startIso: today.startOf('day').toISO(),
      endIso: today.endOf('day').toISO(),
    }
  }
  const safeEnd = end < start ? start.endOf('day') : end
  return {
    start,
    end: safeEnd,
    startMs: start.toMillis(),
    endMs: safeEnd.toMillis(),
    startIso: start.toISO(),
    endIso: safeEnd.toISO(),
  }
}

function intersectsRange(startValue, endValue, rangeStartMs, rangeEndMs) {
  const startMs = startValue ? new Date(startValue).getTime() : null
  const endMs = endValue ? new Date(endValue).getTime() : null
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return false
  const safeStart = Number.isFinite(startMs) ? startMs : endMs
  const safeEnd = Number.isFinite(endMs) ? endMs : startMs
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) return false
  return safeStart <= rangeEndMs && safeEnd >= rangeStartMs
}

function clampDurationMs(startValue, endValue, rangeStartMs, rangeEndMs) {
  const startMs = startValue ? new Date(startValue).getTime() : null
  const rawEndMs = endValue ? new Date(endValue).getTime() : rangeEndMs
  if (!Number.isFinite(startMs) || !Number.isFinite(rawEndMs)) return 0
  const clampedStart = Math.max(startMs, rangeStartMs)
  const clampedEnd = Math.min(rawEndMs, rangeEndMs)
  return clampedEnd > clampedStart ? clampedEnd - clampedStart : 0
}

function buildBarPercent(value, max) {
  if (!max || max <= 0) return 0
  return Math.max(6, Math.round((toNumber(value) / max) * 100))
}

function extractIsoDatePrefix(value) {
  const raw = text(value)
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function getRecordDayKey(timestamp) {
  const rawDate = extractIsoDatePrefix(timestamp)
  if (rawDate) return rawDate

  const date = DateTime.fromISO(String(timestamp || ''), { setZone: true }).setZone('America/Sao_Paulo')
  return date.isValid ? date.toISODate() : null
}

async function fetchAllRowsInDateRange({
  table,
  columns,
  startIso,
  endIso,
  pageSize = DATA_PAGE_SIZE,
}) {
  const rows = []
  let pageIndex = 0

  while (true) {
    const from = pageIndex * pageSize
    const to = from + pageSize - 1

    const response = await supabase
      .from(table)
      .select(columns)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (response.error) return response

    const chunk = response.data || []
    rows.push(...chunk)

    if (chunk.length < pageSize) {
      return { data: rows, error: null }
    }

    pageIndex += 1
  }
}

function DashboardBarChart({ title, rows, selectedValue, onSelect, valueFormatter, subtitle }) {
  const maxValue = Math.max(...rows.map((row) => toNumber(row.value)), 0)
  const isInteractive = typeof onSelect === 'function'

  return (
    <div className="gestao-panel gestao-chart-panel">
      <div className="gestao-panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {isInteractive && selectedValue && selectedValue !== 'all' ? (
          <button type="button" className="btn" onClick={() => onSelect('all')}>
            Limpar
          </button>
        ) : null}
      </div>

      {rows.length ? (
        <div className="gestao-chart-list">
          {rows.map((row) => {
            const active = String(selectedValue) === String(row.key)
            const className = `gestao-chart-row ${active ? 'is-active' : ''} ${isInteractive ? 'is-interactive' : 'is-static'}`

            const content = (
              <>
                <div className="gestao-chart-copy">
                  <strong>{row.label}</strong>
                  <span>{valueFormatter(row.value)}</span>
                </div>
                <div className="gestao-chart-track">
                  <div className="gestao-chart-bar" style={{ width: `${buildBarPercent(row.value, maxValue)}%` }} />
                </div>
              </>
            )

            if (!isInteractive) {
              return (
                <div key={row.key} className={className}>
                  {content}
                </div>
              )
            }

            return (
              <button
                key={row.key}
                type="button"
                className={className}
                onClick={() => onSelect(active ? 'all' : row.key)}
              >
                {content}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="gestao-empty">Sem dados para este recorte.</div>
      )}
    </div>
  )
}

function DashboardDailyColumnChart({ title, rows, valueFormatter, subtitle, selectedValue, onSelect, targetStatus }) {
  const maxValue = Math.max(...rows.map((row) => toNumber(row.value)), 0)
  const chartMax = Math.max(maxValue, DAILY_TARGET_VALUE)
  const targetPercent = chartMax > 0 ? (DAILY_TARGET_VALUE / chartMax) * 100 : 0
  const targetLineBottom = 42 + (targetPercent / 100) * 220
  const isInteractive = typeof onSelect === 'function'
  const scaleSteps = [1, 0.75, 0.5, 0.25, 0]

  return (
    <div className="gestao-panel gestao-chart-panel is-wide">
      <div className="gestao-panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="gestao-chart-head-side">
          {targetStatus ? (
            <div className={`gestao-target-card is-${targetStatus.tone}`}>
              <span>{targetStatus.label}</span>
              <strong>{targetStatus.value}</strong>
              <small>{targetStatus.meta}</small>
              <small>{targetStatus.produced}</small>
            </div>
          ) : null}
          {isInteractive && selectedValue && selectedValue !== 'all' ? (
            <button type="button" className="btn" onClick={() => onSelect('all')}>
              Limpar dia
            </button>
          ) : null}
        </div>
      </div>

      {rows.length ? (
        <div className="gestao-column-chart-wrap">
          <div className="gestao-column-chart-shell">
            <div className="gestao-column-scale" aria-hidden="true">
              {scaleSteps.map((step) => (
                <span key={step}>{chartMax > 0 ? formatCompactCurrency(chartMax * step) : 'R$ 0'}</span>
              ))}
            </div>

            <div className="gestao-column-chart-area">
              <div className="gestao-column-target-line" style={{ bottom: `${targetLineBottom}px` }} aria-hidden="true">
                <span>Meta diária {formatCompactCurrency(DAILY_TARGET_VALUE)}</span>
              </div>

              <div
                className="gestao-column-chart"
                style={{ gridTemplateColumns: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))` }}
              >
                {rows.map((row) => {
                  const height = chartMax > 0 ? Math.max(8, Math.round((toNumber(row.value) / chartMax) * 100)) : 0
                  const hasValue = toNumber(row.value) > 0
                  const active = String(selectedValue) === String(row.key)
                  const className = `gestao-column-item ${row.isPeak ? 'is-peak' : ''} ${active ? 'is-active' : ''} ${isInteractive ? 'is-interactive' : ''}`
                  const content = (
                    <>
                      <div className="gestao-column-track" style={{ '--column-height': `${height}%` }}>
                        <div className="gestao-column-tooltip" role="tooltip">
                          <strong>{row.fullLabel}</strong>
                          <span>{valueFormatter(row.value)}</span>
                        </div>
                        <div
                          className={`gestao-column-bar ${hasValue ? '' : 'is-empty'}`}
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <span className="gestao-column-label">{row.label}</span>
                      <span className="gestao-column-sublabel">{row.weekday}</span>
                    </>
                  )

                  if (!isInteractive) {
                    return (
                      <div
                        key={row.key}
                        className={className}
                        title={`${row.fullLabel}: ${valueFormatter(row.value)}`}
                      >
                        {content}
                      </div>
                    )
                  }

                  return (
                    <button
                      key={row.key}
                      type="button"
                      className={className}
                      title={`${row.fullLabel}: ${valueFormatter(row.value)}`}
                      onClick={() => onSelect(active ? 'all' : row.key)}
                    >
                      {content}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="gestao-empty">Sem dados para este recorte.</div>
      )}
    </div>
  )
}

function StatCard({ label, value, hint, tone = 'default' }) {
  return (
    <div className={`gestao-stat-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {Array.isArray(hint)
        ? hint.filter(Boolean).map((line) => <small key={line}>{line}</small>)
        : hint ? <small>{hint}</small> : null}
    </div>
  )
}

export default function Gestao({ registroGrupos = [], openSet, toggleOpen, isAdmin = false }) {
  const [startDate, setStartDate] = useState(getTodayDate)
  const [endDate, setEndDate] = useState(getTodayDate)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [machineFilter, setMachineFilter] = useState('all')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [selectedDay, setSelectedDay] = useState('all')
  const [selectedStopReason, setSelectedStopReason] = useState('all')
  const [selectedScrapReason, setSelectedScrapReason] = useState('all')
  const [showAdmin, setShowAdmin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [scans, setScans] = useState([])
  const [scraps, setScraps] = useState([])
  const [entries, setEntries] = useState([])
  const [monthlyProducedValue, setMonthlyProducedValue] = useState(0)
  const [localOpenSet, setLocalOpenSet] = useState(() => new Set())
  const [isRecordsExpanded, setIsRecordsExpanded] = useState(true)

  const effectiveOpenSet = openSet ?? localOpenSet

  function handleToggle(recordId) {
    if (toggleOpen) {
      toggleOpen(recordId)
      return
    }
    setLocalOpenSet((previous) => {
      const next = new Set(previous)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const range = useMemo(() => buildRange(startDate, endDate), [startDate, endDate])

  useEffect(() => {
    let active = true

    async function loadSupportData() {
      const { data, error: loadError } = await supabase
        .from('items')
        .select('code, unit_value, part_weight_g, cycle_seconds, cavities')
        .limit(5000)

      if (!active) return
      if (loadError) {
        console.warn('Gestão: falha ao buscar itens para valorização:', loadError)
        return
      }
      setItems(data || [])
    }

    loadSupportData()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadOperationalData() {
      setLoading(true)
      setError('')

      const [scansRes, scrapsRes, entriesRes] = await Promise.all([
        fetchAllRowsInDateRange({
          table: 'production_scans',
          columns: 'id, created_at, order_id, op_code, machine_id, shift, scanned_box, qty_pieces, code',
          startIso: range.startIso,
          endIso: range.endIso,
        }),
        fetchAllRowsInDateRange({
          table: 'scrap_logs',
          columns: 'id, created_at, order_id, op_code, machine_id, shift, operator, qty, reason',
          startIso: range.startIso,
          endIso: range.endIso,
        }),
        fetchAllRowsInDateRange({
          table: 'injection_production_entries',
          columns: 'id, created_at, entry_date, order_id, order_code, machine_id, shift, product, good_qty',
          startIso: range.startIso,
          endIso: range.endIso,
        }),
      ])

      if (!active) return

      const firstError = scansRes.error || scrapsRes.error || entriesRes.error || null
      if (firstError) {
        setError(String(firstError.message || 'Falha ao carregar dados da gestão.'))
      }

      setScans(scansRes.data || [])
      setScraps(scrapsRes.data || [])
      setEntries(entriesRes.data || [])
      setLoading(false)
    }

    loadOperationalData()
    return () => {
      active = false
    }
  }, [range.endIso, range.startIso])

  const itemsMap = useMemo(() => {
    const map = {}
    for (const item of items || []) {
      const key = text(item?.code)
      if (!key) continue
      map[key] = {
        unitValue: toNumber(item?.unit_value),
        partWeightKg: toNumber(item?.part_weight_g) / 1000,
        cycleSeconds: toNumber(item?.cycle_seconds),
        cavities: toNumber(item?.cavities),
      }
    }
    return map
  }, [items])

  const monthlyReference = useMemo(() => {
    const zone = 'America/Sao_Paulo'
    const reference = selectedDay !== 'all'
      ? DateTime.fromISO(selectedDay, { zone })
      : DateTime.fromISO(endDate || startDate || getTodayDate(), { zone })

    const safeReference = reference.isValid ? reference : DateTime.now().setZone(zone)

    return {
      key: safeReference.toFormat('yyyy-LL'),
      startIso: safeReference.startOf('month').toISO(),
      endIso: safeReference.endOf('month').toISO(),
      label: safeReference.setLocale('pt-BR').toFormat('LLLL/yyyy'),
    }
  }, [endDate, selectedDay, startDate])

  const monthlyValueTarget = useMemo(() => {
    return MONTHLY_VALUE_TARGETS[monthlyReference.key] || DEFAULT_MONTHLY_VALUE_TARGET
  }, [monthlyReference.key])

  useEffect(() => {
    let active = true

    async function loadMonthlyProducedValue() {
      const [monthScansRes, monthEntriesRes] = await Promise.all([
        fetchAllRowsInDateRange({
          table: 'production_scans',
          columns: 'id, created_at, order_id, machine_id, shift, qty_pieces, code',
          startIso: monthlyReference.startIso,
          endIso: monthlyReference.endIso,
        }),
        fetchAllRowsInDateRange({
          table: 'injection_production_entries',
          columns: 'id, created_at, order_id, machine_id, shift, product, good_qty',
          startIso: monthlyReference.startIso,
          endIso: monthlyReference.endIso,
        }),
      ])

      if (!active) return

      if (monthScansRes.error) {
        console.warn('Gestão: falha ao buscar scans do mês para a meta:', monthScansRes.error)
      }
      if (monthEntriesRes.error) {
        console.warn('Gestão: falha ao buscar apontamentos do mês para a meta:', monthEntriesRes.error)
      }

      const monthScans = monthScansRes.data || []
      const monthEntries = monthEntriesRes.data || []

      const orderIds = Array.from(new Set([
        ...monthScans.map((row) => text(row?.order_id)).filter(Boolean),
        ...monthEntries.map((row) => text(row?.order_id)).filter(Boolean),
      ]))

      let monthOrdersMap = {}
      if (orderIds.length) {
        const { data: monthOrdersData, error: monthOrdersError } = await supabase
          .from('orders')
          .select('id, product, standard')
          .in('id', orderIds)

        if (!active) return

        if (monthOrdersError) {
          console.warn('Gestão: falha ao buscar ordens do mês para a meta:', monthOrdersError)
        } else {
          monthOrdersMap = Object.fromEntries((monthOrdersData || []).map((order) => [text(order?.id), order]))
        }
      }

      let nextMonthlyProducedValue = 0

      for (const row of monthScans) {
        const sourceOrderId = text(row?.order_id)
        const productCode = extractItemCodeFromOrderProduct(monthOrdersMap[sourceOrderId]?.product)
        const code = text(productCode || row?.code)
        const pieces = toNumber(row?.qty_pieces) || parsePiecesPerBox(monthOrdersMap[sourceOrderId]?.standard)
        const unitValue = toNumber(itemsMap[code]?.unitValue)
        nextMonthlyProducedValue += pieces * unitValue
      }

      for (const row of monthEntries) {
        const sourceOrderId = text(row?.order_id)
        const code = extractItemCodeFromOrderProduct(row?.product || monthOrdersMap[sourceOrderId]?.product)
        const pieces = toNumber(row?.good_qty)
        const unitValue = toNumber(itemsMap[code]?.unitValue)
        nextMonthlyProducedValue += pieces * unitValue
      }

      setMonthlyProducedValue(nextMonthlyProducedValue)
    }

    loadMonthlyProducedValue()
    return () => {
      active = false
    }
  }, [itemsMap, monthlyReference.endIso, monthlyReference.startIso])

  const orderGroupsInRange = useMemo(() => {
    return (registroGrupos || []).filter((group) => {
      const order = group?.ordem || {}
      const eventMatches = [
        [order.started_at, order.finalized_at || order.interrupted_at || order.started_at],
        [order.restarted_at, order.finalized_at || order.interrupted_at || order.restarted_at],
        [order.created_at, order.created_at],
      ].some(([start, end]) => intersectsRange(start, end, range.startMs, range.endMs))

      if (eventMatches) return true
      if ((group?.stops || []).some((stop) => intersectsRange(stop.started_at, stop.resumed_at || stop.ended_at || range.endIso, range.startMs, range.endMs))) return true
      if ((group?.lowEffLogs || []).some((log) => intersectsRange(log.started_at, log.ended_at || range.endIso, range.startMs, range.endMs))) return true
      return false
    })
  }, [range.endIso, range.endMs, range.startMs, registroGrupos])

  const orderById = useMemo(() => {
    const map = {}
    for (const group of registroGrupos || []) {
      const sourceId = text(group?.orderId || group?.ordem?.source_order_id || group?.ordem?.id)
      if (!sourceId) continue
      map[sourceId] = group
    }
    return map
  }, [registroGrupos])

  const machinesForSector = useMemo(() => {
    if (sectorFilter === 'PET') return MAQUINAS.filter((machineId) => getSectorByMachine(machineId) === 'PET')
    if (sectorFilter === 'INJEÇÃO') return MAQUINAS.filter((machineId) => getSectorByMachine(machineId) === 'INJEÇÃO')
    if (sectorFilter === 'OUTROS') return MAQUINAS.filter((machineId) => getSectorByMachine(machineId) === 'OUTROS')
    return MAQUINAS
  }, [sectorFilter])

  const availableMachines = useMemo(() => {
    return machinesForSector.filter((machineId) => {
      if (machineFilter !== 'all') return machineId === machineFilter
      return true
    })
  }, [machineFilter, machinesForSector])

  const filteredGroupsForMetrics = useMemo(() => {
    return orderGroupsInRange.filter((group) => {
      const machineId = text(group?.ordem?.machine_id)
      if (!machineId) return false
      if (!availableMachines.includes(machineId)) return false
      return true
    })
  }, [availableMachines, orderGroupsInRange])

  const groupsByMachine = useMemo(() => {
    const map = {}
    for (const machineId of availableMachines) map[machineId] = []
    for (const group of filteredGroupsForMetrics) {
      const machineId = text(group?.ordem?.machine_id)
      if (!machineId) continue
      if (!map[machineId]) map[machineId] = []
      map[machineId].push(group)
    }
    return map
  }, [availableMachines, filteredGroupsForMetrics])

  const occupancyMetrics = useMemo(() => {
    return calculateMachinePeriodMetrics({
      groupsByMachine,
      filterStart: range.start.toJSDate(),
      filterEnd: range.end.toJSDate(),
      machines: availableMachines,
    })
  }, [availableMachines, groupsByMachine, range.end, range.start])

  const orderRecords = useMemo(() => {
    return orderGroupsInRange.map((group) => {
      const order = group?.ordem || {}
      const sourceOrderId = text(group?.orderId || order?.source_order_id || order?.id)
      const machineId = text(order.machine_id)
      const sector = getSectorByMachine(machineId)
      const timestamp = order.finalized_at || order.interrupted_at || order.restarted_at || order.started_at || order.created_at || null
      const shift = resolveShift(null, order.started_at || timestamp)
      return {
        id: `order:${group.id}`,
        type: 'order',
        timestamp,
        orderId: sourceOrderId,
        code: text(order.code),
        product: text(order.product),
        customer: text(order.customer),
        machineId,
        sector,
        shift,
        value: 0,
        quantity: toNumber(order.qty),
        status: text(order.status) || 'Sem status',
        subtitle: `${machineId || 'Sem máquina'} • ${text(order.customer) || 'Sem cliente'}`,
        details: [
          `Produto: ${text(order.product) || 'Sem produto'}`,
          `Status: ${text(order.status) || 'Sem status'}`,
        ],
      }
    })
  }, [orderGroupsInRange])

  const productionRecords = useMemo(() => {
    const scanRows = (scans || []).map((row) => {
      const sourceOrderId = text(row?.order_id)
      const order = sourceOrderId ? orderById[sourceOrderId]?.ordem : null
      const machineId = text(row?.machine_id || order?.machine_id)
      const sector = getSectorByMachine(machineId)
      const productCode = extractItemCodeFromOrderProduct(order?.product)
      const code = text(productCode || row?.code)
      const pieces = toNumber(row?.qty_pieces) || parsePiecesPerBox(order?.standard)
      const unitValue = toNumber(itemsMap[code]?.unitValue)
      const partWeightKg = toNumber(itemsMap[code]?.partWeightKg)
      const shift = resolveShift(row?.shift, row?.created_at)
      return {
        id: `scan:${row.id}`,
        type: 'production',
        source: 'scan',
        timestamp: row?.created_at || null,
        dayKey: getRecordDayKey(row?.created_at),
        orderId: sourceOrderId,
        code: text(order?.code || row?.op_code),
        product: text(order?.product || code),
        customer: text(order?.customer),
        machineId,
        sector,
        shift,
        value: pieces * unitValue,
        quantity: pieces,
        weightKg: pieces * partWeightKg,
        status: 'Bipagem',
        subtitle: `Caixa ${text(row?.scanned_box) || '-'} • ${machineId || 'Sem máquina'}`,
        details: [
          `Valor unitário: ${formatCurrency(unitValue)}`,
          `Peças: ${formatInteger(pieces)}`,
        ],
      }
    })

    const entryRows = (entries || []).map((row) => {
      const sourceOrderId = text(row?.order_id)
      const order = sourceOrderId ? orderById[sourceOrderId]?.ordem : null
      const machineId = text(row?.machine_id || order?.machine_id)
      const sector = getSectorByMachine(machineId)
      const code = extractItemCodeFromOrderProduct(row?.product || order?.product)
      const pieces = toNumber(row?.good_qty)
      const unitValue = toNumber(itemsMap[code]?.unitValue)
      const partWeightKg = toNumber(itemsMap[code]?.partWeightKg)
      const shift = resolveShift(row?.shift, row?.created_at || row?.entry_date)
      return {
        id: `entry:${row.id}`,
        type: 'production',
        source: 'entry',
        timestamp: row?.created_at || row?.entry_date || null,
        dayKey: text(row?.entry_date) || getRecordDayKey(row?.created_at),
        orderId: sourceOrderId,
        code: text(row?.order_code || order?.code),
        product: text(row?.product || order?.product),
        customer: text(order?.customer),
        machineId,
        sector,
        shift,
        value: pieces * unitValue,
        quantity: pieces,
        weightKg: pieces * partWeightKg,
        status: 'Apontamento manual',
        subtitle: `${machineId || 'Sem máquina'} • ${getShiftLabel(shift)}`,
        details: [
          `Valor unitário: ${formatCurrency(unitValue)}`,
          `Peças boas: ${formatInteger(pieces)}`,
        ],
      }
    })

    return [...scanRows, ...entryRows]
  }, [entries, itemsMap, orderById, scans])

  const scrapRecords = useMemo(() => {
    return (scraps || []).map((row) => {
      const sourceOrderId = text(row?.order_id)
      const order = sourceOrderId ? orderById[sourceOrderId]?.ordem : null
      const machineId = text(row?.machine_id || order?.machine_id)
      const sector = getSectorByMachine(machineId)
      const code = extractItemCodeFromOrderProduct(order?.product)
      const qty = toNumber(row?.qty)
      const unitValue = toNumber(itemsMap[code]?.unitValue)
      const partWeightKg = toNumber(itemsMap[code]?.partWeightKg)
      const shift = resolveShift(row?.shift, row?.created_at)
      return {
        id: `scrap:${row.id}`,
        type: 'scrap',
        timestamp: row?.created_at || null,
        orderId: sourceOrderId,
        code: text(order?.code || row?.op_code),
        product: text(order?.product),
        customer: text(order?.customer),
        machineId,
        sector,
        shift,
        value: qty * unitValue,
        quantity: qty,
        weightKg: qty * partWeightKg,
        status: text(row?.reason) || 'Refugo',
        subtitle: `${machineId || 'Sem máquina'} • ${text(row?.operator) || 'Sem operador'}`,
        details: [
          `Motivo: ${text(row?.reason) || 'Não informado'}`,
          `Quantidade: ${formatInteger(qty)}`,
        ],
      }
    })
  }, [itemsMap, orderById, scraps])

  const stopRecords = useMemo(() => {
    return orderGroupsInRange.flatMap((group) => {
      const order = group?.ordem || {}
      const sourceOrderId = text(group?.orderId || order?.source_order_id || order?.id)
      return (group?.stops || []).map((stop) => {
        const machineId = text(stop?.machine_id || order?.machine_id)
        const sector = getSectorByMachine(machineId)
        const shift = resolveShift(null, stop?.started_at)
        const durationMs = clampDurationMs(stop?.started_at, stop?.resumed_at || stop?.ended_at || range.endIso, range.startMs, range.endMs)
        return {
          id: `stop:${stop.id}`,
          type: 'stop',
          timestamp: stop?.started_at || null,
          orderId: sourceOrderId,
          code: text(order?.code),
          product: text(order?.product),
          customer: text(order?.customer),
          machineId,
          sector,
          shift,
          value: 0,
          quantity: durationMs / 1000 / 60 / 60,
          status: text(stop?.reason) || 'Parada',
          subtitle: `${machineId || 'Sem máquina'} • ${formatHours(durationMs / 1000 / 60 / 60)}`,
          details: [
            `Início: ${fmtDateTime(stop?.started_at) || '-'}`,
            `Fim: ${fmtDateTime(stop?.resumed_at || stop?.ended_at) || 'Em aberto'}`,
            `Observação: ${text(stop?.notes) || 'Sem observação'}`,
          ],
        }
      })
    })
  }, [orderGroupsInRange, range.endIso, range.endMs, range.startMs])

  const allRecords = useMemo(() => {
    return [...orderRecords, ...productionRecords, ...scrapRecords, ...stopRecords]
      .filter((record) => record.timestamp)
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
  }, [orderRecords, productionRecords, scrapRecords, stopRecords])

  const recordsByScope = useMemo(() => {
    return allRecords.filter((record) => {
      if (sectorFilter !== 'all' && record.sector !== sectorFilter) return false
      if (machineFilter !== 'all' && record.machineId !== machineFilter) return false
      if (shiftFilter !== 'all' && record.shift !== shiftFilter) return false

      const query = lower(search)
      if (!query) return true
      const haystack = [
        record.code,
        record.product,
        record.customer,
        record.machineId,
        record.status,
        record.sector,
        record.subtitle,
        record.orderId,
      ].map(lower).join(' ')
      return haystack.includes(query)
    })
  }, [allRecords, machineFilter, search, sectorFilter, shiftFilter])

  const searchableRecords = useMemo(() => {
    return recordsByScope.filter((record) => {
      if (typeFilter !== 'all' && record.type !== typeFilter) return false
      return true
    })
  }, [recordsByScope, typeFilter])

  function handleStopReasonSelect(value) {
    setSelectedStopReason(value)
    if (value !== 'all') setSelectedScrapReason('all')
  }

  function handleScrapReasonSelect(value) {
    setSelectedScrapReason(value)
    if (value !== 'all') setSelectedStopReason('all')
  }

  const centralRecords = useMemo(() => {
    if (selectedStopReason !== 'all') {
      return recordsByScope.filter((record) => record.type === 'stop' && record.status === selectedStopReason)
    }
    if (selectedScrapReason !== 'all') {
      return recordsByScope.filter((record) => record.type === 'scrap' && record.status === selectedScrapReason)
    }
    return searchableRecords
  }, [recordsByScope, searchableRecords, selectedScrapReason, selectedStopReason])

  const displayedRecords = useMemo(() => {
    if (selectedDay === 'all') return centralRecords
    return centralRecords.filter((record) => (record.dayKey || getRecordDayKey(record.timestamp)) === selectedDay)
  }, [centralRecords, selectedDay])

  const valueRecords = useMemo(() => {
    return productionRecords.filter((record) => {
      if (sectorFilter !== 'all' && record.sector !== sectorFilter) return false
      if (machineFilter !== 'all' && record.machineId !== machineFilter) return false
      if (shiftFilter !== 'all' && record.shift !== shiftFilter) return false

      const query = lower(search)
      if (!query) return true
      const haystack = [record.code, record.product, record.customer, record.machineId, record.orderId].map(lower).join(' ')
      return haystack.includes(query)
    })
  }, [machineFilter, productionRecords, search, sectorFilter, shiftFilter])

  const dailyValueRows = useMemo(() => {
    const totals = {}
    let cursor = range.start.startOf('day')
    const endCursor = range.end.startOf('day')

    while (cursor <= endCursor) {
      const key = cursor.toISODate()
      totals[key] = {
        key,
        label: cursor.toFormat('dd/LL'),
        weekday: cursor.setLocale('pt-BR').toFormat('ccc').replace('.', ''),
        fullLabel: cursor.setLocale('pt-BR').toFormat('dd LLL yyyy'),
        value: 0,
      }
      cursor = cursor.plus({ days: 1 })
    }

    for (const record of valueRecords) {
      const key = text(record.dayKey || getRecordDayKey(record.timestamp))
      if (!key) continue

      const recordDate = DateTime.fromISO(key, { zone: 'America/Sao_Paulo' })
      if (!totals[key]) {
        totals[key] = {
          key,
          label: recordDate.toFormat('dd/LL'),
          weekday: recordDate.setLocale('pt-BR').toFormat('ccc').replace('.', ''),
          fullLabel: recordDate.setLocale('pt-BR').toFormat('dd LLL yyyy'),
          value: 0,
        }
      }
      totals[key].value += toNumber(record.value)
    }

    const rows = Object.values(totals).sort((left, right) => String(left.key).localeCompare(String(right.key)))
    const peakValue = Math.max(...rows.map((row) => toNumber(row.value)), 0)

    return rows.map((row) => ({
      ...row,
      isPeak: peakValue > 0 && toNumber(row.value) === peakValue,
    }))
  }, [range.end, range.start, valueRecords])

  const selectedDayLabel = useMemo(() => {
    if (selectedDay === 'all') return ''
    return dailyValueRows.find((row) => row.key === selectedDay)?.fullLabel || selectedDay
  }, [dailyValueRows, selectedDay])

  const dailyChartSubtitle = useMemo(() => {
    const scope = []
    if (machineFilter !== 'all') scope.push(`Máquina ${machineFilter}`)
    if (shiftFilter !== 'all') scope.push(getShiftLabel(shiftFilter))
    if (sectorFilter !== 'all') scope.push(sectorFilter)
    return scope.length
      ? `Valor produzido por dia no recorte atual. Filtros ativos: ${scope.join(' • ')}.`
      : 'Valor produzido por dia no recorte atual, com visão geral por dia.'
  }, [machineFilter, sectorFilter, shiftFilter])

  useEffect(() => {
    if (selectedDay === 'all') return
    const hasSelectedDay = dailyValueRows.some((row) => row.key === selectedDay)
    if (!hasSelectedDay) setSelectedDay('all')
  }, [dailyValueRows, selectedDay])

  const recordsPanelDescription = useMemo(() => {
    const filters = []
    if (selectedDay !== 'all') filters.push(`dia ${selectedDayLabel}`)
    if (selectedStopReason !== 'all') filters.push(`paradas por ${selectedStopReason}`)
    if (selectedScrapReason !== 'all') filters.push(`refugos por ${selectedScrapReason}`)

    if (!filters.length) {
      return 'Produção, refugo, paradas e ordens em uma única leitura operacional.'
    }

    return `Central filtrada por ${filters.join(' • ')}.`
  }, [selectedDay, selectedDayLabel, selectedScrapReason, selectedStopReason])

  const valueSummary = useMemo(() => {
    return valueRecords.reduce((acc, record) => {
      acc.totalValue += toNumber(record.value)
      acc.totalPieces += toNumber(record.quantity)
      acc.totalWeightKg += toNumber(record.weightKg)
      return acc
    }, { totalValue: 0, totalPieces: 0, totalWeightKg: 0 })
  }, [valueRecords])

  const monthlyTargetStatus = useMemo(() => {
    const producedValue = toNumber(monthlyProducedValue)
    const difference = monthlyValueTarget - producedValue

    if (difference > 0) {
      return {
        label: 'Valor de atraso',
        value: formatCurrency(difference),
        meta: `Meta ${monthlyReference.label}: ${formatCurrency(monthlyValueTarget)}`,
        produced: `Produzido no mês: ${formatCurrency(producedValue)}`,
        tone: 'danger',
      }
    }

    if (difference < 0) {
      return {
        label: 'Acima da meta',
        value: formatCurrency(Math.abs(difference)),
        meta: `Meta ${monthlyReference.label}: ${formatCurrency(monthlyValueTarget)}`,
        produced: `Produzido no mês: ${formatCurrency(producedValue)}`,
        tone: 'success',
      }
    }

    return {
      label: 'Meta atingida',
      value: formatCurrency(0),
      meta: `Meta ${monthlyReference.label}: ${formatCurrency(monthlyValueTarget)}`,
      produced: `Produzido no mês: ${formatCurrency(producedValue)}`,
      tone: 'success',
    }
  }, [monthlyProducedValue, monthlyReference.label, monthlyValueTarget])

  const scrapSummary = useMemo(() => {
    return searchableRecords.filter((record) => record.type === 'scrap').reduce((acc, record) => {
      acc.qty += toNumber(record.quantity)
      acc.value += toNumber(record.value)
      acc.weightKg += toNumber(record.weightKg)
      return acc
    }, { qty: 0, value: 0, weightKg: 0 })
  }, [searchableRecords])

  const scrapPercent = useMemo(() => {
    const goodPieces = toNumber(valueSummary.totalPieces)
    const scrapPieces = toNumber(scrapSummary.qty)
    const base = goodPieces + scrapPieces
    if (base <= 0) return 0
    return (scrapPieces / base) * 100
  }, [scrapSummary.qty, valueSummary.totalPieces])

  const stopReasonSummary = useMemo(() => {
    const totals = {}
    for (const record of stopRecords) {
      if (sectorFilter !== 'all' && record.sector !== sectorFilter) continue
      if (machineFilter !== 'all' && record.machineId !== machineFilter) continue
      if (shiftFilter !== 'all' && record.shift !== shiftFilter) continue
      totals[record.status] = totals[record.status] || { hours: 0, count: 0 }
      totals[record.status].hours += toNumber(record.quantity)
      totals[record.status].count += 1
    }
    return Object.entries(totals)
      .map(([reason, totalsByReason]) => ({
        reason,
        hours: totalsByReason.hours,
        count: totalsByReason.count,
      }))
      .sort((left, right) => right.hours - left.hours)
      .slice(0, 6)
  }, [machineFilter, sectorFilter, shiftFilter, stopRecords])

  const stopReasonChartRows = useMemo(() => {
    return stopReasonSummary.map((row) => ({
      key: row.reason,
      label: `${row.reason} · ${row.count}`,
      value: row.hours,
    }))
  }, [stopReasonSummary])

  const scrapReasonSummary = useMemo(() => {
    const totals = {}
    for (const record of scrapRecords) {
      if (sectorFilter !== 'all' && record.sector !== sectorFilter) continue
      if (machineFilter !== 'all' && record.machineId !== machineFilter) continue
      if (shiftFilter !== 'all' && record.shift !== shiftFilter) continue
      totals[record.status] = totals[record.status] || { qty: 0, count: 0 }
      totals[record.status].qty += toNumber(record.quantity)
      totals[record.status].count += 1
    }
    return Object.entries(totals)
      .map(([reason, totalsByReason]) => ({
        reason,
        qty: totalsByReason.qty,
        count: totalsByReason.count,
      }))
      .sort((left, right) => right.qty - left.qty)
      .slice(0, 6)
  }, [machineFilter, scrapRecords, sectorFilter, shiftFilter])

  const scrapReasonChartRows = useMemo(() => {
    return scrapReasonSummary.map((row) => ({
      key: row.reason,
      label: `${row.reason} · ${row.count}`,
      value: row.qty,
    }))
  }, [scrapReasonSummary])

  useEffect(() => {
    if (selectedStopReason === 'all') return
    const hasSelectedStopReason = stopReasonChartRows.some((row) => row.key === selectedStopReason)
    if (!hasSelectedStopReason) setSelectedStopReason('all')
  }, [selectedStopReason, stopReasonChartRows])

  useEffect(() => {
    if (selectedScrapReason === 'all') return
    const hasSelectedScrapReason = scrapReasonChartRows.some((row) => row.key === selectedScrapReason)
    if (!hasSelectedScrapReason) setSelectedScrapReason('all')
  }, [scrapReasonChartRows, selectedScrapReason])

  const oeeMetrics = useMemo(() => {
    const filteredProduction = productionRecords.filter((record) => {
      if (sectorFilter !== 'all' && record.sector !== sectorFilter) return false
      if (machineFilter !== 'all' && record.machineId !== machineFilter) return false
      if (shiftFilter !== 'all' && record.shift !== shiftFilter) return false
      return true
    })

    const filteredScrap = scrapRecords.filter((record) => {
      if (sectorFilter !== 'all' && record.sector !== sectorFilter) return false
      if (machineFilter !== 'all' && record.machineId !== machineFilter) return false
      if (shiftFilter !== 'all' && record.shift !== shiftFilter) return false
      return true
    })

    const plannedIntervals = getShiftWindowsInRange(range.start, range.end, {
      shiftKeys: shiftFilter !== 'all' ? [shiftFilter] : ACTIVE_SHIFT_KEYS,
      setupMinutes: 30,
    })

    let loadedPlannedMs = 0
    let stopMs = 0
    let runtimeMs = 0
    let semProgramacaoMs = 0
    let idealPieces = 0
    const missingTargets = new Set()

    for (const machineId of availableMachines) {
      const machineGroups = Array.isArray(groupsByMachine?.[machineId]) ? groupsByMachine[machineId] : []

      const sessionIntervals = mergeIntervals(
        machineGroups.flatMap((group) => {
          const sessions = Array.isArray(group?.sessions) && group.sessions.length
            ? group.sessions
            : group?.session
              ? [group.session]
              : group?.ordem?.started_at
                ? [{ started_at: group.ordem.started_at, ended_at: group.ordem.finalized_at || group.ordem.interrupted_at || null }]
                : []

          return mapRecordsToIntervals(sessions, {
            rangeStartMs: range.startMs,
            rangeEndMs: range.endMs,
            fallbackEndMs: range.endMs,
          })
        })
      )

      const loadedIntervals = intersectIntervals(plannedIntervals, sessionIntervals)
      const semProgramacaoIntervals = subtractIntervals(plannedIntervals, sessionIntervals)

      const countedStopIntervals = mergeIntervals(
        machineGroups.flatMap((group) => {
          const stops = (group?.stops || [])
            .filter((stop) => isCountedStopReason(stop?.reason))
            .map((stop) => ({
              started_at: stop?.started_at,
              ended_at: stop?.resumed_at || stop?.ended_at || null,
            }))

          return mapRecordsToIntervals(stops, {
            rangeStartMs: range.startMs,
            rangeEndMs: range.endMs,
            fallbackEndMs: range.endMs,
          })
        })
      )

      const stopInsideLoaded = intersectIntervals(countedStopIntervals, loadedIntervals)
      const machineRuntimeIntervals = subtractIntervals(loadedIntervals, stopInsideLoaded)

      loadedPlannedMs += sumIntervals(loadedIntervals)
      semProgramacaoMs += sumIntervals(semProgramacaoIntervals)
      stopMs += sumIntervals(stopInsideLoaded)
      runtimeMs += sumIntervals(machineRuntimeIntervals)

      for (const group of machineGroups) {
        const productCode = extractItemCodeFromOrderProduct(group?.ordem?.product)
        const itemMeta = productCode ? itemsMap[productCode] : null
        const piecesPerHour = getPiecesPerHour(itemMeta)
        if (piecesPerHour <= 0) {
          if (productCode) missingTargets.add(productCode)
          continue
        }

        const sessions = Array.isArray(group?.sessions) && group.sessions.length
          ? group.sessions
          : group?.session
            ? [group.session]
            : group?.ordem?.started_at
              ? [{ started_at: group.ordem.started_at, ended_at: group.ordem.finalized_at || group.ordem.interrupted_at || null }]
              : []

        const groupSessionIntervals = mergeIntervals(
          mapRecordsToIntervals(sessions, {
            rangeStartMs: range.startMs,
            rangeEndMs: range.endMs,
            fallbackEndMs: range.endMs,
          })
        )

        const groupLoadedIntervals = intersectIntervals(plannedIntervals, groupSessionIntervals)
        const groupStopIntervals = mergeIntervals(
          mapRecordsToIntervals(
            (group?.stops || [])
              .filter((stop) => isCountedStopReason(stop?.reason))
              .map((stop) => ({
                started_at: stop?.started_at,
                ended_at: stop?.resumed_at || stop?.ended_at || null,
              })),
            {
              rangeStartMs: range.startMs,
              rangeEndMs: range.endMs,
              fallbackEndMs: range.endMs,
            }
          )
        )

        const groupRuntimeIntervals = subtractIntervals(
          groupLoadedIntervals,
          intersectIntervals(groupStopIntervals, groupLoadedIntervals)
        )

        idealPieces += (sumIntervals(groupRuntimeIntervals) / 1000 / 60 / 60) * piecesPerHour
      }
    }

    const goodPieces = filteredProduction.reduce((total, record) => total + toNumber(record.quantity), 0)
    const scrapPieces = filteredScrap.reduce((total, record) => total + toNumber(record.quantity), 0)
    const actualPieces = goodPieces + scrapPieces

    const availability = loadedPlannedMs > 0 ? Math.max(0, (loadedPlannedMs - stopMs) / loadedPlannedMs) : null
    const performance = idealPieces > 0 ? Math.max(0, actualPieces / idealPieces) : null
    const quality = actualPieces > 0 ? Math.max(0, goodPieces / actualPieces) : 1

    const oee = availability != null && performance != null
      ? Math.min(1, availability) * Math.min(1, performance) * Math.min(1, quality)
      : null

    return {
      oeePercent: oee == null ? null : Math.min(100, oee * 100),
      availabilityPercent: availability == null ? null : Math.min(100, availability * 100),
      performancePercent: performance == null ? null : Math.min(100, performance * 100),
      qualityPercent: quality == null ? null : Math.min(100, quality * 100),
      loadedPlannedHours: loadedPlannedMs / 1000 / 60 / 60,
      semProgramacaoHours: semProgramacaoMs / 1000 / 60 / 60,
      stopHours: stopMs / 1000 / 60 / 60,
      runtimeHours: runtimeMs / 1000 / 60 / 60,
      actualPieces,
      idealPieces,
      goodPieces,
      scrapPieces,
      missingTargets: Array.from(missingTargets),
    }
  }, [availableMachines, groupsByMachine, itemsMap, machineFilter, productionRecords, range.end, range.endMs, range.start, range.startMs, scrapRecords, sectorFilter, shiftFilter])

  const summaryCards = useMemo(() => {
    const hasOee = oeeMetrics.oeePercent != null
    const oeeTone = !hasOee
      ? 'default'
      : oeeMetrics.oeePercent >= 85
        ? 'brand'
        : oeeMetrics.oeePercent >= 60
          ? 'warning'
          : 'danger'

    return [
      {
        label: 'O.E.E',
        value: hasOee ? formatPercent(oeeMetrics.oeePercent) : '—',
        hint: hasOee
          ? [
              `Disp. ${formatPercent(oeeMetrics.availabilityPercent)} • Desemp. ${formatPercent(oeeMetrics.performancePercent)}`,
              `Qualid. ${formatPercent(oeeMetrics.qualityPercent)} • Sem programação ${formatHours(oeeMetrics.semProgramacaoHours)}`,
            ]
          : oeeMetrics.missingTargets.length
            ? [
                'Nao foi possivel fechar a meta ideal de todas as ordens do recorte.',
                `Cadastre ciclo/cavidades: ${oeeMetrics.missingTargets.slice(0, 3).join(', ')}${oeeMetrics.missingTargets.length > 3 ? '...' : ''}`,
              ]
            : [
                'Sem tempo programado carregado no recorte filtrado.',
                'Sem programação nao reduz o O.E.E.',
              ],
        tone: oeeTone,
      },
      {
        label: 'Valorização produzida',
        value: formatCurrency(valueSummary.totalValue),
        hint: [
          `${formatInteger(valueSummary.totalPieces)} peças boas`,
          formatWeightKg(valueSummary.totalWeightKg),
        ],
        tone: 'brand',
      },
      {
        label: 'Refugo apontado',
        value: formatCurrency(scrapSummary.value),
        hint: [
          `${formatInteger(scrapSummary.qty)} peças`,
          `${formatWeightKg(scrapSummary.weightKg)} • ${formatPercent(scrapPercent)}`,
        ],
        tone: 'warning',
      },
      {
        label: 'Horas produtivas',
        value: formatHours(occupancyMetrics.totalProdH),
        hint: `${formatHours(occupancyMetrics.totalDisponivelH)} disponíveis`,
      },
      {
        label: 'Horas paradas',
        value: formatHours(occupancyMetrics.totalParadaH),
        hint: `${occupancyMetrics.totalMaquinasParadas} máquinas com parada`,
        tone: 'danger',
      },
      {
        label: 'Baixa eficiência',
        value: formatHours(occupancyMetrics.totalLowEffH),
        hint: 'Tempo ocupado em baixa eficiência',
      },
    ]
  }, [occupancyMetrics.totalDisponivelH, occupancyMetrics.totalLowEffH, occupancyMetrics.totalMaquinasParadas, occupancyMetrics.totalParadaH, occupancyMetrics.totalProdH, oeeMetrics.availabilityPercent, oeeMetrics.missingTargets, oeeMetrics.oeePercent, oeeMetrics.performancePercent, oeeMetrics.qualityPercent, oeeMetrics.semProgramacaoHours, scrapPercent, scrapSummary.qty, scrapSummary.value, scrapSummary.weightKg, valueSummary.totalPieces, valueSummary.totalValue, valueSummary.totalWeightKg])

  return (
    <div className="gestao-dashboard">
      <div className="gestao-panel gestao-filters-panel">
        <div className="gestao-filters-grid">
          <label>
            <span>Data inicial</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>

          <label>
            <span>Data final</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>

          <label className="is-wide">
            <span>Buscar O.S., cliente, produto ou máquina</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ex.: 12345, tampa 38mm, P3"
            />
          </label>

          <label>
            <span>Tipo</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label>
            <span>Setor</span>
            <select value={sectorFilter} onChange={(e) => {
              setSectorFilter(e.target.value)
              setMachineFilter('all')
            }}>
              <option value="all">Todos os setores</option>
              <option value="PET">PET</option>
              <option value="INJEÇÃO">Injeção</option>
              <option value="OUTROS">Outros</option>
            </select>
          </label>

          <label>
            <span>Máquina</span>
            <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
              <option value="all">Todas as máquinas</option>
              {machinesForSector.map((machineId) => <option key={machineId} value={machineId}>{machineId}</option>)}
            </select>
          </label>

          <label>
            <span>Turno</span>
            <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}>
              {SHIFT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="gestao-filter-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const today = getTodayDate()
              setStartDate(today)
              setEndDate(today)
              setSearch('')
              setTypeFilter('all')
              setSectorFilter('all')
              setMachineFilter('all')
              setShiftFilter('all')
              setSelectedDay('all')
              setSelectedStopReason('all')
              setSelectedScrapReason('all')
            }}
          >
            Resetar filtros
          </button>
          {loading ? <span className="gestao-status">Atualizando dados...</span> : null}
          {error ? <span className="gestao-status is-error">{error}</span> : null}
        </div>
      </div>

      <div className="gestao-stats-grid">
        {summaryCards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} hint={card.hint} tone={card.tone} />
        ))}
      </div>

      <div className="gestao-charts-grid">
        <DashboardDailyColumnChart
          title="Valorização por dia"
          subtitle={dailyChartSubtitle}
          rows={dailyValueRows}
          selectedValue={selectedDay}
          onSelect={setSelectedDay}
          targetStatus={monthlyTargetStatus}
          valueFormatter={formatCurrency}
        />
        <DashboardBarChart
          title="Principais paradas"
          subtitle="Clique em um motivo para mostrar apenas essas paradas na central de registros."
          rows={stopReasonChartRows}
          selectedValue={selectedStopReason}
          onSelect={handleStopReasonSelect}
          valueFormatter={formatHours}
        />
        <DashboardBarChart
          title="Principais motivos de refugo"
          subtitle="Clique em um motivo para mostrar apenas esses refugos na central de registros."
          rows={scrapReasonChartRows}
          selectedValue={selectedScrapReason}
          onSelect={handleScrapReasonSelect}
          valueFormatter={formatPieces}
        />
      </div>

      <div className="gestao-main-grid">
        <div className="gestao-panel gestao-table-panel">
          <div className="gestao-panel-head">
            <div>
              <h3>Central de registros</h3>
              <p>{recordsPanelDescription}</p>
            </div>
            <button
              type="button"
              className="gestao-collapse-toggle"
              onClick={() => setIsRecordsExpanded((previous) => !previous)}
              aria-expanded={isRecordsExpanded}
            >
              <span className={`gestao-chevron ${isRecordsExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
              {isRecordsExpanded ? 'Recolher' : 'Expandir'}
            </button>
          </div>

          {isRecordsExpanded ? (
            <div className="gestao-table-wrap">
              {selectedDay !== 'all' || selectedStopReason !== 'all' || selectedScrapReason !== 'all' ? (
                <div className="gestao-day-filter-banner">
                  <span>
                    {selectedStopReason !== 'all' && selectedDay !== 'all'
                      ? `Central mostrando apenas paradas por ${selectedStopReason} em ${selectedDayLabel}`
                      : selectedScrapReason !== 'all' && selectedDay !== 'all'
                        ? `Central mostrando apenas refugos por ${selectedScrapReason} em ${selectedDayLabel}`
                        : selectedStopReason !== 'all'
                          ? `Central mostrando apenas paradas por ${selectedStopReason}`
                          : selectedScrapReason !== 'all'
                            ? `Central mostrando apenas refugos por ${selectedScrapReason}`
                            : `Central mostrando apenas registros de ${selectedDayLabel}`}
                  </span>
                  <div className="gestao-day-filter-actions">
                    {selectedDay !== 'all' ? (
                      <button type="button" className="btn btn-small" onClick={() => setSelectedDay('all')}>
                        Mostrar todos os dias
                      </button>
                    ) : null}
                    {selectedStopReason !== 'all' ? (
                      <button type="button" className="btn btn-small" onClick={() => setSelectedStopReason('all')}>
                        Limpar motivo
                      </button>
                    ) : null}
                    {selectedScrapReason !== 'all' ? (
                      <button type="button" className="btn btn-small" onClick={() => setSelectedScrapReason('all')}>
                        Limpar refugo
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <table className="gestao-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Momento</th>
                    <th>O.S.</th>
                    <th>Máquina</th>
                    <th>Status</th>
                    <th>Qtd/Horas</th>
                    <th>Valor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRecords.length ? displayedRecords.slice(0, 120).map((record) => {
                    const isExpanded = effectiveOpenSet?.has(record.id)
                    return (
                      <React.Fragment key={record.id}>
                        <tr>
                          <td>
                            <span className={`gestao-record-badge ${TYPE_BADGES[record.type] || ''}`}>
                              {TYPE_LABELS[record.type] || record.type}
                            </span>
                          </td>
                          <td>{fmtDateTime(record.timestamp)}</td>
                          <td>
                            <strong>{record.code || '-'}</strong>
                            <div className="gestao-muted">{record.product || record.customer || '-'}</div>
                          </td>
                          <td>
                            {record.machineId || '-'}
                            <div className="gestao-muted">{record.sector} • {getShiftLabel(record.shift)}</div>
                          </td>
                          <td>{record.status || '-'}</td>
                          <td>{record.type === 'stop' ? formatHours(record.quantity) : formatInteger(record.quantity)}</td>
                          <td>{record.type === 'stop' || record.type === 'order' ? '-' : formatCurrency(record.value)}</td>
                          <td>
                            <button type="button" className="btn btn-small" onClick={() => handleToggle(record.id)}>
                              {isExpanded ? 'Ocultar' : 'Detalhes'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="gestao-row-details">
                            <td colSpan="8">
                              <div className="gestao-detail-grid">
                                <div>
                                  <strong>Resumo</strong>
                                  <p>{record.subtitle || 'Sem resumo adicional.'}</p>
                                </div>
                                <div>
                                  <strong>Campos relacionados</strong>
                                  <ul>
                                    {record.details.map((detail) => <li key={detail}>{detail}</li>)}
                                  </ul>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    )
                  }) : (
                    <tr>
                      <td colSpan="8">
                        <div className="gestao-empty">Nenhum registro encontrado para o filtro atual.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="gestao-collapsed-note">Tabela recolhida. Use a seta para expandir novamente.</div>
          )}
        </div>
      </div>

      {isAdmin ? (
        <div className="gestao-panel gestao-admin-panel">
          <div className="gestao-panel-head">
            <div>
              <h3>Administração avançada</h3>
              <p>Quando necessário, o CRUD continua disponível dentro da própria gestão.</p>
            </div>
            <button type="button" className="btn" onClick={() => setShowAdmin((previous) => !previous)}>
              {showAdmin ? 'Recolher' : 'Expandir'}
            </button>
          </div>

          {showAdmin ? <GerenciamentoAvancado /> : null}
        </div>
      ) : null}
    </div>
  )
}