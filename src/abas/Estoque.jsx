import { useEffect, useMemo, useState } from 'react'
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
const MANUAL_PURCHASE_INVOICE = 'Lançamento Manual'

const nowIsoDate = () => new Date().toISOString().slice(0, 10)

const toPositiveNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const normalize = (value) => String(value ?? '').trim()
const normalizeClientValue = (value) => normalize(value).toLowerCase()
const isUnitUN = (value) => normalize(value).toUpperCase() === 'UN'
const matchesAllowedClient = (value, allowedClientNormalized) => {
  if (!allowedClientNormalized) return true
  return normalizeClientValue(value) === allowedClientNormalized
}
const isFinishedProductCode = (code) => normalize(code).startsWith('5')
const extractFinishedCodeFromOrderProduct = (productValue) => {
  const normalized = normalize(productValue)
  if (!normalized) return ''
  return normalize(normalized.split('-')[0])
}

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

const formatQtyByUnit = (value, unit) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (isUnitUN(unit)) {
    return Math.round(number).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  return formatQty(number)
}

const formatQtyPerPiece = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
}

const mapPurchaseFromDb = (row) => ({
  id: row.id,
  date: row.date,
  invoiceNumber: row.invoice_number,
  itemCode: row.item_code,
  product: row.product,
  client: row.client,
  quantity: Number(row.quantity),
  unitValue: Number(row.unit_value),
  balance: Number(row.balance),
  createdAt: row.created_at,
})

const mapRequisitionFromDb = (row) => ({
  id: row.id,
  itemCode: row.item_code,
  op: row.op,
  client: row.client,
  quantity: Number(row.quantity),
  createdAt: row.created_at,
  allocations: Array.isArray(row.allocations) ? row.allocations : [],
})

const mapReturnFromDb = (row) => ({
  id: row.id,
  op: row.op,
  itemCode: row.item_code,
  itemDescription: row.item_description,
  quantity: Number(row.quantity),
  createdAt: row.created_at,
  allocations: Array.isArray(row.allocations) ? row.allocations : [],
})

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
  op: '',
  opQuantity: '',
}

const emptyReturnForm = {
  op: '',
  itemCode: '',
  itemDescription: '',
  quantity: '',
}

