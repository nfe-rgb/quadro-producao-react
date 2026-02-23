// src/abas/CadastroItens.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { ADMIN_EMAILS } from '../lib/constants.js'
import { setProductImageOverride } from '../lib/productImageMap.js'
import Modal from '../components/Modal.jsx'
import Papa from 'papaparse'

// ===== Helpers locais (parse/trim) =====
const toPosInt = (v) => {
  const n = parseInt(String(v).replace(',', '.').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const toPosFloat = (v) => {
  const n = parseFloat(String(v).replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}
const toNonNegFloat = (v) => {
  const n = parseFloat(String(v).replace(',', '.').trim())
  return Number.isFinite(n) && n >= 0 ? n : null
}
const cleanText = (v) => String(v ?? '').trim()
const isUnitUN = (value) => cleanText(value).toUpperCase() === 'UN'
const formatQtyByUnit = (value, unit, maxFractionDigits = 3) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (isUnitUN(unit)) {
    return Math.round(number).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })
}
const formatQtyPerPiece = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
}
const toStructureQty = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}
const INSUMO_TECH_DEFAULTS = {
  color: '-',
  cycle_seconds: 1,
  cavities: 1,
  part_weight_g: 1,
  unit_value: 0,
  resin: '-',
}
const PRODUCT_IMAGES_BUCKET = import.meta.env.VITE_SUPABASE_PRODUCT_IMAGES_BUCKET || 'product-images'

// Cabeçalhos esperados (CSV)
const EXPECTED_HEADERS = [
  'code','description','color','cycle_seconds','cavities','part_weight_g','unit_value','resin'
]
const normalizeKey = (k) => String(k ?? '').trim().toLowerCase().replace(/\s+/g, '_')
const validateHeaders = (fields=[]) => {
  const got = new Set(fields.map(normalizeKey))
  for (const h of EXPECTED_HEADERS) if (!got.has(h)) return `Cabeçalho ausente: ${h}`
  return null
}
const getFileExtension = (fileName = '') => {
  const cleanName = String(fileName || '').trim()
  const idx = cleanName.lastIndexOf('.')
  if (idx < 0) return 'jpg'
  const ext = cleanName.slice(idx + 1).toLowerCase()
  return ext || 'jpg'
}

const sanitizeCodeForPath = (value) => String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_')

