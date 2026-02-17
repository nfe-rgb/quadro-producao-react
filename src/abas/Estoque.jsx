import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtDateTime } from '../lib/utils'
import Modal from '../components/Modal'
import '../styles/estoque.css'

const TABS = [
  { id: 'inventario', label: 'Inventário' },
  { id: 'requisicao', label: 'Requisição' },
  { id: 'retorno', label: 'Retorno' },
  { id: 'compras', label: 'Compras' },
]

const STORAGE_PURCHASES_KEY = 'estoque_compras_v1'
const STORAGE_REQUISITIONS_KEY = 'estoque_requisicoes_v1'
const STORAGE_RETURNS_KEY = 'estoque_retornos_v1'

const nowIsoDate = () => new Date().toISOString().slice(0, 10)

const readStoredRows = (key) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeStoredRows = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []))
  } catch {
    // silencioso para evitar travar UI em ambiente sem storage
  }
}

const toPositiveNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const normalize = (value) => String(value ?? '').trim()
const isFinishedProductCode = (code) => normalize(code).startsWith('5')

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto?.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

function sortByFifoDate(a, b) {
  const aDate = new Date(a?.date || a?.createdAt || 0).getTime()
  const bDate = new Date(b?.date || b?.createdAt || 0).getTime()
  if (aDate !== bDate) return aDate - bDate
  const aCreated = new Date(a?.createdAt || 0).getTime()
  const bCreated = new Date(b?.createdAt || 0).getTime()
  return aCreated - bCreated
}

function sortByLatest(a, b) {
  const aDate = new Date(a?.createdAt || a?.date || 0).getTime()
  const bDate = new Date(b?.createdAt || b?.date || 0).getTime()
  return bDate - aDate
}

const formatMoney = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatQty = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

const emptyPurchaseForm = {
  date: nowIsoDate(),
  invoiceNumber: '',
  itemCode: '',
  product: '',
  client: '',
  quantity: '',
  unitValue: '',
}

const emptyRequisitionForm = {
  itemCode: '',
  op: '',
  client: '',
  quantity: '',
}

const emptyReturnForm = {
  op: '',
  itemCode: '',
  itemDescription: '',
  quantity: '',
}