export default function Estoque({ readOnly = false, allowedClient = '' }) {
  const [tab, setTab] = useState('inventario')
  const [inventoryClientFilter, setInventoryClientFilter] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPurchaseForm, setShowPurchaseForm] = useState(false)
  const [purchaseEntryMode, setPurchaseEntryMode] = useState('nf')
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm)
  const [manualInventoryModalOpen, setManualInventoryModalOpen] = useState(false)
  const [manualInventoryDate, setManualInventoryDate] = useState(nowIsoDate())
  const [manualInventoryQtyByCode, setManualInventoryQtyByCode] = useState({})
  const [manualInventorySaving, setManualInventorySaving] = useState(false)
  const [manualInventoryError, setManualInventoryError] = useState('')
  const [requisitionForm, setRequisitionForm] = useState(emptyRequisitionForm)
  const [purchaseError, setPurchaseError] = useState('')
  const [requisitionError, setRequisitionError] = useState('')
  const [requisitionInfo, setRequisitionInfo] = useState('')
  const [requisitionOpContext, setRequisitionOpContext] = useState({
    loading: false,
    finishedItemCode: '',
    client: '',
    product: '',
  })
  const [returnForm, setReturnForm] = useState(emptyReturnForm)
  const [returnError, setReturnError] = useState('')
  const [returnInfo, setReturnInfo] = useState('')
  const [usageModal, setUsageModal] = useState({ open: false, purchase: null, rows: [] })
  const [purchases, setPurchases] = useState([])
  const [requisitions, setRequisitions] = useState([])
  const [returns, setReturns] = useState([])
  const [itemStructures, setItemStructures] = useState([])
  const [requisitionManualByCode, setRequisitionManualByCode] = useState({})
  const allowedClientNormalized = useMemo(() => normalizeClientValue(allowedClient), [allowedClient])

  useEffect(() => {
    fetchItems()
    fetchStockMovements()
    fetchItemStructures()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('estoque-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        () => {
          fetchItems()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'estoque_purchases' },
        () => {
          fetchStockMovements()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'estoque_requisitions' },
        () => {
          fetchStockMovements()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'estoque_returns' },
        () => {
          fetchStockMovements()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'item_structures' },
        () => {
          fetchItemStructures()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

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

  async function fetchStockMovements() {
    try {
      const [purchasesRes, requisitionsRes, returnsRes] = await Promise.all([
        supabase.from('estoque_purchases').select('*').order('created_at', { ascending: false }),
        supabase.from('estoque_requisitions').select('*').order('created_at', { ascending: false }),
        supabase.from('estoque_returns').select('*').order('created_at', { ascending: false }),
      ])

      if (purchasesRes.error) throw purchasesRes.error
      if (requisitionsRes.error) throw requisitionsRes.error
      if (returnsRes.error) throw returnsRes.error

      setPurchases((purchasesRes.data || []).map(mapPurchaseFromDb))
      setRequisitions((requisitionsRes.data || []).map(mapRequisitionFromDb))
      setReturns((returnsRes.data || []).map(mapReturnFromDb))
    } catch (err) {
      setError(err?.message || 'Não foi possível carregar os lançamentos de estoque.')
    }
  }

  async function fetchItemStructures() {
    try {
      const { data, error: queryError } = await supabase
        .from('item_structures')
        .select('*')

      if (queryError) throw queryError
      setItemStructures(data || [])
    } catch (err) {
      setError(err?.message || 'Não foi possível carregar as estruturas dos itens.')
    }
  }

  async function resolveRequisitionOpContext(opValue) {
    const op = normalize(opValue)
    if (!op) {
      setRequisitionOpContext({ loading: false, finishedItemCode: '', client: '', product: '' })
      return
    }

    setRequisitionOpContext((prev) => ({ ...prev, loading: true }))
    try {
      const { data, error: queryError } = await supabase
        .from('orders')
        .select('code, customer, product, created_at')
        .eq('code', op)
        .order('created_at', { ascending: false })
        .limit(1)

      if (queryError) throw queryError

      const order = Array.isArray(data) && data.length > 0 ? data[0] : null
      const finishedItemCode = extractFinishedCodeFromOrderProduct(order?.product)
      const client = normalize(order?.customer)
      const product = normalize(order?.product)

      setRequisitionOpContext({
        loading: false,
        finishedItemCode,
        client,
        product,
      })
    } catch {
      setRequisitionOpContext({ loading: false, finishedItemCode: '', client: '', product: '' })
    }
  }

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
      if (!matchesAllowedClient(item?.cliente || item?.client, allowedClientNormalized)) return
      const code = normalize(item?.code)
      if (!code) return
      map[code] = item
    })
    return map
  }, [items, allowedClientNormalized])

  const scopedItems = useMemo(() => {
    return (items || []).filter((item) => matchesAllowedClient(item?.cliente || item?.client, allowedClientNormalized))
  }, [items, allowedClientNormalized])

  const purchasableItems = useMemo(
    () => (scopedItems || []).filter((item) => !isFinishedProductCode(item?.code)),
    [scopedItems]
  )

  const inventoryClientOptions = useMemo(() => {
    const set = new Set()
    ;(scopedItems || []).forEach((item) => {
      const client = normalize(item?.cliente || item?.client)
      if (!client) return
      set.add(client)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [scopedItems])

  useEffect(() => {
    if (!inventoryClientFilter) return
    const selectedNormalized = normalizeClientValue(inventoryClientFilter)
    const stillExists = inventoryClientOptions.some(
      (client) => normalizeClientValue(client) === selectedNormalized
    )
    if (!stillExists) {
      setInventoryClientFilter('')
    }
  }, [inventoryClientFilter, inventoryClientOptions])

  useEffect(() => {
    if (!allowedClientNormalized) return
    if (inventoryClientFilter) setInventoryClientFilter('')
  }, [allowedClientNormalized, inventoryClientFilter])

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
    const list = Array.isArray(scopedItems) ? scopedItems : []
    const selectedClientNormalized = allowedClientNormalized
      ? ''
      : normalizeClientValue(inventoryClientFilter)

    return list
      .filter((item) => {
        const code = String(item?.code || '').trim()
        if (!code) return false
        if (selectedClientNormalized) {
          const itemClient = item?.cliente || item?.client
          if (!matchesAllowedClient(itemClient, selectedClientNormalized)) return false
        }
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
  }, [scopedItems, purchaseBalanceByCode, inventoryClientFilter, allowedClientNormalized])

  const purchaseRows = useMemo(
    () => [...(purchases || [])]
      .filter((row) => matchesAllowedClient(row?.client, allowedClientNormalized))
      .sort(sortByLatest)
      .slice(0, 30),
    [purchases, allowedClientNormalized]
  )

  const latestUnitValueByItemCode = useMemo(() => {
    const map = {}
    ;(purchases || [])
      .slice()
      .sort(sortByLatest)
      .forEach((row) => {
        const code = normalize(row?.itemCode)
        const unitValue = Number(row?.unitValue)
        if (!code || !Number.isFinite(unitValue) || unitValue <= 0) return
        if (!map[code]) map[code] = unitValue
      })
    return map
  }, [purchases])

  const requisitionRows = useMemo(
    () => [...(requisitions || [])]
      .filter((row) => matchesAllowedClient(row?.client, allowedClientNormalized))
      .sort(sortByLatest)
      .slice(0, 20),
    [requisitions, allowedClientNormalized]
  )

  const returnRows = useMemo(
    () => [...(returns || [])]
      .filter((row) => {
        if (!allowedClientNormalized) return true
        const itemCode = normalize(row?.itemCode)
        const sourceItem = (items || []).find((item) => normalize(item?.code) === itemCode)
        return matchesAllowedClient(sourceItem?.cliente || sourceItem?.client, allowedClientNormalized)
      })
      .sort(sortByLatest)
      .slice(0, 30),
    [returns, items, allowedClientNormalized]
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

  const requisitionStructureRows = useMemo(() => {
    const finishedItemCode = normalize(requisitionOpContext.finishedItemCode)
    const opQty = toPositiveNumber(requisitionForm.opQuantity) || 0
    if (!finishedItemCode) return []

    return (itemStructures || [])
      .filter((row) => normalize(row?.finished_item_code) === finishedItemCode)
      .map((row) => {
        const inputCode = normalize(row?.input_item_code)
        const qtyPerPiece = Number(row?.quantity_per_piece)
        const source = itemByCode[inputCode]
        const sourceUnit = normalize(source?.unidade)
        const availableStock = Number(purchaseBalanceByCode[inputCode] || 0)
        const totalRaw = Number.isFinite(qtyPerPiece) ? qtyPerPiece * opQty : 0
        const totalRequired = isUnitUN(sourceUnit) ? Math.round(totalRaw) : totalRaw
        const manualRaw = requisitionManualByCode[inputCode]
        const manualParsed = toPositiveNumber(manualRaw)
        const manualQty = manualParsed
          ? (isUnitUN(sourceUnit) ? Math.round(manualParsed) : manualParsed)
          : null
        const requestedQty = manualQty || totalRequired

        return {
          itemCode: inputCode,
          description: source?.description || '-',
          unidade: source?.unidade || '-',
          availableStock,
          qtyPerPiece,
          totalRequired,
          requestedQty,
          manualRaw: manualRaw ?? '',
        }
      })
  }, [itemStructures, requisitionOpContext.finishedItemCode, requisitionForm.opQuantity, itemByCode, purchaseBalanceByCode, requisitionManualByCode])

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

  function openManualInventoryModal() {
    setManualInventoryError('')
    setManualInventoryDate(nowIsoDate())
    setManualInventoryQtyByCode({})
    setManualInventoryModalOpen(true)
  }

  function closeManualInventoryModal() {
    if (manualInventorySaving) return
    setManualInventoryModalOpen(false)
    setManualInventoryError('')
  }

  function handleManualInventoryQtyChange(itemCode, value) {
    const code = normalize(itemCode)
    if (!code) return
    setManualInventoryQtyByCode((prev) => ({ ...prev, [code]: value }))
  }

  async function handleManualInventorySubmit() {
    setManualInventoryError('')
    const date = normalize(manualInventoryDate) || nowIsoDate()

    const rowsToInsert = (purchasableItems || []).map((item) => {
      const code = normalize(item?.code)
      const unit = normalize(item?.unidade)
      const rawQty = manualInventoryQtyByCode[code]
      const parsed = toPositiveNumber(rawQty)
      if (!parsed) return null

      const quantity = isUnitUN(unit) ? Math.round(parsed) : parsed
      if (!Number.isFinite(quantity) || quantity <= 0) return null

      const itemUnitValue = Number(item?.unit_value)
      const latestUnitValue = Number(latestUnitValueByItemCode[code])
      const fallbackUnitValue = Number.isFinite(itemUnitValue) && itemUnitValue > 0
        ? itemUnitValue
        : (Number.isFinite(latestUnitValue) && latestUnitValue > 0 ? latestUnitValue : 1)

      return {
        id: makeId(),
        date,
        invoice_number: MANUAL_PURCHASE_INVOICE,
        item_code: code,
        product: normalize(item?.description || code),
        client: normalize(item?.cliente || item?.client),
        quantity,
        unit_value: fallbackUnitValue,
        balance: quantity,
      }
    }).filter(Boolean)

    if (rowsToInsert.length === 0) {
      setManualInventoryError('Informe pelo menos uma quantidade maior que zero para lançar o inventário manual.')
      return
    }

    setManualInventorySaving(true)
    try {
      const { data, error: insertError } = await supabase
        .from('estoque_purchases')
        .insert(rowsToInsert)
        .select('*')

      if (insertError) throw insertError

      const mapped = (data || []).map(mapPurchaseFromDb)
      setPurchases((prev) => [...mapped, ...(prev || [])])
      setManualInventoryModalOpen(false)
      setManualInventoryQtyByCode({})
      setManualInventoryError('')
    } catch (err) {
      setManualInventoryError(err?.message || 'Não foi possível salvar o inventário manual.')
    } finally {
      setManualInventorySaving(false)
    }
  }

  function resetPurchaseForm() {
    setPurchaseForm({ ...emptyPurchaseForm, date: nowIsoDate() })
    setPurchaseError('')
    setPurchaseEntryMode('nf')
  }

  function openPurchaseForm(mode = 'nf') {
    setShowPurchaseForm(true)
    setPurchaseError('')
    setPurchaseEntryMode(mode)
    setPurchaseForm((prev) => ({
      ...prev,
      date: prev?.date || nowIsoDate(),
      invoiceNumber: mode === 'manual' ? MANUAL_PURCHASE_INVOICE : (mode === purchaseEntryMode ? prev.invoiceNumber : ''),
    }))
  }

  async function handlePurchaseSubmit(e) {
    e.preventDefault()
    setPurchaseError('')

    const date = normalize(purchaseForm.date) || nowIsoDate()
    const invoiceNumber = purchaseEntryMode === 'manual'
      ? MANUAL_PURCHASE_INVOICE
      : normalize(purchaseForm.invoiceNumber)
    const itemCode = normalize(purchaseForm.itemCode)
    const product = normalize(purchaseForm.product)
    const client = normalize(purchaseForm.client)
    const quantity = toPositiveNumber(purchaseForm.quantity)
    const unitValue = toPositiveNumber(purchaseForm.unitValue)

    if (purchaseEntryMode !== 'manual' && !invoiceNumber) {
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

    const payload = {
      id: makeId(),
      date,
      invoice_number: invoiceNumber,
      item_code: itemCode,
      product,
      client,
      quantity,
      unit_value: unitValue,
      balance: quantity,
    }

    try {
      const { data, error: insertError } = await supabase
        .from('estoque_purchases')
        .insert(payload)
        .select('*')
        .single()

      if (insertError) throw insertError

      setPurchases((prev) => [mapPurchaseFromDb(data), ...(prev || [])])
      resetPurchaseForm()
      setShowPurchaseForm(false)
    } catch (err) {
      setPurchaseError(err?.message || 'Não foi possível salvar a compra no Supabase.')
    }
  }

  function handleRequisitionFieldChange(e) {
    const { name, value } = e.target
    setRequisitionForm((prev) => ({ ...prev, [name]: value }))

    if (name === 'op') {
      setRequisitionManualByCode({})
      resolveRequisitionOpContext(value)
    }
  }

  function handleManualRequisitionChange(itemCode, value) {
    const code = normalize(itemCode)
    if (!code) return
    setRequisitionManualByCode((prev) => ({ ...prev, [code]: value }))
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

  async function handleReturnSubmit(e) {
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

    try {
      const purchaseUpdates = Array.from(purchaseBalanceAddMap.entries()).map(([id, qtyToAdd]) => {
        const source = (purchases || []).find((purchase) => normalize(purchase?.id) === id)
        const currentBalance = Number(source?.balance)
        const nextBalance = Number.isFinite(currentBalance)
          ? currentBalance + Number(qtyToAdd || 0)
          : Number(qtyToAdd || 0)

        return supabase
          .from('estoque_purchases')
          .update({ balance: nextBalance })
          .eq('id', id)
      })

      const purchaseUpdateResults = await Promise.all(purchaseUpdates)
      const purchaseUpdateError = purchaseUpdateResults.find((result) => result.error)?.error
      if (purchaseUpdateError) throw purchaseUpdateError

      const returnPayload = {
        id: makeId(),
        op,
        item_code: itemCode,
        item_description: product,
        quantity,
        allocations: allocationsApplied,
      }

      const { data: returnData, error: returnInsertError } = await supabase
        .from('estoque_returns')
        .insert(returnPayload)
        .select('*')
        .single()

      if (returnInsertError) throw returnInsertError

      setReturns((prev) => [mapReturnFromDb(returnData), ...(prev || [])])
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
    } catch (err) {
      setReturnError(err?.message || 'Não foi possível salvar o retorno no Supabase.')
    }
  }

  async function handleRequisitionSubmit(e) {
    e.preventDefault()
    setRequisitionError('')
    setRequisitionInfo('')

    const op = normalize(requisitionForm.op)
    const finishedItemCode = normalize(requisitionOpContext.finishedItemCode)
    const client = normalize(requisitionOpContext.client)
    const opQuantity = toPositiveNumber(requisitionForm.opQuantity)

    if (!op) {
      setRequisitionError('Informe a O.P da requisição.')
      return
    }

    if (!opQuantity) {
      setRequisitionError('Quantidade da O.P deve ser maior que zero.')
      return
    }

    if (!finishedItemCode) {
      setRequisitionError('Não foi possível identificar o produto acabado desta O.P.')
      return
    }

    if (!client) {
      setRequisitionError('Informe o cliente da requisição.')
      return
    }

    if (requisitionStructureRows.length === 0) {
      setRequisitionError('Este produto acabado não possui estrutura cadastrada.')
      return
    }

    const plannedRows = requisitionStructureRows
      .filter((row) => Number(row.requestedQty) > 0)

    if (plannedRows.length === 0) {
      setRequisitionError('Nenhum insumo foi informado para requisição.')
      return
    }

    const workingBalanceByPurchase = new Map(
      (purchases || []).map((purchase) => [normalize(purchase?.id), Number(purchase?.balance) || 0])
    )

    const allocationMap = new Map()
    const requisitionInsertRows = []

    for (const structureRow of plannedRows) {
      const itemCode = normalize(structureRow.itemCode)
      const qtyRequested = Number(structureRow.requestedQty)

      const availableRows = [...(purchases || [])]
        .filter((row) => {
          const sameCode = normalize(row?.itemCode) === itemCode
          if (!sameCode) return false
          const rowId = normalize(row?.id)
          const balance = Number(workingBalanceByPurchase.get(rowId) || 0)
          return Number.isFinite(balance) && balance > 0
        })
        .sort(sortByFifoDate)

      const availableTotal = availableRows.reduce((sum, row) => {
        const rowId = normalize(row?.id)
        return sum + Number(workingBalanceByPurchase.get(rowId) || 0)
      }, 0)

      if (availableTotal < qtyRequested) {
        setRequisitionError(
          `Estoque insuficiente para ${itemCode}. Disponível: ${formatQty(availableTotal)}.`
        )
        return
      }

      let remaining = qtyRequested
      const allocations = []

      for (const row of availableRows) {
        if (remaining <= 0) break
        const rowId = normalize(row?.id)
        const currentBalance = Number(workingBalanceByPurchase.get(rowId) || 0)
        if (currentBalance <= 0) continue

        const usedQty = Math.min(currentBalance, remaining)
        const nextBalance = currentBalance - usedQty

        workingBalanceByPurchase.set(rowId, nextBalance)
        allocationMap.set(row.id, nextBalance)
        allocations.push({
          purchaseId: row.id,
          invoiceNumber: row.invoiceNumber,
          date: row.date,
          usedQty,
          balanceAfter: nextBalance,
          finishedItemCode,
          opQuantity,
          quantityPerPiece: Number(structureRow.qtyPerPiece || 0),
        })
        remaining -= usedQty
      }

      requisitionInsertRows.push({
        id: makeId(),
        item_code: itemCode,
        op,
        client,
        quantity: qtyRequested,
        allocations,
      })
    }

    try {
      const purchaseUpdates = Array.from(allocationMap.entries()).map(([id, balance]) =>
        supabase
          .from('estoque_purchases')
          .update({ balance })
          .eq('id', id)
      )

      const purchaseUpdateResults = await Promise.all(purchaseUpdates)
      const purchaseUpdateError = purchaseUpdateResults.find((result) => result.error)?.error
      if (purchaseUpdateError) throw purchaseUpdateError

      const { data: reqData, error: reqError } = await supabase
        .from('estoque_requisitions')
        .insert(requisitionInsertRows)
        .select('*')

      if (reqError) throw reqError

      setPurchases((prev) =>
        (prev || []).map((row) => {
          if (!allocationMap.has(row.id)) return row
          return { ...row, balance: allocationMap.get(row.id) }
        })
      )
      setRequisitions((prev) => [...(reqData || []).map(mapRequisitionFromDb), ...(prev || [])])
      setRequisitionForm(emptyRequisitionForm)
      setRequisitionManualByCode({})
      setRequisitionOpContext({ loading: false, finishedItemCode: '', client: '', product: '' })
      setRequisitionInfo(
        `Requisição concluída pela estrutura. ${requisitionInsertRows.length} insumo(s) processado(s).`
      )
    } catch (err) {
      setRequisitionError(err?.message || 'Não foi possível salvar a requisição no Supabase.')
    }
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
          <p className="estoque-sub">Inventário, requisição, retorno e compras por Nota Fiscal.</p>
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
            <div className="estoque-inventory-controls">
              {!allowedClientNormalized && (
                <select
                  className="estoque-filter-select"
                  value={inventoryClientFilter}
                  onChange={(e) => setInventoryClientFilter(e.target.value)}
                  aria-label="Filtrar inventário por cliente"
                  disabled={inventoryClientOptions.length === 0}
                >
                  <option value="">Todos os clientes</option>
                  {inventoryClientOptions.map((client) => (
                    <option key={client} value={client}>{client}</option>
                  ))}
                </select>
              )}
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

          {!readOnly && (
            <form className="estoque-form" onSubmit={handleRequisitionSubmit}>
              <div className="estoque-form-grid">
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
                  Quantidade da O.P
                  <input
                    name="opQuantity"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={requisitionForm.opQuantity}
                    onChange={handleRequisitionFieldChange}
                    placeholder="Ex.: 5000"
                  />
                </label>
              </div>

              {requisitionForm.op && (
                <div className="estoque-alert" style={{ marginBottom: 0 }}>
                  {requisitionOpContext.loading
                    ? 'Buscando dados da O.P…'
                    : (requisitionOpContext.finishedItemCode
                      ? `Produto: ${requisitionOpContext.product || requisitionOpContext.finishedItemCode} • Cliente: ${requisitionOpContext.client || '-'}`
                      : 'O.P não encontrada ou sem produto válido para estrutura.')}
                </div>
              )}

              <div className="estoque-table-wrap">
                <table className="estoque-table">
                  <thead>
                    <tr>
                      <th>Cod</th>
                      <th>Descrição</th>
                      <th>Unidade</th>
                      <th>Estoque</th>
                      <th>Quantidade</th>
                      <th>Total</th>
                      <th>Requisição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisitionStructureRows.length === 0 && (
                      <tr>
                        <td colSpan="7" className="estoque-empty">
                          Informe a O.P para carregar a estrutura automaticamente.
                        </td>
                      </tr>
                    )}

                    {requisitionStructureRows.map((row) => (
                      <tr key={row.itemCode}>
                        <td>{row.itemCode || '-'}</td>
                        <td>{row.description || '-'}</td>
                        <td>{row.unidade || '-'}</td>
                        <td>{formatQtyByUnit(row.availableStock, row.unidade)}</td>
                        <td>{formatQtyPerPiece(row.qtyPerPiece)}</td>
                        <td>{formatQtyByUnit(row.totalRequired, row.unidade)}</td>
                        <td>
                          <input
                            type="number"
                            min={isUnitUN(row.unidade) ? '1' : '0.001'}
                            step={isUnitUN(row.unidade) ? '1' : '0.001'}
                            value={row.manualRaw}
                            onChange={(e) => handleManualRequisitionChange(row.itemCode, e.target.value)}
                            placeholder={formatQtyByUnit(row.totalRequired, row.unidade)}
                            style={{ width: 120 }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="estoque-form-actions">
                <button className="btn primary" type="submit">Requisitar</button>
              </div>
            </form>
          )}

          {readOnly && (
            <div className="estoque-alert">Visualização habilitada. Lançamentos de requisição estão bloqueados para este perfil.</div>
          )}

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
                  <th>Notas consumidas</th>
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
                  const sourceItem = itemByCode[normalize(row.itemCode)]
                  const sourceUnit = sourceItem?.unidade || ''
                  const notesText = (row.allocations || [])
                    .map((a) => `${a.invoiceNumber}: ${formatQtyByUnit(a.usedQty, sourceUnit)}`)
                    .join(' • ')

                  return (
                    <tr key={row.id}>
                      <td>{fmtDateTime(row.createdAt) || '-'}</td>
                      <td>{row.op || '-'}</td>
                      <td>{row.itemCode || '-'}</td>
                      <td>{formatQtyByUnit(row.quantity, sourceUnit)}</td>
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

          {!readOnly && (
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
          )}

          {readOnly && (
            <div className="estoque-alert">Visualização habilitada. Lançamentos de retorno estão bloqueados para este perfil.</div>
          )}

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
            {!readOnly && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  onClick={() => {
                    if (showPurchaseForm && purchaseEntryMode === 'nf') {
                      setShowPurchaseForm(false)
                      setPurchaseError('')
                      return
                    }
                    openPurchaseForm('nf')
                  }}
                  type="button"
                >
                  {showPurchaseForm && purchaseEntryMode === 'nf' ? 'Fechar entrada' : 'Nova entrada (NF)'}
                </button>
              </div>
            )}
          </div>

          {!readOnly && showPurchaseForm && (
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
                    placeholder={purchaseEntryMode === 'manual' ? MANUAL_PURCHASE_INVOICE : 'Ex.: 000123'}
                    readOnly={purchaseEntryMode === 'manual'}
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

          {readOnly && (
            <div className="estoque-alert">Visualização habilitada. Lançamentos de compra estão bloqueados para este perfil.</div>
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
        open={manualInventoryModalOpen}
        onClose={closeManualInventoryModal}
        title="Lançamento manual de inventário"
      >
        <div className="estoque-form" style={{ marginBottom: 0 }}>
          <div className="estoque-form-grid" style={{ gridTemplateColumns: '220px 1fr' }}>
            <label>
              Data
              <input
                type="date"
                value={manualInventoryDate}
                onChange={(e) => setManualInventoryDate(e.target.value)}
              />
            </label>

            <label>
              Nota Fiscal
              <input value={MANUAL_PURCHASE_INVOICE} readOnly />
            </label>
          </div>

          {manualInventoryError && <div className="estoque-alert">{manualInventoryError}</div>}

          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Cliente</th>
                  <th>Unidade</th>
                  <th>Estoque atual</th>
                  <th>Quantidade (lançar)</th>
                </tr>
              </thead>
              <tbody>
                {purchasableItems.length === 0 && (
                  <tr>
                    <td colSpan="6" className="estoque-empty">Nenhum insumo disponível para lançamento manual.</td>
                  </tr>
                )}
                {purchasableItems.map((item) => {
                  const code = normalize(item?.code)
                  const unit = normalize(item?.unidade)
                  const currentStock = Number(purchaseBalanceByCode[code] || 0)
                  return (
                    <tr key={item.id || code}>
                      <td>{code || '-'}</td>
                      <td>{item?.description || '-'}</td>
                      <td>{item?.cliente || item?.client || '-'}</td>
                      <td>{unit || '-'}</td>
                      <td>{formatQtyByUnit(currentStock, unit)}</td>
                      <td>
                        <input
                          type="number"
                          min={isUnitUN(unit) ? '1' : '0.001'}
                          step={isUnitUN(unit) ? '1' : '0.001'}
                          value={manualInventoryQtyByCode[code] ?? ''}
                          onChange={(e) => handleManualInventoryQtyChange(code, e.target.value)}
                          placeholder="0"
                          style={{ width: 140 }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="estoque-form-actions" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={closeManualInventoryModal} disabled={manualInventorySaving}>
              Cancelar
            </button>
            <button className="btn primary" type="button" onClick={handleManualInventorySubmit} disabled={manualInventorySaving}>
              {manualInventorySaving ? 'Salvando…' : 'Salvar todos'}
            </button>
          </div>
        </div>
      </Modal>

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