export default function CadastroItens() {
  // ============== AUTH / ADMIN ONLY GATE ==============
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      setUser(data?.user ?? null)
      setAuthChecked(true)
    })()
    return () => { active = false }
  }, [])
  const isAdmin = useMemo(() => {
    const email = user?.email?.toLowerCase()
    return !!email && Array.isArray(ADMIN_EMAILS) && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
  }, [user])

  // ============== LISTA / FETCH (sempre declarar hooks) ==============
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchItems = async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('code', { ascending: true })
    if (error) {
      setError(error.message)
      setItems([])
    } else {
      setItems(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!authChecked || !isAdmin) return
    fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isAdmin])

  const isProdutoAcabado = (item) => {
    const type = String(item?.item_type || '').trim().toLowerCase()
    if (type === 'produto_acabado') return true
    if (type === 'insumo') return false
    return String(item?.code || '').trim().startsWith('5')
  }

  const produtoAcabadoItems = useMemo(
    () => (Array.isArray(items) ? items.filter(isProdutoAcabado) : []),
    [items]
  )

  const insumoItems = useMemo(
    () => (Array.isArray(items) ? items.filter((item) => !isProdutoAcabado(item)) : []),
    [items]
  )

  const [openStructure, setOpenStructure] = useState(false)
  const [structureItem, setStructureItem] = useState(null)
  const [structureRows, setStructureRows] = useState([])
  const [structureErr, setStructureErr] = useState(null)
  const [structureSaving, setStructureSaving] = useState(false)
  const [structureLoading, setStructureLoading] = useState(false)
  const [structureOpQty, setStructureOpQty] = useState('1')
  const [structureStockByCode, setStructureStockByCode] = useState({})
  const [newStructureRow, setNewStructureRow] = useState({ itemCode: '', quantityPerPiece: '' })

  async function openStructureModal(item) {
    setOpenStructure(true)
    setStructureItem(item)
    setStructureRows([])
    setStructureErr(null)
    setStructureLoading(true)
    setStructureStockByCode({})
    setNewStructureRow({ itemCode: '', quantityPerPiece: '' })
    setStructureOpQty('1')

    const finishedCode = cleanText(item?.code)
    if (!finishedCode) {
      setStructureLoading(false)
      setStructureErr('Item inválido para estrutura.')
      return
    }

    try {
      const [structureRes, purchasesRes] = await Promise.all([
        supabase
          .from('item_structures')
          .select('*')
          .eq('finished_item_code', finishedCode)
          .order('created_at', { ascending: true }),
        supabase
          .from('estoque_purchases')
          .select('item_code,balance')
      ])

      if (structureRes.error) throw structureRes.error
      if (purchasesRes.error) throw purchasesRes.error

      const stockMap = {}
      ;(purchasesRes.data || []).forEach((row) => {
        const code = cleanText(row?.item_code)
        const balance = Number(row?.balance)
        if (!code || !Number.isFinite(balance) || balance <= 0) return
        stockMap[code] = (stockMap[code] || 0) + balance
      })

      setStructureStockByCode(stockMap)
      setStructureRows(
        (structureRes.data || []).map((row) => ({
          id: row.id,
          itemCode: cleanText(row.input_item_code),
          quantityPerPiece: Number(row.quantity_per_piece),
        }))
      )
    } catch (err) {
      setStructureErr(err?.message || 'Não foi possível carregar a estrutura do item.')
    } finally {
      setStructureLoading(false)
    }
  }

  function closeStructureModal() {
    if (structureSaving) return
    setOpenStructure(false)
    setStructureItem(null)
    setStructureRows([])
    setStructureErr(null)
    setStructureOpQty('1')
    setStructureStockByCode({})
    setNewStructureRow({ itemCode: '', quantityPerPiece: '' })
  }

  function handleAddStructureRow() {
    const itemCode = cleanText(newStructureRow.itemCode)
    const quantityPerPiece = toStructureQty(newStructureRow.quantityPerPiece)

    if (!itemCode || !quantityPerPiece) {
      setStructureErr('Informe item e quantidade por peça para adicionar à estrutura.')
      return
    }

    const alreadyExists = structureRows.some((row) => cleanText(row.itemCode) === itemCode)
    if (alreadyExists) {
      setStructureErr('Este item já foi adicionado na estrutura.')
      return
    }

    setStructureErr(null)
    setStructureRows((prev) => [...prev, { id: null, itemCode, quantityPerPiece }])
    setNewStructureRow({ itemCode: '', quantityPerPiece: '' })
  }

  function handleRemoveStructureRow(index) {
    setStructureRows((prev) => prev.filter((_, idx) => idx !== index))
  }

  async function handleSaveStructure() {
    if (!structureItem?.code) return
    setStructureErr(null)

    const finishedCode = cleanText(structureItem.code)
    const normalizedRows = structureRows
      .map((row) => ({
        itemCode: cleanText(row.itemCode),
        quantityPerPiece: toStructureQty(row.quantityPerPiece),
      }))
      .filter((row) => row.itemCode && row.quantityPerPiece)

    const duplicateCodes = new Set()
    const seen = new Set()
    normalizedRows.forEach((row) => {
      if (seen.has(row.itemCode)) duplicateCodes.add(row.itemCode)
      seen.add(row.itemCode)
    })
    if (duplicateCodes.size > 0) {
      setStructureErr('Existem insumos duplicados na estrutura.')
      return
    }

    setStructureSaving(true)
    try {
      const { error: deleteErr } = await supabase
        .from('item_structures')
        .delete()
        .eq('finished_item_code', finishedCode)

      if (deleteErr) throw deleteErr

      if (normalizedRows.length > 0) {
        const payload = normalizedRows.map((row) => ({
          finished_item_code: finishedCode,
          input_item_code: row.itemCode,
          quantity_per_piece: row.quantityPerPiece,
        }))

        const { error: insertErr } = await supabase
          .from('item_structures')
          .insert(payload)

        if (insertErr) throw insertErr
      }

      setOpenStructure(false)
      setStructureItem(null)
      setStructureRows([])
    } catch (err) {
      setStructureErr(err?.message || 'Não foi possível salvar a estrutura do item.')
    } finally {
      setStructureSaving(false)
    }
  }

  // ============== FORM / MODAL (sempre declarar hooks) ==============
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)
  const [listType, setListType] = useState('insumo')
  const [form, setForm] = useState({
    itemType: 'produto_acabado',
    code: '',
    description: '',
    color: '',
    cycle_seconds: '',
    cavities: '',
    part_weight_g: '',
    unit_value: '',
    resin: '',
    unidade: '',
    cliente: '',
    estoque_minimo: '',
  })
  const [formErr, setFormErr] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [removeProductImage, setRemoveProductImage] = useState(false)

  const resetForm = () => {
    setForm({
      itemType: 'produto_acabado',
      code: '',
      description: '',
      color: '',
      cycle_seconds: '',
      cavities: '',
      part_weight_g: '',
      unit_value: '',
      resin: '',
      unidade: '',
      cliente: '',
      estoque_minimo: '',
    })
    setImageFile(null)
    setRemoveProductImage(false)
    setFormErr(null)
  }

  const uploadProductImage = async (itemCode, file) => {
    const normalizedCode = cleanText(itemCode)
    if (!normalizedCode) throw new Error('Código do item inválido para upload da imagem.')
    if (!(file instanceof File)) throw new Error('Arquivo de imagem inválido.')

    const safeCode = sanitizeCodeForPath(normalizedCode)
    const ext = getFileExtension(file.name)
    const filePath = `${safeCode}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(filePath, file, { upsert: true, contentType: file.type || undefined })

    if (uploadError) throw uploadError

    const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(filePath)
    const publicUrl = String(data?.publicUrl || '').trim()
    if (!publicUrl) throw new Error('Não foi possível obter a URL pública da imagem.')
    return `${publicUrl}?v=${Date.now()}`
  }

  const startEdit = (item) => {
    const code = cleanText(item.code)
    const itemType = String(code).startsWith('5') ? 'produto_acabado' : 'insumo'
    setEditing(item)
    setForm({
      itemType,
      code,
      description: cleanText(item.description),
      color: cleanText(item.color),
      cycle_seconds: String(item.cycle_seconds ?? ''),
      cavities: String(item.cavities ?? ''),
      part_weight_g: String(item.part_weight_g ?? ''),
      unit_value: String(item.unit_value ?? ''),
      resin: cleanText(item.resin),
      unidade: cleanText(item.unidade),
      cliente: cleanText(item.cliente),
      estoque_minimo: String(item.estoque_minimo ?? ''),
    })
    setImageFile(null)
    setRemoveProductImage(false)
    setFormErr(null)
    setOpen(true)
  }
  const onChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }
  const validate = () => {
    const itemType = cleanText(form.itemType)
    const code = cleanText(form.code)
    const description = cleanText(form.description)
    if (!code) return 'Código é obrigatório.'
    if (!description) return 'Descrição é obrigatória.'

    if (itemType === 'insumo') {
      const unidade = cleanText(form.unidade)
      const cliente = cleanText(form.cliente)
      const estoque_minimo = toNonNegFloat(form.estoque_minimo)
      if (!unidade) return 'Unidade é obrigatória para insumo.'
      if (!cliente) return 'Cliente é obrigatório para insumo.'
      if (estoque_minimo == null) return 'Estoque mínimo deve ser um número maior ou igual a 0.'
      return null
    }

    const cycle_seconds = toPosFloat(form.cycle_seconds)
    const cavities = toPosInt(form.cavities)
    const part_weight_g = toPosFloat(form.part_weight_g)
    const unit_value = toPosFloat(form.unit_value)
    if (!cycle_seconds) return 'Ciclo (segundos) deve ser um número > 0.'
    if (!cavities) return 'Cavidades deve ser um inteiro > 0.'
    if (!part_weight_g) return 'Peso da peça (g) deve ser um número > 0.'
    if (!unit_value) return 'Valor unitário deve ser um número > 0.'
    return null
  }
  const handleSave = async () => {
    setFormErr(null)
    const err = validate()
    if (err) { setFormErr(err); return }
    const payloadBase = {
      code: cleanText(form.code),
      description: cleanText(form.description),
      item_type: cleanText(form.itemType) || 'produto_acabado',
    }
    const payload = form.itemType === 'insumo'
      ? {
          ...payloadBase,
          unidade: cleanText(form.unidade),
          cliente: cleanText(form.cliente),
          estoque_minimo: toNonNegFloat(form.estoque_minimo),
          color: cleanText(form.color) || INSUMO_TECH_DEFAULTS.color,
          cycle_seconds: toPosFloat(form.cycle_seconds) ?? INSUMO_TECH_DEFAULTS.cycle_seconds,
          cavities: toPosInt(form.cavities) ?? INSUMO_TECH_DEFAULTS.cavities,
          part_weight_g: toPosFloat(form.part_weight_g) ?? INSUMO_TECH_DEFAULTS.part_weight_g,
          unit_value: toNonNegFloat(form.unit_value) ?? INSUMO_TECH_DEFAULTS.unit_value,
          resin: cleanText(form.resin) || INSUMO_TECH_DEFAULTS.resin,
        }
      : {
          ...payloadBase,
          color: cleanText(form.color),
          cycle_seconds: toPosFloat(form.cycle_seconds),
          cavities: toPosInt(form.cavities),
          part_weight_g: toPosFloat(form.part_weight_g),
          unit_value: toPosFloat(form.unit_value),
          resin: cleanText(form.resin),
          unidade: null,
          cliente: null,
          estoque_minimo: null,
        }
    setSaving(true)
    let q = null
    if (editing?.id) {
      q = supabase.from('items').update(payload).eq('id', editing.id)
    } else {
      q = supabase.from('items').insert(payload)
    }
    const { error } = await q
    if (error) {
      setSaving(false)
      setFormErr(error.message ?? 'Erro ao salvar.')
      return
    }

    try {
      if (form.itemType === 'insumo') {
        const code = cleanText(form.code)
        if (removeProductImage) {
          setProductImageOverride(code, '')
        }

        if (imageFile) {
          const imageUrl = await uploadProductImage(code, imageFile)
          setProductImageOverride(code, imageUrl)
        }
      }
    } catch (imgErr) {
      setSaving(false)
      setFormErr(`Item salvo, mas não foi possível anexar a imagem: ${imgErr?.message || 'erro desconhecido'}`)
      await fetchItems()
      return
    }

    setSaving(false)
    setOpen(false)
    resetForm()
    setEditing(null)
    await fetchItems()
  }

  // ============== IMPORTAR CSV ==============
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState(null)
  const fileInputRef = useRef(null)

  function triggerPickCSV() {
    setImportErr(null)
    fileInputRef.current?.click()
  }
  async function handlePickCSV(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportErr(null)
    try {
      await handleImportCSV(file)
    } finally {
      e.target.value = ''
    }
  }
  async function parseCSVFile(file, delimiter) {
    return new Promise((resolve) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter,
        transformHeader: normalizeKey,
        complete: ({ data, meta, errors }) => resolve({ data, meta, errors })
      })
    })
  }

  function mapRows(data) {
    const seenCodes = new Set()
    const mapped = []
    for (const row of data) {
      const payload = {
        code: cleanText(row.code),
        description: cleanText(row.description),
        color: cleanText(row.color),
        cycle_seconds: toPosFloat(row.cycle_seconds),
        cavities: toPosInt(row.cavities),
        part_weight_g: toPosFloat(row.part_weight_g),
        unit_value: toPosFloat(row.unit_value),
        resin: cleanText(row.resin),
      }
      if (!payload.code || !payload.description) continue
      if (!payload.cycle_seconds || !payload.cavities || !payload.part_weight_g || !payload.unit_value) continue
      if (seenCodes.has(payload.code)) continue
      seenCodes.add(payload.code)
      mapped.push(payload)
    }
    return mapped
  }

  async function handleImportCSV(file) {
    // tenta autodetectar, depois força delimitadores comuns (Excel PT-BR usa ;)
    const delimiters = [undefined, ';', '\t', ',']
    let best = null
    let firstError = null

    for (const delimiter of delimiters) {
      const parsed = await parseCSVFile(file, delimiter)
      const { data, meta, errors } = parsed
      const hdrErr = validateHeaders(meta.fields || [])
      const mapped = hdrErr ? [] : mapRows(data)

      if (!firstError && errors?.length) firstError = errors[0].message

      if (!hdrErr && mapped.length) { best = { mapped }; break }

      // guarda a melhor tentativa até agora para diagnóstico
      if (!best || mapped.length > (best.mapped?.length || 0)) {
        best = { mapped, hdrErr, errors }
      }
    }

    if (!best || best.hdrErr) {
      setImportErr(best?.hdrErr || `Erro ao ler CSV: ${firstError || 'verifique delimitador (use ; ou ,) e cabeçalhos'}`)
      return
    }

    if (!best.mapped?.length) {
      setImportErr('Nenhuma linha válida encontrada no CSV.')
      return
    }

    setImporting(true)
    let failed = null
    const CHUNK = 300
    for (let i = 0; i < best.mapped.length; i += CHUNK) {
      const slice = best.mapped.slice(i, i + CHUNK)
      const { error } = await supabase.from('items').upsert(slice, { onConflict: 'code', ignoreDuplicates: true })
      if (error) { failed = error.message; break }
    }
    setImporting(false)

    if (failed) setImportErr('Erro ao importar: ' + failed)
    else await fetchItems()
  }
  function downloadCSVTemplate() {
    const header = EXPECTED_HEADERS.join(',') + '\n'
    const sample = [
      'ABC-001,Tampa 200ml,Branco,12,2,8.5,0.32,PP',
      'ABC-002,Tampa 500ml,Preto,14,4,10.2,0.35,PEAD',
    ].join('\n')
    const blob = new Blob([header + sample], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'items-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ============== RENDER ==============
  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      {/* Estados de permissão/autenticação */}
      {!authChecked && (
        <div style={{ padding: 16 }}>
          <small>Verificando permissões…</small>
        </div>
      )}

      {authChecked && !isAdmin && (
        <div style={{ padding: 24 }}>
          <h3>Não encontrado</h3>
          <p>Esta página não está disponível.</p>
        </div>
      )}

      {authChecked && isAdmin && (
        <>
          {/* HEADER / AÇÕES */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>Cadastro de Itens</h2>
              <small style={{ opacity: 0.8 }}>Somente administradores</small>
            </div>
              <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={downloadCSVTemplate}
                style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid #ddd', cursor: 'pointer', fontWeight: 600, background: '#fff' }}
                title="Baixar modelo CSV"
              >
                Baixar modelo CSV
              </button>

              <button
                onClick={triggerPickCSV}
                style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid #ddd', cursor: 'pointer', fontWeight: 600, background: importing ? '#f2f2f2' : '#fff' }}
                disabled={importing}
                title="Importar CSV"
              >
                {importing ? 'Importando…' : 'Importar CSV'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handlePickCSV}
              />

              <button
                onClick={() => { setEditing(null); resetForm(); setOpen(true) }}
                style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid #ddd', cursor: 'pointer', fontWeight: 600 }}
              >
                Cadastrar item
              </button>
            </div>
          </div>

          {importErr && (
            <div style={{ padding: 10, borderRadius: 10, background: '#fff3f3', color: '#a80000' }}>
              {importErr}
            </div>
          )}

          {/* LISTAGEM DE ITENS */}
          {loading ? (
            <div style={{ padding: 16 }}>Carregando…</div>
          ) : error ? (
            <div style={{ padding: 16, color: '#b00020' }}>Erro: {error}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 16, opacity: 0.7 }}>Nenhum item cadastrado ainda.</div>
          ) : (
            <div style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: 12, background: '#fafafa', borderBottom: '1px solid #eee', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setListType('insumo')}
                  style={listType === 'insumo' ? btnTypeActive : btnType}
                >
                  Insumos ({insumoItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setListType('produto_acabado')}
                  style={listType === 'produto_acabado' ? btnTypeActive : btnType}
                >
                  Produtos acabados ({produtoAcabadoItems.length})
                </button>
              </div>

              {listType === 'insumo' ? (
                insumoItems.length === 0 ? (
                  <div style={{ padding: 16, opacity: 0.7 }}>Nenhum insumo cadastrado.</div>
                ) : (
                  <div style={{ width: '100%', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f6f6f6' }}>
                          <th style={th}>Código</th>
                          <th style={th}>Descrição</th>
                          <th style={th}>Unidade</th>
                          <th style={th}>Cliente</th>
                          <th style={th}>Estoque mínimo</th>
                          <th style={th}>Criado em</th>
                          <th style={th}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insumoItems.map((it) => (
                          <tr key={it.id} style={{ borderTop: '1px solid #eee' }}>
                            <td style={td}>{it.code}</td>
                            <td style={td}>{it.description}</td>
                            <td style={td}>{it.unidade || '-'}</td>
                            <td style={td}>{it.cliente || '-'}</td>
                            <td style={tdNum}>{it.estoque_minimo ?? '-'}</td>
                            <td style={td}>{formatDate(it.created_at)}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => startEdit(it)}
                                style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                produtoAcabadoItems.length === 0 ? (
                  <div style={{ padding: 16, opacity: 0.7 }}>Nenhum produto acabado cadastrado.</div>
                ) : (
                  <div style={{ width: '100%', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f6f6f6' }}>
                          <th style={th}>Código</th>
                          <th style={th}>Descrição</th>
                          <th style={th}>Cor</th>
                          <th style={th}>Ciclo (s)</th>
                          <th style={th}>Cav.</th>
                          <th style={th}>Peso (g)</th>
                          <th style={th}>Valor (R$)</th>
                          <th style={th}>Resina</th>
                          <th style={th}>Criado em</th>
                          <th style={th}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {produtoAcabadoItems.map((it) => (
                          <tr key={it.id} style={{ borderTop: '1px solid #eee' }}>
                            <td style={td}>{it.code}</td>
                            <td style={td}>{it.description}</td>
                            <td style={td}>{it.color}</td>
                            <td style={tdNum}>{it.cycle_seconds}</td>
                            <td style={tdNum}>{it.cavities}</td>
                            <td style={tdNum}>{it.part_weight_g}</td>
                            <td style={tdNum}>{it.unit_value}</td>
                            <td style={td}>{it.resin}</td>
                            <td style={td}>{formatDate(it.created_at)}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => openStructureModal(it)}
                                style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600, marginRight: 8 }}
                              >
                                Estrutura
                              </button>
                              <button
                                onClick={() => startEdit(it)}
                                style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          )}

          {/* MODAL: CADASTRO DE ITEM */}
          <Modal open={open} onClose={() => !saving && setOpen(false)} title={editing?.id ? 'Editar item' : 'Cadastrar item'}>
            <div style={{ display: 'grid', gap: 12, paddingTop: 4 }}>
              {formErr && (
                <div style={{ padding: 10, borderRadius: 10, background: '#fff3f3', color: '#a80000' }}>
                  {formErr}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, itemType: 'produto_acabado' }))}
                  style={form.itemType === 'produto_acabado' ? btnTypeActive : btnType}
                >
                  Produto acabado
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, itemType: 'insumo' }))}
                  style={form.itemType === 'insumo' ? btnTypeActive : btnType}
                >
                  Insumo
                </button>
              </div>

              <div style={grid2}>
                <Field label="Código*" name="code" value={form.code} onChange={onChange} placeholder="Ex.: ABC-123" />
                <Field label="Descrição*" name="description" value={form.description} onChange={onChange} placeholder="Nome da peça" />
              </div>

              {form.itemType === 'insumo' ? (
                <>
                  <div style={grid3}>
                    <Field label="Unidade*" name="unidade" value={form.unidade} onChange={onChange} placeholder="Ex.: KG / L / UN" />
                    <Field label="Cliente*" name="cliente" value={form.cliente} onChange={onChange} placeholder="Nome do cliente" />
                    <Field label="Estoque mínimo*" name="estoque_minimo" value={form.estoque_minimo} onChange={onChange} inputMode="decimal" placeholder="Ex.: 100" />
                  </div>

                  <div style={grid2}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.9 }}>Anexar imagem</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null
                          setImageFile(file)
                          if (file) {
                            setRemoveProductImage(false)
                          }
                        }}
                        style={input}
                      />
                    </label>
                  </div>

                  {imageFile && (
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {`Imagem selecionada: ${imageFile.name}`}
                    </div>
                  )}

                  {editing?.id && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveProductImage(true)
                          setImageFile(null)
                        }}
                        style={btnGhost}
                      >
                        Remover imagem vinculada
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={grid3}>
                    <Field label="Cor" name="color" value={form.color} onChange={onChange} placeholder="Ex.: Preto" />
                    <Field label="Ciclo (segundos)*" name="cycle_seconds" value={form.cycle_seconds} onChange={onChange} inputMode="decimal" placeholder="Ex.: 12.5" />
                    <Field label="Cavidades*" name="cavities" value={form.cavities} onChange={onChange} inputMode="numeric" placeholder="Ex.: 4" />
                  </div>

                  <div style={grid3}>
                    <Field label="Peso da peça (g)*" name="part_weight_g" value={form.part_weight_g} onChange={onChange} inputMode="decimal" placeholder="Ex.: 8.7" />
                    <Field label="Valor unitário (R$)*" name="unit_value" value={form.unit_value} onChange={onChange} inputMode="decimal" placeholder="Ex.: 0.32" />
                    <Field label="Resina utilizada" name="resin" value={form.resin} onChange={onChange} placeholder="Ex.: PP / PEAD / ABS…" />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button disabled={saving} onClick={() => setOpen(false)} style={btnGhost}>Cancelar</button>
                <button disabled={saving} onClick={handleSave} style={btnPrimary}>{saving ? 'Salvando…' : (editing?.id ? 'Atualizar' : 'Salvar')}</button>
              </div>
            </div>
          </Modal>

          <Modal
            open={openStructure}
            onClose={closeStructureModal}
            closeOnBackdrop={false}
            modalClassName="modal-xl"
            title={structureItem ? `Estrutura do item • ${structureItem.code} - ${structureItem.description}` : 'Estrutura do item'}
          >
            <div style={{ display: 'grid', gap: 12 }}>
              {structureErr && (
                <div style={{ padding: 10, borderRadius: 10, background: '#fff3f3', color: '#a80000' }}>
                  {structureErr}
                </div>
              )}

              <label style={{ display: 'grid', gap: 6, maxWidth: 220 }}>
                <span style={{ fontSize: 12, opacity: 0.9 }}>Quantidade da O.P (simulação de total)</span>
                <input
                  value={structureOpQty}
                  onChange={(e) => setStructureOpQty(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex.: 1000"
                  style={input}
                />
              </label>

              {structureLoading ? (
                <div style={{ padding: 8 }}>Carregando estrutura…</div>
              ) : (
                <div style={{ width: '100%', overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f6f6f6' }}>
                        <th style={th}>Cod</th>
                        <th style={th}>Descrição</th>
                        <th style={th}>Unidade</th>
                        <th style={th}>Estoque</th>
                        <th style={th}>Quantidade</th>
                        <th style={th}>Total</th>
                        <th style={th}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {structureRows.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ ...td, opacity: 0.7 }}>Nenhum insumo na estrutura.</td>
                        </tr>
                      )}
                      {structureRows.map((row, idx) => {
                        const code = cleanText(row.itemCode)
                        const source = insumoItems.find((it) => cleanText(it.code) === code)
                        const unit = source?.unidade || ''
                        const perPiece = toStructureQty(row.quantityPerPiece)
                        const opQty = toStructureQty(structureOpQty) || 0
                        const totalRaw = perPiece ? perPiece * opQty : null
                        const total = totalRaw != null && isUnitUN(unit) ? Math.round(totalRaw) : totalRaw

                        return (
                          <tr key={row.id || `${code}-${idx}`} style={{ borderTop: '1px solid #eee' }}>
                            <td style={td}>{code || '-'}</td>
                            <td style={td}>{source?.description || '-'}</td>
                            <td style={td}>{unit || '-'}</td>
                            <td style={tdNum}>{formatQtyByUnit(structureStockByCode[code] || 0, unit, 3)}</td>
                            <td style={tdNum}>{formatQtyPerPiece(row.quantityPerPiece || 0)}</td>
                            <td style={tdNum}>{total != null ? formatQtyByUnit(total, unit, 3) : '-'}</td>
                            <td style={td}>
                              <button
                                type="button"
                                onClick={() => handleRemoveStructureRow(idx)}
                                style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ display: 'grid', gap: 8, border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
                <div style={{ fontWeight: 700 }}>Adicionar insumo na estrutura</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr auto', gap: 8 }}>
                  <select
                    value={newStructureRow.itemCode}
                    onChange={(e) => setNewStructureRow((prev) => ({ ...prev, itemCode: e.target.value }))}
                    style={input}
                  >
                    <option value="">Selecione o insumo</option>
                    {insumoItems.map((insumo) => (
                      <option key={insumo.id || insumo.code} value={insumo.code}>
                        {insumo.code} - {insumo.description}
                      </option>
                    ))}
                  </select>

                  <input
                    value={newStructureRow.quantityPerPiece}
                    onChange={(e) => setNewStructureRow((prev) => ({ ...prev, quantityPerPiece: e.target.value }))}
                    placeholder="Qtd por peça"
                    inputMode="decimal"
                    style={input}
                  />

                  <button type="button" onClick={handleAddStructureRow} style={btnGhost}>Adicionar</button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={closeStructureModal} style={btnGhost} disabled={structureSaving}>Cancelar</button>
                <button type="button" onClick={handleSaveStructure} style={btnPrimary} disabled={structureSaving}>
                  {structureSaving ? 'Salvando…' : 'Salvar estrutura'}
                </button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}

// ======= Subcomponentes simples (input/label) =======
function Field({ label, name, value, onChange, inputMode, placeholder }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, opacity: 0.9 }}>{label}</span>
      <input
        name={name}
        value={value}
        onChange={onChange}
        inputMode={inputMode}
        placeholder={placeholder}
        style={input}
      />
    </label>
  )
}

// ======= Estilos inline básicos =======
const th = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 700,
  fontSize: 13,
  borderBottom: '1px solid #eee',
}
const td = {
  padding: '10px 12px',
  fontSize: 13,
  verticalAlign: 'top',
}
const tdNum = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }
const input = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #ddd',
  outline: 'none',
}
const btnPrimary = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid #0a7',
  background: '#0a7',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
}
const btnGhost = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid #ddd',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
}
const btnType = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #ddd',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
}
const btnTypeActive = {
  ...btnType,
  border: '1px solid #0a7',
  background: '#eafaf5',
  color: '#0a7',
}

// ======= Utils locais =======
function formatDate(iso) {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return String(iso)
  }
}