export default function Estoque() {
  const didLegacyReturnMigrationRef = useRef(false)
  const [tab, setTab] = useState('inventario')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPurchaseForm, setShowPurchaseForm] = useState(false)
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm)
  const [requisitionForm, setRequisitionForm] = useState(emptyRequisitionForm)
  const [purchaseError, setPurchaseError] = useState('')
  const [requisitionError, setRequisitionError] = useState('')
  const [requisitionInfo, setRequisitionInfo] = useState('')
  const [returnForm, setReturnForm] = useState(emptyReturnForm)
  const [returnError, setReturnError] = useState('')
  const [returnInfo, setReturnInfo] = useState('')
  const [usageModal, setUsageModal] = useState({ open: false, purchase: null, rows: [] })
  const [purchases, setPurchases] = useState(() => readStoredRows(STORAGE_PURCHASES_KEY))
  const [requisitions, setRequisitions] = useState(() => readStoredRows(STORAGE_REQUISITIONS_KEY))
  const [returns, setReturns] = useState(() => readStoredRows(STORAGE_RETURNS_KEY))

  useEffect(() => {
    fetchItems()
  }, [])

  useEffect(() => {
    writeStoredRows(STORAGE_PURCHASES_KEY, purchases)
  }, [purchases])

  useEffect(() => {
    writeStoredRows(STORAGE_REQUISITIONS_KEY, requisitions)
  }, [requisitions])

  useEffect(() => {
    writeStoredRows(STORAGE_RETURNS_KEY, returns)
  }, [returns])

  function buildReturnAllocationPlan(op, itemCode, quantity, returnsBase = []) {
    const matchingRequisitions = [...(requisitions || [])]
      .filter((req) => normalize(req?.op) === op && normalize(req?.itemCode) === itemCode)
      .sort((a, b) => {
        const aDate = new Date(a?.createdAt || 0).getTime()
        const bDate = new Date(b?.createdAt || 0).getTime()
        return aDate - bDate
      })

    if (matchingRequisitions.length === 0) {
      return { ok: false, error: 'Nenhuma requisição encontrada para esta O.P e item.' }
    }

    const returnedByReqAlloc = {}
    ;(returnsBase || []).forEach((ret) => {
      ;(ret?.allocations || []).forEach((allocation) => {
        const reqId = normalize(allocation?.requisitionId)
        const purchaseId = normalize(allocation?.purchaseId)
        const returnedQty = Number(allocation?.returnedQty)
        if (!reqId || !purchaseId || !Number.isFinite(returnedQty) || returnedQty <= 0) return
        const key = `${reqId}::${purchaseId}`
        returnedByReqAlloc[key] = (returnedByReqAlloc[key] || 0) + returnedQty
      })
    })

    const returnableAllocations = []
    matchingRequisitions.forEach((req) => {
      ;(req?.allocations || []).forEach((allocation) => {
        const reqId = normalize(req?.id)
        const purchaseId = normalize(allocation?.purchaseId)
        const usedQty = Number(allocation?.usedQty)
        if (!reqId || !purchaseId || !Number.isFinite(usedQty) || usedQty <= 0) return
        const key = `${reqId}::${purchaseId}`
        const alreadyReturned = Number(returnedByReqAlloc[key] || 0)
        const availableToReturn = Math.max(0, usedQty - alreadyReturned)
        if (availableToReturn <= 0) return
        returnableAllocations.push({
          requisitionId: reqId,
          purchaseId,
          invoiceNumber: allocation?.invoiceNumber,
          availableToReturn,
        })
      })
    })

    const totalReturnable = returnableAllocations.reduce((sum, row) => sum + row.availableToReturn, 0)
    if (totalReturnable < quantity) {
      return {
        ok: false,
        error: `Quantidade retornada excede o consumido da O.P. Disponível para retorno: ${formatQty(totalReturnable)}.`
      }
    }

    let remainingReturn = quantity
    const allocationsApplied = []
    for (const row of returnableAllocations) {
      if (remainingReturn <= 0) break
      const appliedQty = Math.min(row.availableToReturn, remainingReturn)
      if (appliedQty <= 0) continue
      allocationsApplied.push({
        requisitionId: row.requisitionId,
        purchaseId: row.purchaseId,
        invoiceNumber: row.invoiceNumber,
        returnedQty: appliedQty,
      })
      remainingReturn -= appliedQty
    }

    return { ok: true, allocations: allocationsApplied }
  }

  useEffect(() => {
    if (didLegacyReturnMigrationRef.current) return
    if (!Array.isArray(purchases) || !Array.isArray(returns) || !Array.isArray(requisitions)) return

    const legacyPurchases = purchases.filter((row) => row?.origin === 'return')
    if (legacyPurchases.length === 0) {
      didLegacyReturnMigrationRef.current = true
      return
    }

    let nextPurchases = [...purchases]
    let nextReturns = [...returns]
    let migratedCount = 0

    for (const legacy of legacyPurchases) {
      const legacyPurchaseId = normalize(legacy?.id)
      if (!legacyPurchaseId) continue

      const usedInReq = (requisitions || []).some((req) =>
        (req?.allocations || []).some((allocation) => normalize(allocation?.purchaseId) === legacyPurchaseId)
      )
      if (usedInReq) continue

      const op = normalize(legacy?.returnOp)
      const itemCode = normalize(legacy?.itemCode)
      const quantity = toPositiveNumber(legacy?.quantity)
      if (!op || !itemCode || !quantity) continue

      const plan = buildReturnAllocationPlan(op, itemCode, quantity, nextReturns)
      if (!plan?.ok) continue

      const addMap = new Map()
      ;(plan.allocations || []).forEach((allocation) => {
        const pid = normalize(allocation?.purchaseId)
        const q = Number(allocation?.returnedQty)
        if (!pid || !Number.isFinite(q) || q <= 0) return
        addMap.set(pid, (addMap.get(pid) || 0) + q)
      })

      nextPurchases = nextPurchases
        .map((purchase) => {
          const pid = normalize(purchase?.id)
          if (!addMap.has(pid)) return purchase
          const currentBalance = Number(purchase?.balance)
          const nextBalance = Number.isFinite(currentBalance)
            ? currentBalance + Number(addMap.get(pid) || 0)
            : Number(addMap.get(pid) || 0)
          return { ...purchase, balance: nextBalance }
        })
        .filter((purchase) => normalize(purchase?.id) !== legacyPurchaseId)

      const sameReturnIdx = nextReturns.findIndex((ret) => {
        if (Array.isArray(ret?.allocations) && ret.allocations.length > 0) return false
        return normalize(ret?.op) === op && normalize(ret?.itemCode) === itemCode && Number(ret?.quantity) === Number(quantity)
      })

      if (sameReturnIdx >= 0) {
        nextReturns[sameReturnIdx] = {
          ...nextReturns[sameReturnIdx],
          allocations: plan.allocations,
        }
      } else {
        const fallbackItemDesc = normalize(
          (items || []).find((it) => normalize(it?.code) === itemCode)?.description || itemCode
        )

        nextReturns = [
          {
            id: makeId(),
            op,
            itemCode,
            itemDescription: normalize(legacy?.product || fallbackItemDesc),
            quantity,
            createdAt: legacy?.createdAt || new Date().toISOString(),
            allocations: plan.allocations,
          },
          ...nextReturns,
        ]
      }

      migratedCount += 1
    }

    if (migratedCount > 0) {
      setPurchases(nextPurchases)
      setReturns(nextReturns)
      setReturnInfo(`Ajuste automático aplicado em ${migratedCount} lançamento(s) antigo(s) de retorno.`)
    }

    didLegacyReturnMigrationRef.current = true
  }, [purchases, returns, requisitions, items])

  async function fetchItems() {
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await supabase
        .from('items')
        .select('*')
        .order('code', { ascending: true })

      if (queryError) throw queryError
      setItems(data || [])
    } catch (err) {
      setItems([])
      setError(err?.message || 'Não foi possível carregar os insumos.')
    } finally {
      setLoading(false)
    }
  }

  const itemByCode = useMemo(() => {
    const map = {}
    ;(items || []).forEach((item) => {
      const code = normalize(item?.code)
      if (!code) return
      map[code] = item
    })
    return map
  }, [items])

  const purchasableItems = useMemo(
    () => (items || []).filter((item) => !isFinishedProductCode(item?.code)),
    [items]
  )

  const purchaseBalanceByCode = useMemo(() => {
    const acc = {}
    ;(purchases || []).forEach((row) => {
      const code = normalize(row?.itemCode)
      const balance = Number(row?.balance)
      if (!code || !Number.isFinite(balance) || balance <= 0) return
      acc[code] = (acc[code] || 0) + balance
    })
    return acc
  }, [purchases])

  const inventoryRows = useMemo(() => {
    const list = Array.isArray(items) ? items : []

    return list
      .filter((item) => {
        const code = String(item?.code || '').trim()
        if (!code) return false
        return !code.startsWith('5')
      })
      .map((item) => {
        const code = normalize(item?.code)
        const stockFromPurchase = purchaseBalanceByCode[code]
        const stockValue = Number.isFinite(stockFromPurchase)
          ? stockFromPurchase
          : (item.estoque ?? item.stock ?? item.estoque_atual ?? null)
        const minValue = item.estoque_minimo ?? item.minimo ?? item.min_stock ?? null
        const stockNum = Number(stockValue)
        const minNum = Number(minValue)
        const hasStock = Number.isFinite(stockNum)
        const hasMin = Number.isFinite(minNum)
        const status = hasStock && hasMin
          ? (stockNum <= minNum ? 'Baixo' : 'OK')
          : '-'

        return {
        id: item.id,
        itemCode: code,
        product: item.description,
        client: item.cliente || item.client || '-',
        stock: hasStock ? stockNum : '-',
        min: hasMin ? minNum : '-',
        status,
        updatedAt: item.created_at ? fmtDateTime(item.created_at) : '-',
        }
      })
  }, [items, purchaseBalanceByCode])

  const purchaseRows = useMemo(
    () => [...(purchases || [])].sort(sortByLatest).slice(0, 30),
    [purchases]
  )

  const requisitionRows = useMemo(
    () => [...(requisitions || [])].sort(sortByLatest).slice(0, 20),
    [requisitions]
  )

  const returnRows = useMemo(
    () => [...(returns || [])].sort(sortByLatest).slice(0, 30),
    [returns]
  )

  const purchaseHistoryIds = useMemo(() => {
    const set = new Set()

    ;(requisitions || []).forEach((req) => {
      ;(req?.allocations || []).forEach((allocation) => {
        const purchaseId = normalize(allocation?.purchaseId)
        if (purchaseId) set.add(purchaseId)
      })
    })

    ;(returns || []).forEach((ret) => {
      ;(ret?.allocations || []).forEach((allocation) => {
        const purchaseId = normalize(allocation?.purchaseId)
        if (purchaseId) set.add(purchaseId)
      })
    })

    return set
  }, [requisitions, returns])

  const requisitionCodeOptions = useMemo(() => {
    const set = new Set()
    ;(purchases || []).forEach((row) => {
      const code = normalize(row?.itemCode)
      const balance = Number(row?.balance)
      if (!code || !Number.isFinite(balance) || balance <= 0) return
      set.add(code)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [purchases])

  function handlePurchaseFieldChange(e) {
    const { name, value } = e.target

    setPurchaseForm((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'itemCode') {
        const code = normalize(value)
        const source = itemByCode[code]
        if (source) {
          next.product = normalize(source.description)
          next.client = normalize(source.cliente || source.client)
        }
      }
      return next
    })
  }

  function resetPurchaseForm() {
    setPurchaseForm({ ...emptyPurchaseForm, date: nowIsoDate() })
    setPurchaseError('')
  }

  function handlePurchaseSubmit(e) {
    e.preventDefault()
    setPurchaseError('')

    const date = normalize(purchaseForm.date) || nowIsoDate()
    const invoiceNumber = normalize(purchaseForm.invoiceNumber)
    const itemCode = normalize(purchaseForm.itemCode)
    const product = normalize(purchaseForm.product)
    const client = normalize(purchaseForm.client)
    const quantity = toPositiveNumber(purchaseForm.quantity)
    const unitValue = toPositiveNumber(purchaseForm.unitValue)

    if (!invoiceNumber) {
      setPurchaseError('Informe a Nota Fiscal.')
      return
    }
    if (!itemCode) {
      setPurchaseError('Informe o código do item.')
      return
    }
    if (isFinishedProductCode(itemCode)) {
      setPurchaseError('Produto acabado (código iniciado por 5) não pode ser lançado em compras.')
      return
    }
    if (!product) {
      setPurchaseError('Informe o produto.')
      return
    }
    if (!client) {
      setPurchaseError('Informe o cliente.')
      return
    }
    if (!quantity) {
      setPurchaseError('Quantidade deve ser maior que zero.')
      return
    }
    if (!unitValue) {
      setPurchaseError('Valor unitário deve ser maior que zero.')
      return
    }

    const row = {
      id: makeId(),
      date,
      invoiceNumber,
      itemCode,
      product,
      client,
      quantity,
      unitValue,
      balance: quantity,
      createdAt: new Date().toISOString(),
    }

    setPurchases((prev) => [row, ...(prev || [])])
    resetPurchaseForm()
    setShowPurchaseForm(false)
  }

  function handleRequisitionFieldChange(e) {
    const { name, value } = e.target
    setRequisitionForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleReturnFieldChange(e) {
    const { name, value } = e.target
    setReturnForm((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'itemCode') {
        const code = normalize(value)
        const source = itemByCode[code]
        if (source) {
          next.itemDescription = normalize(source.description)
        }
      }
      return next
    })
  }

  function handleReturnSubmit(e) {
    e.preventDefault()
    setReturnError('')
    setReturnInfo('')

    const op = normalize(returnForm.op)
    const itemCode = normalize(returnForm.itemCode)
    const typedDescription = normalize(returnForm.itemDescription)
    const quantity = toPositiveNumber(returnForm.quantity)

    if (!op) {
      setReturnError('Informe a O.P do retorno.')
      return
    }
    if (!itemCode) {
      setReturnError('Informe o item do retorno.')
      return
    }
    if (isFinishedProductCode(itemCode)) {
      setReturnError('Produto acabado (código iniciado por 5) não pode ser lançado em retorno de material.')
      return
    }
    if (!quantity) {
      setReturnError('Quantidade retornada deve ser maior que zero.')
      return
    }

    const sourceItem = itemByCode[itemCode]

    const plan = buildReturnAllocationPlan(op, itemCode, quantity, returns)
    if (!plan?.ok) {
      setReturnError(plan?.error || 'Não foi possível calcular o retorno para as NFs originais.')
      return
    }

    const allocationsApplied = plan.allocations || []
    const purchaseBalanceAddMap = new Map()
    allocationsApplied.forEach((row) => {
      const pid = normalize(row?.purchaseId)
      const q = Number(row?.returnedQty)
      if (!pid || !Number.isFinite(q) || q <= 0) return
      purchaseBalanceAddMap.set(pid, (purchaseBalanceAddMap.get(pid) || 0) + q)
    })

    const product = normalize(
      typedDescription || sourceItem?.description || itemCode
    )

    const returnRow = {
      id: makeId(),
      op,
      itemCode,
      itemDescription: product,
      quantity,
      createdAt: new Date().toISOString(),
      allocations: allocationsApplied,
    }

    setReturns((prev) => [returnRow, ...(prev || [])])
    setPurchases((prev) =>
      (prev || []).map((purchase) => {
        const currentId = normalize(purchase?.id)
        if (!purchaseBalanceAddMap.has(currentId)) return purchase
        const currentBalance = Number(purchase?.balance)
        const nextBalance = Number.isFinite(currentBalance)
          ? currentBalance + Number(purchaseBalanceAddMap.get(currentId) || 0)
          : Number(purchaseBalanceAddMap.get(currentId) || 0)
        return { ...purchase, balance: nextBalance }
      })
    )
    setReturnForm(emptyReturnForm)
    setReturnInfo(`Retorno lançado com sucesso na(s) NF(s) original(is): ${allocationsApplied.length}.`)
  }

  function handleRequisitionSubmit(e) {
    e.preventDefault()
    setRequisitionError('')
    setRequisitionInfo('')

    const itemCode = normalize(requisitionForm.itemCode)
    const op = normalize(requisitionForm.op)
    const client = normalize(requisitionForm.client)
    const qtyRequested = toPositiveNumber(requisitionForm.quantity)

    if (!itemCode) {
      setRequisitionError('Informe o código do item para requisitar.')
      return
    }

    if (!qtyRequested) {
      setRequisitionError('Quantidade da requisição deve ser maior que zero.')
      return
    }

    if (!op) {
      setRequisitionError('Informe a O.P da requisição.')
      return
    }

    if (!client) {
      setRequisitionError('Informe o cliente da requisição.')
      return
    }

    const availableRows = [...(purchases || [])]
      .filter((row) => {
        const sameCode = normalize(row?.itemCode) === itemCode
        const balance = Number(row?.balance)
        return sameCode && Number.isFinite(balance) && balance > 0
      })
      .sort(sortByFifoDate)

    const availableTotal = availableRows.reduce((sum, row) => sum + Number(row.balance || 0), 0)

    if (availableTotal < qtyRequested) {
      setRequisitionError(
        `Estoque insuficiente para ${itemCode}. Disponível: ${formatQty(availableTotal)}.`
      )
      return
    }

    let remaining = qtyRequested
    const allocationMap = new Map()
    const allocations = []

    for (const row of availableRows) {
      if (remaining <= 0) break
      const currentBalance = Number(row.balance || 0)
      if (currentBalance <= 0) continue

      const usedQty = Math.min(currentBalance, remaining)
      const nextBalance = currentBalance - usedQty

      allocationMap.set(row.id, nextBalance)
      allocations.push({
        purchaseId: row.id,
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        usedQty,
        balanceAfter: nextBalance,
      })
      remaining -= usedQty
    }

    setPurchases((prev) =>
      (prev || []).map((row) => {
        if (!allocationMap.has(row.id)) return row
        return { ...row, balance: allocationMap.get(row.id) }
      })
    )

    const req = {
      id: makeId(),
      itemCode,
      op,
      client,
      quantity: qtyRequested,
      createdAt: new Date().toISOString(),
      allocations,
    }

    setRequisitions((prev) => [req, ...(prev || [])])
    setRequisitionForm(emptyRequisitionForm)
    setRequisitionInfo(
      `Requisição concluída via FIFO. Consumo em ${allocations.length} nota(s) fiscal(is).`
    )
  }

  function openUsageModal(purchaseRow) {
    if (!purchaseRow) return
    const rows = []
    ;(requisitions || []).forEach((req) => {
      const reqDate = req?.createdAt || null
      const reqOp = normalize(req?.op)
      const reqClient = normalize(req?.client)
      ;(req?.allocations || []).forEach((allocation) => {
        if (allocation?.purchaseId !== purchaseRow.id) return
        rows.push({
          id: `${req.id}-${allocation.purchaseId}-${allocation.invoiceNumber}-${allocation.usedQty}`,
          requisitionDate: reqDate,
          op: reqOp,
          client: reqClient,
          qty: Number(allocation?.usedQty) || 0,
          movementType: 'utilizacao',
        })
      })
    })

    ;(returns || []).forEach((ret) => {
      const retDate = ret?.createdAt || null
      const retOp = normalize(ret?.op)
      ;(ret?.allocations || []).forEach((allocation) => {
        if (allocation?.purchaseId !== purchaseRow.id) return
        rows.push({
          id: `${ret.id}-${allocation.purchaseId}-${allocation.invoiceNumber}-${allocation.returnedQty}`,
          requisitionDate: retDate,
          op: retOp,
          client: 'RETORNO',
          qty: Number(allocation?.returnedQty) || 0,
          movementType: 'retorno',
        })
      })
    })

    rows.sort((a, b) => {
      const aDate = new Date(a?.requisitionDate || 0).getTime()
      const bDate = new Date(b?.requisitionDate || 0).getTime()
      return bDate - aDate
    })

    setUsageModal({ open: true, purchase: purchaseRow, rows })
  }

  return (
    <div className="estoque-page">
      <div className="estoque-header">
        <div>
          <h2 className="estoque-title">Controle de Insumos</h2>
          <p className="estoque-sub">Inventário, requisição FIFO, retorno e compras por Nota Fiscal.</p>
        </div>
      </div>

      <div className="estoque-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`estoque-tabbtn ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'inventario' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Inventário</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pill">{inventoryRows.length} insumos</span>
              <button className="btn ghost" onClick={fetchItems} disabled={loading}>
                {loading ? 'Atualizando…' : 'Atualizar'}
              </button>
            </div>
          </div>
          {error && <div className="estoque-alert">{error}</div>}
          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Cliente</th>
                  <th>Estoque</th>
                  <th>Mínimo</th>
                  <th>Situação</th>
                  <th>Última atualização</th>
                </tr>
              </thead>
              <tbody>
                {inventoryRows.length === 0 && (
                  <tr>
                    <td colSpan="7" className="estoque-empty">
                      {loading ? 'Carregando insumos…' : 'Nenhum insumo encontrado no cadastro de itens.'}
                    </td>
                  </tr>
                )}
                {inventoryRows.map((row) => (
                  <tr key={row.id || row.itemCode}>
                    <td>{row.itemCode || '-'}</td>
                    <td>{row.product || '-'}</td>
                    <td>{row.client || '-'}</td>
                    <td>{row.stock ?? '-'}</td>
                    <td>{row.min ?? '-'}</td>
                    <td>{row.status || '-'}</td>
                    <td>{row.updatedAt || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'requisicao' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Requisição</h3>
          </div>

          <form className="estoque-form" onSubmit={handleRequisitionSubmit}>
            <div className="estoque-form-grid">
              <label>
                Cod Item
                <input
                  name="itemCode"
                  value={requisitionForm.itemCode}
                  onChange={handleRequisitionFieldChange}
                  list="requisicao-codes"
                  placeholder="Ex.: 40123"
                />
                <datalist id="requisicao-codes">
                  {requisitionCodeOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </label>

              <label>
                O.P
                <input
                  name="op"
                  value={requisitionForm.op}
                  onChange={handleRequisitionFieldChange}
                  placeholder="Ex.: OP-24010"
                />
              </label>

              <label>
                Cliente
                <input
                  name="client"
                  value={requisitionForm.client}
                  onChange={handleRequisitionFieldChange}
                  placeholder="Cliente"
                />
              </label>

              <label>
                Quantidade
                <input
                  name="quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={requisitionForm.quantity}
                  onChange={handleRequisitionFieldChange}
                  placeholder="Ex.: 25"
                />
              </label>
            </div>

            <div className="estoque-form-actions">
              <button className="btn primary" type="submit">Requisitar (FIFO)</button>
            </div>
          </form>

          {requisitionError && <div className="estoque-alert">{requisitionError}</div>}
          {requisitionInfo && <div className="estoque-alert">{requisitionInfo}</div>}

          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>O.P</th>
                  <th>Cod Item</th>
                  <th>Quantidade</th>
                  <th>Notas consumidas (FIFO)</th>
                </tr>
              </thead>
              <tbody>
                {requisitionRows.length === 0 && (
                  <tr>
                    <td colSpan="5" className="estoque-empty">
                      Nenhuma requisição registrada.
                    </td>
                  </tr>
                )}

                {requisitionRows.map((row) => {
                  const notesText = (row.allocations || [])
                    .map((a) => `${a.invoiceNumber}: ${formatQty(a.usedQty)}`)
                    .join(' • ')

                  return (
                    <tr key={row.id}>
                      <td>{fmtDateTime(row.createdAt) || '-'}</td>
                      <td>{row.op || '-'}</td>
                      <td>{row.itemCode || '-'}</td>
                      <td>{formatQty(row.quantity)}</td>
                      <td>{notesText || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'retorno' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Retorno</h3>
          </div>

          <form className="estoque-form" onSubmit={handleReturnSubmit}>
            <div className="estoque-form-grid">
              <label>
                O.P
                <input
                  name="op"
                  value={returnForm.op}
                  onChange={handleReturnFieldChange}
                  placeholder="Ex.: OP-24010"
                />
              </label>

              <label>
                Item
                <input
                  name="itemCode"
                  value={returnForm.itemCode}
                  onChange={handleReturnFieldChange}
                  list="retorno-codes"
                  placeholder="Ex.: 40123"
                />
                <datalist id="retorno-codes">
                  {purchasableItems.map((item) => {
                    const code = normalize(item?.code)
                    if (!code) return null
                    return <option key={code} value={code} />
                  })}
                </datalist>
              </label>

              <label>
                Descrição Item
                <input
                  name="itemDescription"
                  value={returnForm.itemDescription}
                  onChange={handleReturnFieldChange}
                  placeholder="Descrição do item"
                />
              </label>

              <label>
                Quantidade retornada
                <input
                  name="quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={returnForm.quantity}
                  onChange={handleReturnFieldChange}
                  placeholder="Ex.: 3.5"
                />
              </label>
            </div>

            <div className="estoque-form-actions">
              <button className="btn primary" type="submit">Lançar retorno</button>
            </div>
          </form>

          {returnError && <div className="estoque-alert">{returnError}</div>}
          {returnInfo && <div className="estoque-alert">{returnInfo}</div>}

          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>O.P</th>
                  <th>Item</th>
                  <th>Descrição Item</th>
                  <th>Quantidade retornada</th>
                </tr>
              </thead>
              <tbody>
                {returnRows.length === 0 && (
                  <tr>
                    <td colSpan="5" className="estoque-empty">Nenhum retorno registrado.</td>
                  </tr>
                )}
                {returnRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt ? fmtDateTime(row.createdAt) : '-'}</td>
                    <td>{row.op || '-'}</td>
                    <td>{row.itemCode || '-'}</td>
                    <td>{row.itemDescription || '-'}</td>
                    <td>{formatQty(row.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'compras' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Compras</h3>
            <button
              className="btn primary"
              onClick={() => {
                setShowPurchaseForm((prev) => !prev)
                setPurchaseError('')
              }}
              type="button"
            >
              {showPurchaseForm ? 'Fechar entrada' : 'Nova entrada (NF)'}
            </button>
          </div>

          {showPurchaseForm && (
            <form className="estoque-form" onSubmit={handlePurchaseSubmit}>
              <div className="estoque-form-grid">
                <label>
                  Data
                  <input
                    name="date"
                    type="date"
                    value={purchaseForm.date}
                    onChange={handlePurchaseFieldChange}
                  />
                </label>

                <label>
                  Nota Fiscal
                  <input
                    name="invoiceNumber"
                    value={purchaseForm.invoiceNumber}
                    onChange={handlePurchaseFieldChange}
                    placeholder="Ex.: 000123"
                  />
                </label>

                <label>
                  Cod Item
                  <input
                    name="itemCode"
                    value={purchaseForm.itemCode}
                    onChange={handlePurchaseFieldChange}
                    placeholder="Ex.: 40123"
                    list="compras-codes"
                  />
                  <datalist id="compras-codes">
                    {purchasableItems.map((item) => {
                      const code = normalize(item?.code)
                      if (!code) return null
                      return <option key={code} value={code} />
                    })}
                  </datalist>
                </label>

                <label>
                  Produto
                  <input
                    name="product"
                    value={purchaseForm.product}
                    onChange={handlePurchaseFieldChange}
                    placeholder="Descrição do item"
                  />
                </label>

                <label>
                  Cliente
                  <input
                    name="client"
                    value={purchaseForm.client}
                    onChange={handlePurchaseFieldChange}
                    placeholder="Cliente"
                  />
                </label>

                <label>
                  Quantidade
                  <input
                    name="quantity"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={purchaseForm.quantity}
                    onChange={handlePurchaseFieldChange}
                    placeholder="Ex.: 15"
                  />
                </label>

                <label>
                  Valor unitário
                  <input
                    name="unitValue"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={purchaseForm.unitValue}
                    onChange={handlePurchaseFieldChange}
                    placeholder="Ex.: 9.80"
                  />
                </label>
              </div>

              <div className="estoque-form-actions" style={{ gap: 8 }}>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    resetPurchaseForm()
                    setShowPurchaseForm(false)
                  }}
                >
                  Cancelar
                </button>
                <button className="btn primary" type="submit">Dar entrada</button>
              </div>
            </form>
          )}

          {purchaseError && <div className="estoque-alert">{purchaseError}</div>}

          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Nota Fiscal</th>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Cliente</th>
                  <th>Quantidade</th>
                  <th>Valor unitário</th>
                  <th>Saldo</th>
                  <th>Entregue</th>
                </tr>
              </thead>
              <tbody>
                {purchaseRows.length === 0 && (
                  <tr>
                    <td colSpan="9" className="estoque-empty">
                      Nenhuma compra registrada.
                    </td>
                  </tr>
                )}

                {purchaseRows.map((row) => {
                  const quantityNum = Number(row?.quantity)
                  const balanceNum = Number(row?.balance)
                  const usedQty = Number.isFinite(quantityNum) && Number.isFinite(balanceNum)
                    ? Math.max(0, quantityNum - balanceNum)
                    : null
                  const hasUsage = Number(usedQty) > 0
                  const hasHistory = purchaseHistoryIds.has(normalize(row?.id))

                  return (
                    <tr key={row.id}>
                      <td>{row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '-'}</td>
                      <td>{row.invoiceNumber || '-'}</td>
                      <td>{row.itemCode || '-'}</td>
                      <td>{row.product || '-'}</td>
                      <td>{row.client || '-'}</td>
                      <td>{formatQty(row.quantity)}</td>
                      <td>R$ {formatMoney(row.unitValue)}</td>
                      <td>{formatQty(row.balance)}</td>
                      <td>
                        {hasHistory || hasUsage ? (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => openUsageModal(row)}
                            style={{ padding: '4px 8px' }}
                          >
                            {formatQty(usedQty)}
                          </button>
                        ) : (
                          formatQty(usedQty)
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={usageModal.open}
        onClose={() => setUsageModal({ open: false, purchase: null, rows: [] })}
        title={usageModal?.purchase ? `Material utilizado em • NF ${usageModal.purchase.invoiceNumber}` : 'Material utilizado em'}
      >
        <div className="estoque-table-wrap">
          <table className="estoque-table">
            <thead>
              <tr>
                <th>Data Requisição</th>
                <th>O.P</th>
                <th>Cliente</th>
                <th>Movimento</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {usageModal.rows.length === 0 && (
                <tr>
                  <td colSpan="5" className="estoque-empty">Nenhum consumo/retorno registrado para esta nota.</td>
                </tr>
              )}
              {usageModal.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.requisitionDate ? fmtDateTime(row.requisitionDate) : '-'}</td>
                  <td>{row.op || '-'}</td>
                  <td>{row.client || '-'}</td>
                  <td>{row.movementType === 'retorno' ? 'Retorno' : 'Utilização'}</td>
                  <td>{formatQty(row.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  )
}
