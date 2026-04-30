// src/abas/Lista.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import FilaSortableItem from '../components/FilaSortableItem'
import Etiqueta from '../components/Etiqueta'
import Modal from '../components/Modal'
import { MAQUINAS, STATUS } from '../lib/constants'
import { statusClass } from '../lib/utils'
import { supabase } from '../lib/supabaseClient.js' // ✅ ESM correto
import { DateTime } from 'luxon';

export default function Lista({
  ativosPorMaquina,
  sensors,
  onStatusChange,
  setStartModal,
  setEditando,
  setFinalizando,
  enviarParaFila,     // agora vamos chamar com { operador, data, hora }
  refreshOrdens,      // opcional
  isAdmin = false,
}) {
  const [itemTechByCode, setItemTechByCode] = useState({})
  const [viewMode, setViewMode] = useState('default')
  const [insumosLoading, setInsumosLoading] = useState(false)
  const [insumosError, setInsumosError] = useState('')
  const [insumosByMachine, setInsumosByMachine] = useState([])
  const [filteredInsumosTotals, setFilteredInsumosTotals] = useState([])
  const [weeklyInsumosTotals, setWeeklyInsumosTotals] = useState([])
  const [machineWeeklyCapacity, setMachineWeeklyCapacity] = useState([])
  const [machineRangeCapacity, setMachineRangeCapacity] = useState([])
  const [insumoDetailsByCode, setInsumoDetailsByCode] = useState({})
  const [structuresByCode, setStructuresByCode] = useState({})
  const [expandedMachines, setExpandedMachines] = useState(() => Object.fromEntries(MAQUINAS.map((machineId) => [machineId, false])))
  const [insumosFilter, setInsumosFilter] = useState('today')
  const [customFilterRange, setCustomFilterRange] = useState(() => ({
    start: DateTime.now().setZone('America/Sao_Paulo').toISODate(),
    end: DateTime.now().setZone('America/Sao_Paulo').toISODate(),
  }))
  const [draggingOrder, setDraggingOrder] = useState(null)
  const [separations, setSeparations] = useState({}) // { orderId: { itemCode: qty } }

  function getSeparationStatus(order, structures) {
    const orderSeparations = separations[order.id] || {}
    let totalItems = structures.length
    let separatedItems = 0

    structures.forEach((struct) => {
      const itemCode = struct.input_item_code
      const requiredQty = (Number(order.qty) || 0) * Number(struct.quantity_per_piece || 0)
      const separatedQty = Number(orderSeparations[itemCode] || 0)
      if (separatedQty >= requiredQty) separatedItems++
    })

    if (separatedItems === 0) return 'none'
    if (separatedItems === totalItems) return 'complete'
    return 'partial'
  }

  function updateSeparation(orderId, itemCode, qty) {
    setSeparations((prev) => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        [itemCode]: qty,
      },
    }))
  }

  // 🔶 Modal de separação por O.P.
  const [separationModal, setSeparationModal] = useState(null) // { order, inputs: { itemCode: qty } }
  const [separationInputs, setSeparationInputs] = useState({}) // { itemCode: qty }

  function openOrderSeparation(ordem) {
    const currentValues = separations[ordem.id] || {}
    setSeparationInputs(currentValues)
    setSeparationModal({ ordem })
  }

  function handleSeparationSave() {
    const orderId = separationModal?.ordem?.id
    if (!orderId) return
    Object.entries(separationInputs).forEach(([itemCode, qty]) => {
      updateSeparation(orderId, itemCode, Number(qty || 0))
    })
    setSeparationModal(null)
  }

  // 🔶 Modal de confirmação "Enviar para fila / interromper"
  const [confirmInt, setConfirmInt] = useState(null)
  const [confirmIntSaving, setConfirmIntSaving] = useState(false)
  const confirmIntSavingRef = useRef(false)
  // confirmInt = { ordem, operador, data, hora }

  const toNumber = (value) => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0

    const raw = String(value).trim()
    if (!raw) return 0

    const normalized = raw
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')

    const num = Number(normalized)
    return Number.isFinite(num) ? num : 0
  }

  const extractProductCode = (product) => {
    if (!product) return ''
    return String(product).split('-')[0]?.trim() || ''
  }

  const normalizeCode = (value) => String(value || '').trim().toUpperCase()

  const getFilterLabel = (key) => {
    if (key === 'today') return 'Hoje'
    if (key === 'tomorrow') return 'Amanhã'
    if (key === 'week') return 'Esta Semana'
    if (key === 'fortnight') return 'Esta Quinzena'
    if (key === 'month') return 'Este Mês'
    return 'Personalizado'
  }

  const getTimeRange = useCallback(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo')
    let start = now.startOf('day')
    let end = now.endOf('day')

    if (insumosFilter === 'tomorrow') {
      const tomo = now.plus({ days: 1 })
      start = tomo.startOf('day')
      end = tomo.endOf('day')
    } else if (insumosFilter === 'week') {
      start = now.startOf('week')
      end = now.endOf('week')
    } else if (insumosFilter === 'fortnight') {
      if (now.day <= 15) {
        start = now.startOf('month')
        end = now.set({ day: 15 }).endOf('day')
      } else {
        start = now.set({ day: 16 }).startOf('day')
        end = now.endOf('month')
      }
    } else if (insumosFilter === 'month') {
      start = now.startOf('month')
      end = now.endOf('month')
    } else if (insumosFilter === 'custom') {
      const customStart = DateTime.fromISO(customFilterRange.start, { zone: 'America/Sao_Paulo' })
      const customEnd = DateTime.fromISO(customFilterRange.end, { zone: 'America/Sao_Paulo' })
      if (customStart.isValid) start = customStart.startOf('day')
      if (customEnd.isValid) end = customEnd.endOf('day')
    }

    if (end < start) end = start.endOf('day')
    return { start, end, label: getFilterLabel(insumosFilter) }
  }, [insumosFilter, customFilterRange])

  const activeItemCodes = useMemo(() => {
    const codes = new Set()

    MAQUINAS.forEach((m) => {
      const ativa = (ativosPorMaquina[m] || [])[0]
      const productRaw = String(ativa?.product || '').trim()
      if (!productRaw) return

      const productCode = productRaw.split('-')[0]?.trim()
      if (productCode) codes.add(productCode)
    })

    return Array.from(codes)
  }, [ativosPorMaquina])

  const allOrderProductCodes = useMemo(() => {
    const codes = new Set()
    MAQUINAS.forEach((m) => {
      (ativosPorMaquina[m] || []).forEach((ordem) => {
        const code = extractProductCode(ordem?.product)
        if (code) codes.add(code)
      })
    })
    return Array.from(codes)
  }, [ativosPorMaquina])

  useEffect(() => {
    let cancelled = false

    const carregarTechItems = async () => {
      if (!activeItemCodes.length) {
        setItemTechByCode({})
        return
      }

      const { data, error } = await supabase
        .from('items')
        .select('code, cycle_seconds, cavities')
        .in('code', activeItemCodes)

      if (error) {
        console.warn('Falha ao carregar ciclo/cavidades dos itens:', error)
        return
      }

      if (cancelled) return

      const mapped = {}
      ;(data || []).forEach((item) => {
        const code = String(item?.code || '').trim()
        if (!code) return
        mapped[code] = {
          cycleSeconds: Number(item?.cycle_seconds || 0),
          cavities: Number(item?.cavities || 0),
        }
      })

      setItemTechByCode(mapped)
    }

    carregarTechItems()

    return () => {
      cancelled = true
    }
  }, [activeItemCodes])

  useEffect(() => {
    let cancelled = false

    async function loadInsumosView() {
      if (viewMode !== 'insumos') return
      setInsumosLoading(true)
      setInsumosError('')

      try {
        const finishedCodes = allOrderProductCodes.filter(Boolean)
        if (finishedCodes.length === 0) {
          setInsumosByMachine([])
          setWeeklyInsumosTotals([])
          setMachineWeeklyCapacity([])
          return
        }

        const { data: structures, error: structuresError } = await supabase
          .from('item_structures')
          .select('finished_item_code, input_item_code, quantity_per_piece')
          .in('finished_item_code', finishedCodes)

        if (structuresError) throw structuresError

        const inputCodes = Array.from(new Set(
          (structures || [])
            .map((row) => normalizeCode(row?.input_item_code))
            .filter(Boolean)
        ))

        const { data: inputItems = [] } = inputCodes.length > 0
          ? await supabase.from('items').select('code, description, unidade, cliente, stock').in('code', inputCodes)
          : { data: [] }

        const inputByCode = (inputItems || []).reduce((acc, item) => {
          const code = normalizeCode(item?.code)
          if (!code) return acc
          acc[code] = {
            code,
            description: String(item?.description || '').trim() || code,
            unidade: String(item?.unidade || '').trim() || '-',
            cliente: String(item?.cliente || '').trim() || '-',
            stock: Number(item?.stock || 0),
          }
          return acc
        }, {})

        const structuresByFinished = (structures || []).reduce((acc, row) => {
          const finished = normalizeCode(row?.finished_item_code)
          if (!finished) return acc
          const input = normalizeCode(row?.input_item_code)
          if (!input) return acc
          const qtyPerPiece = Number(row?.quantity_per_piece) || 0
          acc[finished] = acc[finished] || []
          acc[finished].push({ inputCode: input, qtyPerPiece })
          return acc
        }, {})

        const { start: filterStart, end: filterEnd } = getTimeRange()
        const filterHours = Math.max(0, filterEnd.diff(filterStart, 'hours').hours)

        const machineCapacityRows = []
        const orderMachines = MAQUINAS.map((machineId) => {
          const orders = (ativosPorMaquina[machineId] || []).map((ordem) => {
            const productCode = normalizeCode(extractProductCode(ordem?.product))
            const structureRows = structuresByFinished[productCode] || []
            const orderQty = Number(ordem?.qty) || 0
            const inputTotalsByCode = structureRows.reduce((acc, row) => {
              const totalQty = orderQty * Number(row.qtyPerPiece || 0)
              if (!Number.isFinite(totalQty) || totalQty === 0) return acc
              const inputCode = row.inputCode
              acc[inputCode] = acc[inputCode] || {
                itemCode: inputCode,
                description: inputByCode[inputCode]?.description || inputCode,
                totalQty: 0,
                qtyPerPiece: row.qtyPerPiece,
                cliente: inputByCode[inputCode]?.cliente || '-',
              }
              acc[inputCode].totalQty += totalQty
              return acc
            }, {})

            return {
              ...ordem,
              productCode,
              orderQty,
              orderInputTotals: Object.values(inputTotalsByCode),
            }
          })

          const activeOrder = orders[0] || null
          const activeCode = normalizeCode(activeOrder?.productCode)
          const tech = itemTechByCode[activeCode] || {}
          const cycleSeconds = Number(tech?.cycleSeconds || 0)
          const cavities = Number(tech?.cavities || 0)
          const hoursPerWeek = 93
          const piecesPerHour = cycleSeconds > 0 && cavities > 0 ? (3600 / cycleSeconds) * cavities : 0
          const totalQueuePieces = orders.reduce((sum, ordem) => sum + (Number(ordem?.qty) || 0), 0)
          const weeklyCapacityPieces = piecesPerHour * hoursPerWeek
          const weeklyPieces = Math.min(weeklyCapacityPieces, totalQueuePieces)

          const weeklyInputs = (structuresByFinished[activeCode] || []).reduce((acc, row) => {
            const qty = weeklyPieces * Number(row.qtyPerPiece || 0)
            if (!Number.isFinite(qty) || qty === 0) return acc
            acc[row.inputCode] = (acc[row.inputCode] || 0) + qty
            return acc
          }, {})

          const rangeCapacityPieces = piecesPerHour * filterHours
          const rangePieces = Math.min(rangeCapacityPieces, totalQueuePieces)
          const rangeInputs = (structuresByFinished[activeCode] || []).reduce((acc, row) => {
            const qty = rangePieces * Number(row.qtyPerPiece || 0)
            if (!Number.isFinite(qty) || qty === 0) return acc
            acc[row.inputCode] = (acc[row.inputCode] || 0) + qty
            return acc
          }, {})

          machineCapacityRows.push({
            machineId,
            cycleSeconds,
            cavities,
            piecesPerHour,
            weeklyPieces,
            weeklyInputs,
            rangePieces,
            rangeInputs,
          })

          return {
            machineId,
            orders,
          }
        })

        const totalsByInputMap = {}
        orderMachines.forEach((machine) => {
          machine.orders.forEach((order) => {
            order.orderInputTotals.forEach((input) => {
              totalsByInputMap[input.itemCode] = totalsByInputMap[input.itemCode] || { itemCode: input.itemCode, totalQty: 0 }
              totalsByInputMap[input.itemCode].totalQty += input.totalQty
            })
          })
        })

        const weeklyTotalsByInputMap = {}
        const rangeTotalsByInputMap = {}
        machineCapacityRows.forEach((machine) => {
          Object.entries(machine.weeklyInputs || {}).forEach(([inputCode, qty]) => {
            weeklyTotalsByInputMap[inputCode] = (weeklyTotalsByInputMap[inputCode] || 0) + qty
          })
          Object.entries(machine.rangeInputs || {}).forEach(([inputCode, qty]) => {
            rangeTotalsByInputMap[inputCode] = (rangeTotalsByInputMap[inputCode] || 0) + qty
          })
        })

        setInsumosByMachine(orderMachines)
        setInsumoDetailsByCode(inputByCode)
        setStructuresByCode(structuresByFinished)
        setFilteredInsumosTotals(Object.entries(rangeTotalsByInputMap).map(([itemCode, totalQty]) => ({
          itemCode,
          description: inputByCode[itemCode]?.description || itemCode,
          unidade: inputByCode[itemCode]?.unidade || '-',
          cliente: inputByCode[itemCode]?.cliente || '-',
          totalQty,
          stock: inputByCode[itemCode]?.stock || 0,
        })))
        setWeeklyInsumosTotals(Object.entries(weeklyTotalsByInputMap).map(([itemCode, totalQty]) => ({
          itemCode,
          description: inputByCode[itemCode]?.description || itemCode,
          unidade: inputByCode[itemCode]?.unidade || '-',
          cliente: inputByCode[itemCode]?.cliente || '-',
          weeklyQty: totalQty,
        })))
        setMachineWeeklyCapacity(machineCapacityRows)
        setMachineRangeCapacity(machineCapacityRows)
      } catch (error) {
        setInsumosError(error?.message || 'Falha ao carregar dados de insumos.')
      } finally {
        if (!cancelled) setInsumosLoading(false)
      }
    }

    loadInsumosView()

    return () => {
      cancelled = true
    }
  }, [viewMode, allOrderProductCodes, ativosPorMaquina, itemTechByCode, getTimeRange])

  const abrirModalInterromper = (ordem) => {
    const nowBr = DateTime.now().setZone("America/Sao_Paulo");
    setConfirmInt({
      ordem,
      operador: "",
      data: nowBr.toISODate(), 
      hora: nowBr.toFormat("HH:mm"),
    })
  }

  const confirmarInterromper = async () => {
    if (confirmIntSavingRef.current) return

    const { ordem, operador, data, hora } = confirmInt || {}
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }

    confirmIntSavingRef.current = true
    setConfirmIntSaving(true)
    try {
      // 🔁 chama a função do App já com operador/data/hora
      const ok = await enviarParaFila(ordem, { operador, data, hora })
      if (!ok) return

      setConfirmInt(null)
      if (typeof refreshOrdens === 'function') {
        setTimeout(() => refreshOrdens(), 400)
      }
    } catch (e) {
      console.error(e)
      alert('Falha ao interromper/mandar para fila.')
    } finally {
      confirmIntSavingRef.current = false
      setConfirmIntSaving(false)
    }
  }

  const moverNaFila = async (machineCode, e) => {
    try {
      const activeId = e?.active?.id
      const overId   = e?.over?.id
      if (!activeId || !overId || activeId === overId) return

      const lista = ativosPorMaquina[machineCode] || []
      const fila  = lista.slice(1)
      const activeOrder = lista[0] || null

      const curIndex  = fila.findIndex(i => i.id === activeId)
      const overIndex = fila.findIndex(i => i.id === overId)
      if (curIndex < 0 || overIndex < 0) return

      const nova = [...fila]
      const [moved] = nova.splice(curIndex, 1)
      nova.splice(overIndex, 0, moved)

      const filaIds = nova.map(i => String(i.id))
      const ids = activeOrder ? [String(activeOrder.id), ...filaIds] : filaIds

      const { error } = await supabase.rpc('reorder_machine_queue', {
        p_machine: machineCode,
        p_ids: ids,
      })
      if (error) throw error

      if (typeof refreshOrdens === 'function') {
        setTimeout(() => refreshOrdens(), 500) // dá tempo do Realtime chegar
      }
    } catch (err) {
      console.error('Reordenação falhou:', err)
      alert('Falha ao reordenar a fila. Detalhes no console.')
    }
  }

  const formatQty = (value) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return '0'
    return num.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  }

  const toggleMachineExpanded = (machineId) => {
    setExpandedMachines((prev) => ({ ...prev, [machineId]: !prev[machineId] }))
  }

  const renderInsumosView = () => {
    if (insumosLoading) {
      return <div className="muted">Carregando visualização de insumos…</div>
    }
    if (insumosError) {
      return <div className="muted" style={{ color: '#b91c1c' }}>{insumosError}</div>
    }
    if (!insumosByMachine.length) {
      return <div className="muted">Nenhuma O.P. ou estrutura de insumo encontrada para as ordens atuais.</div>
    }

    const { label: filterLabel } = getTimeRange()

    // Agrupar insumos por cliente
    const insumosByCliente = filteredInsumosTotals.reduce((acc, row) => {
      const cliente = row.cliente || 'Sem cliente'
      if (!acc[cliente]) {
        acc[cliente] = []
      }
      acc[cliente].push(row)
      return acc
    }, {})

    const weeklyInsumosByCliente = weeklyInsumosTotals.reduce((acc, row) => {
      const cliente = row.cliente || 'Sem cliente'
      if (!acc[cliente]) {
        acc[cliente] = []
      }
      acc[cliente].push(row)
      return acc
    }, {})

    return (
      <>
        <div className="grid2" style={{ gap: 12, marginBottom: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="label">Total estimado de insumos ({filterLabel})</div>
            {Object.keys(insumosByCliente).length === 0 ? (
              <div className="small muted">Nenhum insumo encontrado para as estruturas cadastradas.</div>
            ) : (
              Object.entries(insumosByCliente).map(([cliente, insumos]) => (
                <div key={cliente} style={{ marginBottom: 16 }}>
                  <div className="small" style={{ fontWeight: 'bold', marginBottom: 8 }}>Cliente: {cliente}</div>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Insumo</th>
                        <th>Unidade</th>
                        <th>Total estimado</th>
                        <th>Estoque</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insumos.map((row) => (
                        <tr key={row.itemCode}>
                          <td>{row.description}</td>
                          <td>{row.unidade}</td>
                          <td>{formatQty(row.totalQty)}</td>
                          <td>{formatQty(row.stock || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>

        {insumosByMachine.map((machine) => {
          const weeklyCapacity = machineWeeklyCapacity.find((row) => row.machineId === machine.machineId)
          const rangeCapacity = machineRangeCapacity.find((row) => row.machineId === machine.machineId)
          const expanded = expandedMachines[machine.machineId]
          const rangeInputs = rangeCapacity?.rangeInputs || {}
          const rangeInputRows = Object.entries(rangeInputs).map(([inputCode, qty]) => ({
            itemCode: inputCode,
            description: insumoDetailsByCode[inputCode]?.description || inputCode,
            unidade: insumoDetailsByCode[inputCode]?.unidade || '-',
            cliente: insumoDetailsByCode[inputCode]?.cliente || '-',
            qty,
          }))

          // Agrupar por cliente
          const rangeInputsByCliente = rangeInputRows.reduce((acc, row) => {
            const cliente = row.cliente || 'Sem cliente'
            if (!acc[cliente]) {
              acc[cliente] = []
            }
            acc[cliente].push(row)
            return acc
          }, {})
          return (
            <div className="card" key={machine.machineId} style={{ marginBottom: 16, padding: 16 }}>
              <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <strong>Máquina {machine.machineId}</strong>
                </div>
                <div className="small">
                  Estimativa para {filterLabel}: {formatQty(rangeCapacity?.rangePieces)} peças
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ minWidth: 110 }}
                  onClick={() => toggleMachineExpanded(machine.machineId)}
                >
                  {expanded ? 'Recolher ▾' : 'Expandir ▸'}
                </button>
              </div>

              <div className="sep"></div>

              {!expanded && (
                <>
                  {Object.keys(rangeInputsByCliente).length === 0 ? (
                    <div className="muted">Nenhuma estimativa de insumos disponível para este período.</div>
                  ) : (
                    Object.entries(rangeInputsByCliente).map(([cliente, insumos]) => (
                      <div key={cliente} style={{ marginBottom: 16 }}>
                        <div className="small" style={{ fontWeight: 'bold', marginBottom: 8 }}>Cliente: {cliente}</div>
                        <table style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th>Insumo</th>
                              <th>Unidade</th>
                              <th>Total estimado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {insumos.map((input) => (
                              <tr key={input.itemCode}>
                                <td>{input.description}</td>
                                <td>{input.unidade}</td>
                                <td>{formatQty(input.qty)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))
                  )}
                </>
              )}

              {expanded && (
                <>
                  {machine.orders.length === 0 ? (
                    <div className="muted">Sem ordens cadastradas nesta máquina.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {machine.orders.map((ordem) => (
                        <div key={ordem.id} className="card" style={{ padding: 12 }}>
                          <div className="flex" style={{ justifyContent: 'space-between', gap: 12 }}>
                            <div>
                              <div><strong>O.P.</strong> {ordem.code || ordem.id}</div>
                              <div className="small" style={{ marginTop: 8 }}>Produto: {ordem.productCode || '—'}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div><strong>Qtd.</strong> {formatQty(ordem.orderQty)}</div>
                              <button className="btn" style={{ marginTop: 8 }} onClick={() => openOrderSeparation(ordem)}>Separar</button>
                            </div>
                          </div>
                          <div className="small" style={{ marginTop: 8 }}>
                            Consumo total de insumos por O.P.:
                          </div>
                          {ordem.orderInputTotals.length === 0 ? (
                            <div className="muted">Nenhuma estrutura encontrada para este item.</div>
                          ) : (
                            (() => {
                              const insumosPorCliente = ordem.orderInputTotals.reduce((acc, input) => {
                                const cliente = input.cliente || 'Sem cliente'
                                if (!acc[cliente]) {
                                  acc[cliente] = []
                                }
                                acc[cliente].push(input)
                                return acc
                              }, {})

                              return Object.entries(insumosPorCliente).map(([cliente, insumos]) => (
                                <div key={cliente} style={{ marginBottom: 12 }}>
                                  <div className="small" style={{ fontWeight: 'bold', marginBottom: 4 }}>Cliente: {cliente}</div>
                                  <table style={{ width: '100%' }}>
                                    <thead>
                                      <tr>
                                        <th>Insumo</th>
                                        <th>Qtd. por peça</th>
                                        <th>Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {insumos.map((input) => {
                                        const info = insumoDetailsByCode[input.itemCode] || {}
                                        return (
                                          <tr key={input.itemCode}>
                                            <td>{info.description || input.itemCode}</td>
                                            <td>{formatQty(input.qtyPerPiece)}</td>
                                            <td>{formatQty(input.totalQty)}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ))
                            })()
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {weeklyCapacity && weeklyCapacity.weeklyPieces > 0 && (
                    <div className="small" style={{ marginTop: 12 }}>
                      Produção prevista com base no ciclo/cavidades: {formatQty(weeklyCapacity.piecesPerHour)} peças/hora — {formatQty(weeklyCapacity.weeklyPieces)} peças/semana.
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </>
    )
  }

  function handleSeparationSave() {
    Object.entries(separationInputs).forEach(([orderId, qty]) => {
      updateSeparation(orderId, separationModal.itemCode, qty)
    })
    setSeparationModal(null)
  }

  return (
    <>
      <div className="grid">
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div><h2>{viewMode === 'insumos' ? 'Visão de Insumos' : 'Programação e Fila'}</h2></div>
          <div className="flex" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {viewMode === 'insumos' && (
              <>
                <label className="label" style={{ margin: 0 }}>Período</label>
                <select
                  className="select"
                  value={insumosFilter}
                  onChange={(event) => setInsumosFilter(event.target.value)}
                >
                  <option value="today">Hoje</option>
                  <option value="tomorrow">Amanhã</option>
                  <option value="week">Esta Semana</option>
                  <option value="fortnight">Esta Quinzena</option>
                  <option value="month">Este Mês</option>
                  <option value="custom">Personalizado</option>
                </select>
                {insumosFilter === 'custom' && (
                  <>
                    <input
                      type="date"
                      className="input"
                      value={customFilterRange.start}
                      onChange={(event) => setCustomFilterRange((prev) => ({ ...prev, start: event.target.value }))}
                    />
                    <span className="small">até</span>
                    <input
                      type="date"
                      className="input"
                      value={customFilterRange.end}
                      onChange={(event) => setCustomFilterRange((prev) => ({ ...prev, end: event.target.value }))}
                    />
                  </>
                )}
              </>
            )}
            <button
              className={viewMode === 'insumos' ? 'btn primary' : 'btn ghost'}
              type="button"
              onClick={() => setViewMode((prev) => (prev === 'insumos' ? 'default' : 'insumos'))}
            >
              {viewMode === 'insumos' ? 'Voltar para fila' : 'Insumos'}
            </button>
          </div>
        </div>

        {viewMode === 'insumos' ? (
          renderInsumosView()
        ) : (
          <>
            <div className="tablehead"><div>MÁQUINA</div><div>PAINEL</div><div>FILA</div></div>

            {MAQUINAS .map((m) => {
          const lista = ativosPorMaquina[m] || []
          const ativa = lista[0] || null
          const fila  = lista.slice(1)
          const opCode = ativa?.code || ativa?.o?.code || ativa?.op_code || ""
          // lidas / saldo: usar mesma lógica do Painel
          const lidas = Number(ativa?.scanned_count || 0)
          const saldo = ativa ? Math.max(0, (Number(ativa.boxes) || 0) - lidas) : 0

          const productCode = String(ativa?.product || '').split('-')[0]?.trim()
          const itemTech = productCode ? itemTechByCode[productCode] : null
          const cycleSeconds = Number(itemTech?.cycleSeconds || 0)
          const cavities = Number(itemTech?.cavities || 0)

          const totalBoxes = toNumber(ativa?.boxes)
          const totalPieces = toNumber(ativa?.qty)
          const piecesPerBox = totalBoxes > 0 ? (totalPieces / totalBoxes) : 0
          const saldoPieces = saldo > 0 && piecesPerBox > 0 ? (saldo * piecesPerBox) : 0

          const piecesPerHour = cycleSeconds > 0 && cavities > 0
            ? (3600 / cycleSeconds) * cavities
            : 0

          const remainingHours = piecesPerHour > 0 && saldoPieces > 0
            ? (saldoPieces / piecesPerHour)
            : 0

          const previsaoFim = remainingHours > 0
            ? DateTime.now().setZone('America/Sao_Paulo').plus({ seconds: Math.round(remainingHours * 3600) })
            : null

          return (
            <div className="tableline" key={m}>
              <div className="cell-machine"><span className="badge">{m}</span></div>

              <div className="cell-painel">
                {ativa ? (
                  <div className={statusClass(ativa.status)}>
                    {opCode && (
                      <div className="hdr-right op-inline" style={{ marginBottom: 4, textAlign: 'left' }}>
                        O.P - {opCode}
                      </div>
                    )}
                    <Etiqueta
                      o={ativa}
                      variant="painel"
                      lidasCaixas={["P1","P2","P3","P4"].includes(m) ? lidas : undefined}
                      saldoCaixas={["P1","P2","P3","P4"].includes(m) ? saldo : undefined}
                    />
                    {previsaoFim && (
                      <div className="small" style={{ marginTop: 8 }}>
                        <b>Fim de O.P previsto:</b> {previsaoFim.toFormat('dd/LL/yyyy - HH:mm')}
                      </div>
                    )}
                    <div className="sep"></div>

                    <div className="grid2">
                      <div>
                        <div className="label">Situação (só painel)</div>
                        {(() => {
                          const precisaRegularizarSessao = Boolean(
                            ativa && String(ativa.status || '').toUpperCase() !== 'AGUARDANDO' && !ativa.active_session_id
                          )
                          return (
                        <select
                          className="select"
                          value={ativa.status}
                          onChange={e => onStatusChange(ativa, e.target.value)}
                          disabled={ativa.status === 'AGUARDANDO' || precisaRegularizarSessao}
                        >
                          {STATUS
                            .filter(s => (s === 'AGUARDANDO'
                              ? String(ativa?.status || '').toUpperCase() === 'AGUARDANDO'
                              : true))
                            .map(s => (
                              <option key={s} value={s}>
                                {s==='AGUARDANDO'?'Aguardando'
                                  : s==='PRODUZINDO'?'Produzindo'
                                  : s==='BAIXA_EFICIENCIA'?'Baixa Eficiência'
                                  : 'Parada'}
                              </option>
                            ))}
                        </select>
                          )
                        })()}
                        {Boolean(ativa && String(ativa.status || '').toUpperCase() !== 'AGUARDANDO' && !ativa.active_session_id) && (
                          <div className="small" style={{ marginTop: 6, color: '#b45309' }}>
                            Ordem sem sessão ativa. Regularize pelo botão de início.
                          </div>
                        )}
                      </div>

                      <div className="flex" style={{ justifyContent:'flex-end', gap:8 }}>
                        {ativa.status === 'AGUARDANDO' || Boolean(ativa && String(ativa.status || '').toUpperCase() !== 'AGUARDANDO' && !ativa.active_session_id) ? (
                          <>
                            <button className="btn" onClick={()=>{
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setStartModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
                            }}>{ativa && String(ativa.status || '').toUpperCase() !== 'AGUARDANDO' && !ativa.active_session_id ? 'Regularizar Produção' : 'Iniciar Produção'}</button>
                            {isAdmin && (
                              <button className="btn" onClick={() => setEditando(ativa)}>Editar</button>
                            )}
                            {/* 🚚 agora abre modal de confirmação */}
                            <button className="btn" onClick={() => abrirModalInterromper(ativa)}>Enviar para fila</button>
                          </>
                        ) : (
                          <>
                            <button className="btn" onClick={() => setFinalizando(ativa)}>Finalizar</button>
                            {isAdmin && (
                              <button className="btn" onClick={() => setEditando(ativa)}>Editar</button>
                            )}
                            {/* 🚚 agora abre modal de confirmação */}
                            <button className="btn" onClick={() => abrirModalInterromper(ativa)}>Enviar para fila</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="muted">Sem Programação</div>
                )}
              </div>

              <div className="cell-fila">
                {fila.length === 0 ? (
                  <div className="fila"><div className="muted">Sem itens na fila</div></div>
                ) : isAdmin ? (
                  <div className="fila-shell">
                    <DndContext
                      sensors={sensors}
                      onDragStart={(e) => {
                        const activeId = e?.active?.id
                        const dragged = fila.find((item) => item.id === activeId) || null
                        setDraggingOrder(dragged)
                      }}
                      onDragCancel={() => {
                        setDraggingOrder(null)
                      }}
                      onDragEnd={async (e) => {
                        try {
                          await moverNaFila(m, e)
                        } finally {
                          setDraggingOrder(null)
                        }
                      }}
                      collisionDetection={closestCenter}
                    >
                      <SortableContext items={fila.map(f => f.id)} strategy={horizontalListSortingStrategy}>
                        <div className="fila">
                          {fila.map(f => (
                            <FilaSortableItem
                              key={f.id}
                              ordem={f}
                              onEdit={() => setEditando(f)}
                              etiquetaVariant="fila"
                              highlightInterrompida={f.status === 'AGUARDANDO' && !!f.interrupted_at}
                              canReorder={true}
                              canEdit={isAdmin}
                              separationStatus={viewMode === 'insumos' ? getSeparationStatus(f, structuresByCode[extractProductCode(f.product)] || []) : 'none'}
                            />
                          ))}
                        </div>
                      </SortableContext>
                      <DragOverlay>
                        {draggingOrder ? (
                          <div className="card fila-item" style={{ minWidth: 260, opacity: 0.95 }}>
                            <div className="drag-handle" style={{ visibility: 'hidden' }}>⠿</div>
                            <div className="fila-content">
                              <Etiqueta o={draggingOrder} variant="fila" />
                            </div>
                          </div>
                        ) : null}
                      </DragOverlay>
                    </DndContext>
                  </div>
                ) : (
                  <div className="fila-shell">
                    <div className="fila">
                      {fila.map(f => (
                        <FilaSortableItem
                          key={f.id}
                          ordem={f}
                          onEdit={() => setEditando(f)}
                          etiquetaVariant="fila"
                          highlightInterrompida={f.status === 'AGUARDANDO' && !!f.interrupted_at}
                          canReorder={false}
                          canEdit={false}
                          separationStatus={viewMode === 'insumos' ? getSeparationStatus(f, structuresByCode[extractProductCode(f.product)] || []) : 'none'}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
          </>
        )}
      </div>

      {/* 🔶 Modal de separação de insumos */}
      {separationModal && (
        <Modal open={!!separationModal} onClose={() => setSeparationModal(null)}>
          <h3>Separação - O.P. {separationModal.ordem?.code || separationModal.ordem?.id}</h3>
          <div style={{ marginBottom: 16 }}>
            <strong>Produto:</strong> {separationModal.ordem?.product || '—'}<br />
            <strong>Quantidade O.P.:</strong> {formatQty(separationModal.ordem?.orderQty)}
          </div>
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Insumo</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Qtd. por peça</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Total estimado</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Separado</th>
                </tr>
              </thead>
              <tbody>
                {(separationModal.ordem?.orderInputTotals || []).map((input) => {
                  const separatedQty = Number(separationInputs[input.itemCode] || 0)
                  return (
                    <tr key={input.itemCode} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '8px' }}>{input.description || input.itemCode}</td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>{formatQty(input.qtyPerPiece)}</td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>{formatQty(input.totalQty)}</td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        <input
                          type="number"
                          step="0.01"
                          value={separatedQty}
                          onChange={(e) => setSeparationInputs((prev) => ({ ...prev, [input.itemCode]: e.target.value }))}
                          style={{ width: 90 }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleSeparationSave}>Salvar</button>
            <button className="btn secondary" onClick={() => setSeparationModal(null)}>Cancelar</button>
          </div>
        </Modal>
      )}

      {/* 🔶 Modal de confirmação de interrupção */}
      <Modal
        open={!!confirmInt}
        onClose={() => { if (!confirmIntSavingRef.current) setConfirmInt(null) }}
        title={confirmInt ? `Tem certeza que deseja interromper a produção?` : ''}
        closeOnBackdrop={!confirmIntSaving}
      >
        {confirmInt && (
          <div className="grid">
            <div><div className="label">Operador *</div>
              <input className="input" value={confirmInt.operador}
                     disabled={confirmIntSaving}
                     onChange={e=>setConfirmInt(v=>({...v, operador:e.target.value}))}
                     placeholder="Nome do operador"/>
            </div>
            <div className="grid2">
              <div><div className="label">Data *</div>
                <input type="date" className="input" value={confirmInt.data}
                       disabled={confirmIntSaving}
                       onChange={e=>setConfirmInt(v=>({...v, data:e.target.value}))}/>
              </div>
              <div><div className="label">Hora *</div>
                <input type="time" className="input" value={confirmInt.hora}
                       disabled={confirmIntSaving}
                       onChange={e=>setConfirmInt(v=>({...v, hora:e.target.value}))}/>
              </div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setConfirmInt(null)} disabled={confirmIntSaving}>Cancelar</button>
              <button className="btn primary" onClick={confirmarInterromper} disabled={confirmIntSaving}>{confirmIntSaving ? 'Confirmando...' : 'Confirmar'}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
