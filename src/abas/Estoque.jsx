import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtDateTime } from '../lib/utils'
import Modal from '../components/Modal'
import '../styles/estoque.css'

const LOCAL_SAIDAS_KEY = 'estoque-saidas-local'

function extractItemCode(product) {
  if (!product) return ''
  const first = String(product).split('-')[0] || ''
  return first.trim()
}

function stripProductName(product) {
  if (!product) return ''
  const t = String(product)
  const dashIdx = t.indexOf('-')
  if (dashIdx === -1) return t.trim()
  const tail = t.slice(dashIdx + 1).trim()
  return tail || t.trim()
}

function parseQty(val) {
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

function formatBoxLabel(orderCode, boxNumber) {
  if (!orderCode || boxNumber == null) return '-'
  const boxStr = String(boxNumber).padStart(3, '0')
  return `OS ${orderCode} - ${boxStr}`
}

function loadLocalSaidas() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOCAL_SAIDAS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('Falha ao ler saídas locais:', err)
    return []
  }
}

function persistLocalSaidas(list) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCAL_SAIDAS_KEY, JSON.stringify(list))
  } catch (err) {
    console.warn('Falha ao salvar saídas locais:', err)
  }
}

export default function Estoque() {
  const [tab, setTab] = useState('entradas')
  const [entradas, setEntradas] = useState([])
  const [entradasLoading, setEntradasLoading] = useState(false)
  const [saidas, setSaidas] = useState([])
  const [saidasLoading, setSaidasLoading] = useState(false)
  const [saidasMode, setSaidasMode] = useState('remote')
  const [saidasMessage, setSaidasMessage] = useState('')
  const [entradaQuery, setEntradaQuery] = useState('')
  const [entradaSort, setEntradaSort] = useState({ field: 'created_at', dir: 'desc' })
  const [saidaQuery, setSaidaQuery] = useState('')
  const [saidaSort, setSaidaSort] = useState({ field: 'created_at', dir: 'desc' })
  const [ordersMap, setOrdersMap] = useState({})
  const orderCacheRef = useRef({})
  const scanBufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)
  const [nfModalOpen, setNfModalOpen] = useState(false)
  const [nfNumber, setNfNumber] = useState('')
  const [nfItems, setNfItems] = useState(() => [createEmptyNFItem()])
  const [nfSaving, setNfSaving] = useState(false)
  const [nfError, setNfError] = useState('')

  function createEmptyNFItem() {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `nf-item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      orderCode: '',
      itemCode: '',
      nfItem: '',
      product: '',
      color: '',
      qty: '',
      volumes: '',
      padrao: '',
      collapsed: false,
    }
  }

  useEffect(() => {
    fetchEntradas()
    fetchSaidas()
  }, [])

  async function fetchEntradas() {
    setEntradasLoading(true)
    try {
      const { data, error } = await supabase
        .from('production_scans')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw error

      const rows = data || []
      setEntradas(rows)

      const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean)))
      if (orderIds.length) {
        const { data: ords, error: ordErr } = await supabase
          .from('orders')
          .select('id, code, product, standard, color')
          .in('id', orderIds)

        if (!ordErr) {
          const map = {}
          ;(ords || []).forEach((o) => {
            map[o.id] = o
          })
          setOrdersMap(map)
        } else {
          console.warn('Erro ao carregar O.S para estoque:', ordErr)
          setOrdersMap({})
        }
      } else {
        setOrdersMap({})
      }
    } catch (err) {
      console.warn('Erro ao carregar entradas de estoque:', err)
      setEntradas([])
    } finally {
      setEntradasLoading(false)
    }
  }

  async function fetchSaidas() {
    setSaidasLoading(true)
    setSaidasMessage('')
    try {
      const { data, error } = await supabase
        .from('stock_outputs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw error

      setSaidas(data || [])
      setSaidasMode('remote')
      setSaidasMessage('')
    } catch (err) {
      console.warn('Saídas remotas indisponíveis, usando armazenamento local:', err)
      const localRows = loadLocalSaidas()
      setSaidas(localRows)
      setSaidasMode('local')
      setSaidasMessage('Tabela "stock_outputs" não encontrada ou sem permissão. Registrando saídas somente neste navegador.')
    } finally {
      setSaidasLoading(false)
    }
  }

  function sortRows(list, config) {
    if (!Array.isArray(list)) return []
    const field = config?.field || 'created_at'
    const dir = config?.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const va = field === 'created_at'
        ? new Date(a.created_at || a.createdAt || 0).getTime()
        : String(a[field] || '').toLowerCase()

      const vb = field === 'created_at'
        ? new Date(b.created_at || b.createdAt || 0).getTime()
        : String(b[field] || '').toLowerCase()

      if (va === vb) return 0
      return va > vb ? dir : -dir
    })
  }

  function sortLabel(config, field, label) {
    if (config?.field === field) return `${label} ${config.dir === 'asc' ? '↑' : '↓'}`
    return `${label} ↕`
  }

  function toggleEntradaSort(field) {
    setEntradaSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }
    )
  }

  function toggleSaidaSort(field) {
    setSaidaSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }
    )
  }

  const entradaRows = useMemo(() => {
    const list = Array.isArray(entradas) ? entradas : []
    return list.map((scan) => {
      const order = ordersMap?.[scan.order_id]
      const productRaw = order?.product || scan.product || ''
      const productName = stripProductName(productRaw)
      const itemCode = extractItemCode(productRaw) || order?.code || scan.item_code || scan.op_code || ''
      const qty = parseQty(scan.qty_pieces ?? order?.standard)
      const color = order?.color || scan.color || ''

      return {
        id: scan.id,
        created_at: scan.created_at,
        dateLabel: fmtDateTime(scan.created_at),
        orderCode: order?.code || scan.op_code || '-',
        boxLabel: formatBoxLabel(order?.code || scan.op_code, scan.scanned_box),
        itemCode,
        product: productName || '-',
        color: color || '-',
        qty,
      }
    })
  }, [entradas, ordersMap])

  const entradaRowsView = useMemo(() => {
    const q = entradaQuery.trim().toLowerCase()
    let rows = entradaRows
    if (q) {
      rows = rows.filter((row) =>
        [row.orderCode, row.boxLabel, row.itemCode, row.product, row.color]
          .some((val) => String(val || '').toLowerCase().includes(q))
      )
    }
    return sortRows(rows, entradaSort)
  }, [entradaRows, entradaQuery, entradaSort])

  const controleRows = useMemo(() => {
    const map = new Map()
    const entradasSafe = Array.isArray(entradaRows) ? entradaRows : []

    entradasSafe.forEach((row) => {
      const key = row.itemCode || row.product || 'sem-codigo'
      const prev = map.get(key) || { itemCode: row.itemCode, product: row.product, entradas: 0, saidas: 0 }
      prev.entradas += parseQty(row.qty)
      map.set(key, prev)
    })

    const saidasSafe = Array.isArray(saidas) ? saidas : []
    saidasSafe.forEach((s) => {
      const product = s.product || ''
      const productName = stripProductName(product)
      const itemCode = s.item_code || extractItemCode(product) || ''
      const key = itemCode || productName || 'sem-codigo'
      const prev = map.get(key) || { itemCode, product: productName || '-', entradas: 0, saidas: 0 }
      prev.saidas += parseQty(s.qty_pieces || s.qty || s.quantidade)
      map.set(key, prev)
    })

    return Array.from(map.values())
      .map((r) => ({ ...r, saldo: (r.entradas || 0) - (r.saidas || 0) }))
      .sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''))
  }, [entradaRows, saidas])

  const ordersByCode = useMemo(() => {
    const map = {}
    Object.values(ordersMap || {}).forEach((o) => {
      if (o?.code) map[String(o.code)] = o
    })
    return map
  }, [ordersMap])

  const saidasRows = useMemo(() => {
    const list = Array.isArray(saidas) ? saidas : []
    return list.map((row) => ({
      ...row,
      created_at: row.created_at,
      nfDisplay: String(row.nf || '').split('/')[0] || row.nf,
      productName: stripProductName(row.product || ''),
      color: row.color || ordersByCode?.[row.order_code]?.color || '-',
      qtyNum: parseQty(row.qty_pieces || row.qty || row.quantidade),
    }))
  }, [saidas, ordersByCode])

  const saidasRowsView = useMemo(() => {
    const q = saidaQuery.trim().toLowerCase()
    let rows = saidasRows
    if (q) {
      rows = rows.filter((row) =>
        [row.nf, row.item_code, row.productName, row.color, row.code_raw, row.order_code]
          .some((val) => String(val || '').toLowerCase().includes(q))
      )
    }
    return sortRows(rows, saidaSort)
  }, [saidasRows, saidaQuery, saidaSort])

  const entradaTotalPecas = useMemo(() =>
    entradaRowsView.reduce((sum, row) => sum + parseQty(row.qty), 0),
    [entradaRowsView]
  )

  const saidaTotalPecas = useMemo(() =>
    saidasRowsView.reduce((sum, row) => sum + parseQty(row.qtyNum), 0),
    [saidasRowsView]
  )

  function openNfModal() {
    setNfModalOpen(true)
    setNfNumber('')
    setNfItems([createEmptyNFItem()])
    setNfError('')
    setNfSaving(false)
  }

  function handleUpdateNfItem(id, field, value) {
    setNfItems((prev) => prev.map((item) => {
      if (item.id !== id) return item
      const next = { ...item, [field]: value }
      if (field === 'volumes' || field === 'padrao') {
        const vol = Number(next.volumes)
        const pad = Number(next.padrao)
        const canAuto = Number.isFinite(vol) && Number.isFinite(pad)
        if (canAuto) {
          next.qty = String(vol * pad)
        }
      }
      return next
    }))
  }

  function handleAddNfItem() {
    setNfItems((prev) => [...prev, createEmptyNFItem()])
  }

  async function handleSaveNF() {
    if (nfSaving) return
    const num = nfNumber.trim()
    const preparedItems = nfItems
      .map((item) => {
        const pad = parseQty(item.padrao)
        const vol = parseQty(item.volumes)
        const qtyCalc = parseQty(item.qty) || (Number.isFinite(pad) && Number.isFinite(vol) ? pad * vol : 0)
        return {
          nf_item_no: String(item.nfItem || '').trim() || null,
          order_code: String(item.orderCode || '').trim() || null,
          item_code: String(item.itemCode || '').trim() || null,
          product: String(item.product || '').trim() || null,
          color: String(item.color || '').trim() || null,
          padrao: Number.isFinite(pad) ? pad : null,
          volumes: Number.isFinite(vol) ? vol : null,
          qty: qtyCalc || null,
        }
      })
      .filter((it) => it.nf_item_no || it.order_code || it.item_code || it.product || it.qty)

    if (!num) {
      setNfError('Informe o número da nota.')
      return
    }
    if (!preparedItems.length) {
      setNfError('Adicione ao menos um item para salvar a NF.')
      return
    }

    setNfSaving(true)
    setNfError('')

    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id || null

      const { data: header, error: headerErr } = await supabase
        .from('nf_headers')
        .insert([{ nf_number: num, created_by: userId }])
        .select()
        .single()

      if (headerErr || !header) {
        throw headerErr || new Error('Não foi possível salvar a NF.')
      }

      const itemsPayload = preparedItems.map((it) => ({ ...it, nf_id: header.id }))
      const { error: itemsErr } = await supabase.from('nf_items').insert(itemsPayload)
      if (itemsErr) throw itemsErr

      setNfModalOpen(false)
      setNfNumber('')
      setNfItems([createEmptyNFItem()])
      alert('NF lançada com sucesso.')
    } catch (err) {
      console.warn('Falha ao salvar NF:', err)
      setNfError(err?.message || 'Não foi possível salvar a NF agora.')
    } finally {
      setNfSaving(false)
    }
  }

  async function hydrateItemFromOrder(id) {
    const item = nfItems.find((i) => i.id === id)
    const code = String(item?.orderCode || '').trim()
    if (!code) return
    const order = await ensureOrderByCode(code)
    if (order) {
      const productRaw = order.product || ''
      const productName = stripProductName(productRaw)
      const itemCode = extractItemCode(productRaw) || order.code || ''
      setNfItems((prev) => prev.map((it) => (
        it.id === id
          ? {
              ...it,
              itemCode: it.itemCode || itemCode,
              product: it.product || productName,
              color: it.color || order.color || '',
              padrao: it.padrao || order.standard || '',
            }
          : it
      )))
    }
  }

  function toggleItemCollapse(id) {
    setNfItems((prev) => prev.map((item) => (item.id === id ? { ...item, collapsed: !item.collapsed } : item)))
  }

  async function ensureOrderByCode(code) {
    const key = String(code || '').trim()
    if (!key) return null
    if (orderCacheRef.current[key]) return orderCacheRef.current[key]
    const localOrder = Object.values(ordersMap || {}).find((o) => String(o.code) === key)
    if (localOrder) {
      orderCacheRef.current[key] = localOrder
      return localOrder
    }
    try {
      const { data, error } = await supabase.from('orders').select('id, code, product, standard, color').eq('code', key).limit(1).maybeSingle()
      if (!error && data) {
        orderCacheRef.current[key] = data
        return data
      }
    } catch (err) {
      console.warn('Falha ao buscar ordem por código para saída:', err)
    }
    return null
  }

  async function fetchNfItemByRef(nfNumber, nfItemNo) {
    const num = String(nfNumber || '').trim()
    const itemNo = String(nfItemNo || '').trim()
    if (!num || !itemNo) return null
    try {
      const { data, error } = await supabase
        .from('nf_items')
        .select('id, nf_item_no, order_code, item_code, product, color, padrao, volumes, qty, nf_headers!inner(nf_number)')
        .eq('nf_headers.nf_number', num)
        .eq('nf_item_no', itemNo)
        .limit(1)
        .maybeSingle()

      if (!error && data) return data
    } catch (err) {
      console.warn('Falha ao buscar item de NF:', err)
    }
    return null
  }

  async function registrarSaidaPorLeitura(rawCode) {
    const value = (rawCode || '').trim()
    if (!value) return
    setSaidasMessage('')

    const reg = /^NF\s+([A-Za-z0-9/.-]+)\s*-\s*(\d{3})$/i
    const m = value.match(reg)
    if (!m) {
      setSaidasMessage('Formato inválido. Use: NF 1101/1 - 001')
      return
    }

    const nf = m[1]
    const boxNumber = Number(m[2])
    if (!Number.isFinite(boxNumber) || boxNumber <= 0) {
      setSaidasMessage('Número de caixa inválido.')
      return
    }

    const nfNumber = (nf.split('/')[0] || '').trim()
    const nfItemNo = (nf.split('/')[1] || '').trim()

    let orderCode = nfNumber || nf
    let productName = ''
    let itemCode = ''
    let color = ''
    let qty = 0

    // 1) tenta puxar pelos itens de NF lançados
    const nfItem = nfNumber && nfItemNo ? await fetchNfItemByRef(nfNumber, nfItemNo) : null
    if (nfItem) {
      orderCode = nfItem.order_code || orderCode
      itemCode = nfItem.item_code || itemCode
      productName = nfItem.product || productName
      color = nfItem.color || color
      const padNum = Number(nfItem.padrao)
      const qtyFromPadrao = Number.isFinite(padNum) ? padNum : null
      const qtyFromField = Number.isFinite(Number(nfItem.qty)) ? Number(nfItem.qty) : null
      qty = qtyFromPadrao ?? qtyFromField ?? 0
    }

    // 2) fallback pela O.S se não achou dados suficientes
    if (!productName || !itemCode || !qty) {
      const order = await ensureOrderByCode(orderCode)
      const productRaw = order?.product || ''
      if (!productName) productName = stripProductName(productRaw)
      if (!itemCode) itemCode = extractItemCode(productRaw) || order?.code || ''
      if (!color) color = order?.color || ''
      if (!qty) qty = parseQty(order?.standard)
    }

    const payload = {
      created_at: new Date().toISOString(),
      nf,
      box_number: boxNumber,
      order_code: orderCode,
      item_code: itemCode,
      product: productName,
      color,
      qty_pieces: qty,
      code_raw: value,
    }

    if (saidasMode === 'remote') {
      const { data, error } = await supabase.from('stock_outputs').insert([payload]).select('*')
      if (error) {
        console.warn('Erro ao salvar saída no Supabase, mantendo localmente:', error)
        const row = { id: `local-${Date.now()}`, ...payload }
        const next = [row, ...saidas]
        setSaidas(next)
        setSaidasMode('local')
        setSaidasMessage('Erro ao salvar no Supabase. Saídas novas ficarão salvas apenas neste navegador.')
        persistLocalSaidas(next)
      } else {
        const row = Array.isArray(data) && data[0] ? data[0] : payload
        setSaidas((prev) => [row, ...prev])
      }
    } else {
      const row = { id: `local-${Date.now()}`, ...payload }
      const next = [row, ...saidas]
      setSaidas(next)
      persistLocalSaidas(next)
    }
  }

  function handleSaidaManual() {
    const code = window.prompt('Informe a saída no formato "NF 1101/1 - 001"')
    if (code) registrarSaidaPorLeitura(code)
  }

  useEffect(() => {
    if (tab !== 'saidas') return

    function onKey(e) {
      if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'CapsLock') return

      const now = Date.now()
      const THRESHOLD = 120

      if (now - lastKeyTimeRef.current > THRESHOLD) {
        scanBufferRef.current = ''
      }
      lastKeyTimeRef.current = now

      if (e.key === 'Enter') {
        const code = (scanBufferRef.current || '').trim()
        if (code) registrarSaidaPorLeitura(code)
        scanBufferRef.current = ''
        e.preventDefault()
        return
      }

      const active = document.activeElement
      const tag = active?.tagName?.toUpperCase()
      const activeIsInput = tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable
      if (activeIsInput) return

      if (e.key.length === 1) {
        scanBufferRef.current += e.key
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tab, saidasMode, saidas])

  return (
    <div className="estoque-page">
      <div className="estoque-header">
        <div>
          <h2 className="estoque-title">Estoque de Caixas</h2>
          <p className="estoque-sub">Controle de bipagens (entradas), saídas e saldo consolidado.</p>
        </div>
        <div className="estoque-actions">
          <button className="btn" onClick={handleSaidaManual}>Saída Manual</button>
          <button className="btn ghost" onClick={openNfModal}>Lançar NF</button>
        </div>
      </div>

      <div className="estoque-tabs">
        <button className={`estoque-tabbtn ${tab === 'entradas' ? 'active' : ''}`} onClick={() => setTab('entradas')}>
          Entradas
        </button>
        <button className={`estoque-tabbtn ${tab === 'saidas' ? 'active' : ''}`} onClick={() => setTab('saidas')}>
          Saídas
        </button>
        <button className={`estoque-tabbtn ${tab === 'controle' ? 'active' : ''}`} onClick={() => setTab('controle')}>
          Controle de Estoque
        </button>
      </div>

      {tab === 'entradas' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Bipagem</h3>
            <span className="pill">{entradaRowsView.length} registros • {entradaTotalPecas.toLocaleString('pt-BR')} peças</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              className="input"
              placeholder="Filtrar por O.S, caixa, item ou produto"
              value={entradaQuery}
              onChange={(e) => setEntradaQuery(e.target.value)}
              style={{ flex: '1 1 240px', minWidth: 200 }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn ghost" onClick={() => toggleEntradaSort('created_at')}>{sortLabel(entradaSort, 'created_at', 'Data')}</button>
              <button className="btn ghost" onClick={() => toggleEntradaSort('orderCode')}>{sortLabel(entradaSort, 'orderCode', 'O.S')}</button>
              <button className="btn ghost" onClick={() => toggleEntradaSort('product')}>{sortLabel(entradaSort, 'product', 'Produto')}</button>
            </div>
          </div>
          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>O.S</th>
                  <th>Caixa</th>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Cor</th>
                  <th>Quantidade (peças)</th>
                </tr>
              </thead>
              <tbody>
                {entradaRowsView.length === 0 && (
                  <tr>
                    <td colSpan="6" className="estoque-empty">
                      {entradasLoading
                        ? 'Carregando entradas…'
                        : entradaQuery.trim()
                        ? 'Nenhuma entrada encontrada para este filtro.'
                        : 'Nenhuma bipagem encontrada para este recorte.'}
                    </td>
                  </tr>
                )}
                {entradaRowsView.map((row) => (
                  <tr key={row.id}>
                    <td>{row.dateLabel}</td>
                    <td>{row.orderCode}</td>
                    <td>{row.boxLabel}</td>
                    <td>{row.itemCode || '-'}</td>
                    <td>{row.product}</td>
                    <td>{row.color}</td>
                    <td>{row.qty.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'saidas' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Saídas</h3>
            <span className="pill">{saidasRowsView.length} registros • {saidaTotalPecas.toLocaleString('pt-BR')} peças</span>
          </div>

          {saidasMessage && <div className="estoque-alert">{saidasMessage}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              className="input"
              placeholder="Filtrar por NF, item ou produto"
              value={saidaQuery}
              onChange={(e) => setSaidaQuery(e.target.value)}
              style={{ flex: '1 1 240px', minWidth: 200 }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn ghost" onClick={() => toggleSaidaSort('created_at')}>{sortLabel(saidaSort, 'created_at', 'Data')}</button>
              <button className="btn ghost" onClick={() => toggleSaidaSort('order_code')}>{sortLabel(saidaSort, 'order_code', 'O.S')}</button>
              <button className="btn ghost" onClick={() => toggleSaidaSort('productName')}>{sortLabel(saidaSort, 'productName', 'Produto')}</button>
            </div>
          </div>
          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>NF</th>
                  <th>Caixa</th>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Cor</th>
                  <th>Quantidade (peças)</th>
                </tr>
              </thead>
              <tbody>
                {saidasRowsView.length === 0 && (
                  <tr>
                    <td colSpan="6" className="estoque-empty">
                      {saidasLoading
                        ? 'Carregando saídas…'
                        : saidaQuery.trim()
                        ? 'Nenhuma saída encontrada para este filtro.'
                        : 'Nenhuma saída registrada.'}
                    </td>
                  </tr>
                )}
                {saidasRowsView.map((row) => (
                  <tr key={row.id || `${row.item_code}-${row.created_at}`}>
                    <td>{fmtDateTime(row.created_at)}</td>
                    <td>{row.nfDisplay || '-'}</td>
                    <td>{row.nf && (row.box_number || row.scanned_box || row.box || row.boxNumber)
                      ? `NF ${row.nf} - ${String(row.box_number || row.scanned_box || row.box || row.boxNumber).padStart(3, '0')}`
                      : '-'}</td>
                    <td>{row.item_code || '-'}</td>
                    <td>{row.productName || '-'}</td>
                    <td>{row.color || '-'}</td>
                    <td>{row.qtyNum.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'controle' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Controle de estoque</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="pill">{controleRows.length} itens</span>
              <button className="btn ghost" onClick={() => { fetchEntradas(); fetchSaidas(); }} disabled={entradasLoading || saidasLoading}>
                {entradasLoading || saidasLoading ? 'Atualizando…' : 'Atualizar Inventário'}
              </button>
            </div>
          </div>
          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Entradas</th>
                  <th>Saídas</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {controleRows.length === 0 && (
                  <tr>
                    <td colSpan="5" className="estoque-empty">Sem dados de entradas/saídas.</td>
                  </tr>
                )}
                {controleRows.map((row) => (
                  <tr key={row.itemCode || row.product}>
                    <td>{row.itemCode || '-'}</td>
                    <td>{row.product || '-'}</td>
                    <td>{row.entradas.toLocaleString('pt-BR')}</td>
                    <td>{row.saidas.toLocaleString('pt-BR')}</td>
                    <td className={row.saldo < 0 ? 'estoque-negative' : ''}>{row.saldo.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={nfModalOpen} onClose={() => setNfModalOpen(false)} title="Lançamento de Notas Fiscais">
        <div className="grid" style={{ gap: 12 }}>
          <div>
            <div className="label">Número da Nota</div>
            <input className="input" value={nfNumber} onChange={(e) => setNfNumber(e.target.value)} placeholder="Ex: 8251" />
          </div>

          {nfError && <div className="estoque-alert" role="alert">{nfError}</div>}

          <div className="sep"></div>

          {nfItems.map((item) => (
            <div key={item.id} className="nf-item-card" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-sub)' }}>
                  {item.orderCode || 'Sem O.S'} • {item.product || item.itemCode || 'Sem produto'} • {item.qty || '-'} pcs
                </div>
                <button className="btn ghost" style={{ padding: '4px 8px' }} onClick={() => toggleItemCollapse(item.id)}>{item.collapsed ? '▼' : '▲'}</button>
              </div>

              {!item.collapsed && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <div className="label">O.S</div>
                      <input
                        className="input"
                        value={item.orderCode}
                        onChange={(e) => handleUpdateNfItem(item.id, 'orderCode', e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); hydrateItemFromOrder(item.id) } }}
                        placeholder="Número da O.S"
                      />
                    </div>
                    <div>
                      <div className="label">Cod Item</div>
                      <input className="input" value={item.itemCode} onChange={(e) => handleUpdateNfItem(item.id, 'itemCode', e.target.value)} placeholder="Código do item" />
                    </div>
                    <div>
                      <div className="label">Item da NF (/)</div>
                      <input className="input" value={item.nfItem} onChange={(e) => handleUpdateNfItem(item.id, 'nfItem', e.target.value)} placeholder="Ex: 1" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <div className="label">Produto</div>
                      <input className="input" value={item.product} onChange={(e) => handleUpdateNfItem(item.id, 'product', e.target.value)} placeholder="Nome do produto" />
                    </div>
                    <div>
                      <div className="label">Cor</div>
                      <input className="input" value={item.color} onChange={(e) => handleUpdateNfItem(item.id, 'color', e.target.value)} placeholder="Cor" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <div className="label">Quantidade</div>
                      <input className="input" value={item.qty} onChange={(e) => handleUpdateNfItem(item.id, 'qty', e.target.value)} placeholder="Peças" />
                    </div>
                    <div>
                      <div className="label">Volumes</div>
                      <input className="input" value={item.volumes} onChange={(e) => handleUpdateNfItem(item.id, 'volumes', e.target.value)} placeholder="Caixas / volumes" />
                    </div>
                    <div>
                      <div className="label">Padrão</div>
                      <input className="input" value={item.padrao} onChange={(e) => handleUpdateNfItem(item.id, 'padrao', e.target.value)} placeholder="Padrão" />
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}

          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn ghost" onClick={handleAddNfItem}>+ Item</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => setNfModalOpen(false)}>Fechar</button>
              <button className="btn primary" onClick={handleSaveNF} disabled={nfSaving}>{nfSaving ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
