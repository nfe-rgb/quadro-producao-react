// src/pages/Ficha.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { MAQUINAS } from '../lib/constants'
import {
  fetchSheets,
  createSheetWithRevision,
  createRevision,
  deleteSheet,
} from '../lib/techSheetService'
import { fetchItemByCode } from '../lib/techSheetService'
import FichaTemplateNissei from '../components/FichaTemplateNissei'
import { supabase } from '../lib/supabaseClient'
import '../styles/ficha.css'

const emptyForm = {
  machine_id: 'P1',
  item_code: '',
  parameters: '',
  author: '',
}

const ddItem = {
  padding: '10px 12px',
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
}

const ddItemMuted = {
  padding: '10px 12px',
  opacity: 0.7,
}

export default function Ficha() {
  const [filters, setFilters] = useState({ machine: '', item: '' })
  const [searchFilters, setSearchFilters] = useState({ machine: '', item: '' })
  const [form, setForm] = useState(emptyForm)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [addingRevisionFor, setAddingRevisionFor] = useState(null)
  const [revForm, setRevForm] = useState({ parameters: '', author: '', changes: '' })
  const [structuredParams, setStructuredParams] = useState(null)
  const [revStructuredParams, setRevStructuredParams] = useState(null)
  const [revSaving, setRevSaving] = useState(false)
  const [expanded, setExpanded] = useState(new Set())
  const [latestOpen, setLatestOpen] = useState(new Set())
  const [revOpenState, setRevOpenState] = useState(new Map())
  const [itemMeta, setItemMeta] = useState(null)
  const [revItemMeta, setRevItemMeta] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [qItem, setQItem] = useState('')
  const [itemSuggestions, setItemSuggestions] = useState([])
  const [itemOpenList, setItemOpenList] = useState(false)
  const [itemLoading, setItemLoading] = useState(false)
  const [itemErr, setItemErr] = useState(null)
  const [templateKey, setTemplateKey] = useState(0)
  const [revTemplateKey, setRevTemplateKey] = useState(0)
  const itemDebRef = useRef(null)
  const itemListRef = useRef(null)

  function safeParse(json) {
    try {
      return JSON.parse(json || '{}')
    } catch (_) {
      return null
    }
  }

  const filteredList = useMemo(() => {
    return list
      .filter((s) => !filters.machine || s.machine_id === filters.machine)
      .filter((s) => !filters.item || String(s.item_code || '').toUpperCase() === String(filters.item).toUpperCase())
  }, [list, filters])

  function applySearch() {
    setFilters({ ...searchFilters, item: String(searchFilters.item || '').trim() })
  }

  async function reload() {
    setLoading(true)
    const data = await fetchSheets({ machineId: filters.machine, itemCode: filters.item })
    setList(data)
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    async function loadItem() {
      const code = String(form.item_code || '').trim()
      if (!code) {
        setItemMeta(null)
        return
      }
      const data = await fetchItemByCode(code)
      if (!active) return
      setItemMeta(data)
    }
    loadItem()
    return () => { active = false }
  }, [form.item_code])

  useEffect(() => {
    let active = true
    async function loadRevItem() {
      const sheet = list.find((s) => s.id === addingRevisionFor)
      const code = String(sheet?.item_code || '').trim()
      if (!code) {
        setRevItemMeta(null)
        return
      }
      const data = await fetchItemByCode(code)
      if (!active) return
      setRevItemMeta(data)
    }
    loadRevItem()
    return () => { active = false }
  }, [addingRevisionFor, list])

  useEffect(() => { reload() }, [filters.machine, filters.item])

  // busca de itens (mesma UX da criação de ordem)
  useEffect(() => { setQItem(form.item_code || '') }, [])

  useEffect(() => {
    if (itemDebRef.current) clearTimeout(itemDebRef.current)
    const term = (qItem || '').trim()
    if (!term) {
      setItemSuggestions([])
      setItemOpenList(false)
      setItemErr(null)
      return
    }
    itemDebRef.current = setTimeout(async () => { await fetchByItemTerm(term) }, 250)
    return () => { if (itemDebRef.current) clearTimeout(itemDebRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qItem])

  async function fetchByItemTerm(term) {
    setItemLoading(true); setItemErr(null)
    const codeGuess = term.split('-')[0]?.trim()
    const ors = [
      `code.ilike.%${escapeLike(term)}%`,
      `description.ilike.%${escapeLike(term)}%`,
    ]
    if (codeGuess && codeGuess.length >= 2) {
      ors.unshift(`code.ilike.%${escapeLike(codeGuess)}%`)
    }
    const { data, error } = await supabase
      .from('items')
      .select('id, code, description, color')
      .or(ors.join(','))
      .order('code', { ascending: true })
      .limit(12)
    setItemLoading(false)
    if (error) { setItemErr(error.message); setItemSuggestions([]); setItemOpenList(false); return }
    setItemSuggestions(data || [])
    setItemOpenList((data || []).length > 0)
    const exact = (data || []).find((it) => isExactItemMatch(term, it))
    if (exact) applyItem(exact)
  }

  function isExactItemMatch(term, it) {
    const t = String(term || '').toLowerCase().trim()
    const code = String(it.code || '').toLowerCase().trim()
    const desc = String(it.description || '').toLowerCase().trim()
    return t === code || t === `${code} - ${desc}`.toLowerCase()
  }

  function escapeLike(s) { return String(s).replace(/[%_]/g, (m) => '\\' + m) }

  function applyItem(it) {
    setQItem(`${it.code} - ${it.description}`)
    setForm((f) => ({ ...f, item_code: it.code }))
    setItemOpenList(false)
  }

  function pickSuggestion(it) { applyItem(it) }

  useEffect(() => {
    function onDocClick(e) {
      if (!itemListRef.current) return
      if (!itemListRef.current.contains(e.target)) setItemOpenList(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])


  function resetForm() {
    const defaultMachine = filters.machine || emptyForm.machine_id
    setForm({ ...emptyForm, machine_id: defaultMachine })
    setQItem('')
    setItemSuggestions([])
    setItemOpenList(false)
    setItemErr(null)
    setStructuredParams(null)
    setItemMeta(null)
    setTemplateKey((k) => k + 1)
  }

  function materialFromParams(params) {
    try {
      const parsed = JSON.parse(params || '{}')
      return parsed?.cliente?.material || ''
    } catch (_) {
      return ''
    }
  }

  function normalizeStr(s) {
    return String(s || '').trim().toLowerCase()
  }

  function sheetMaterial(sheet) {
    const latestParams = sheet.revisions?.[0]?.parameters
    const mat = materialFromParams(latestParams) || firstMaterialFromRevisions(sheet.revisions)
    return mat || ''
  }

  function firstMaterialFromRevisions(revs) {
    if (!Array.isArray(revs)) return ''
    for (const rev of revs) {
      const mat = materialFromParams(rev?.parameters)
      if (mat) return mat
    }
    return ''
  }

  function moldeFromParams(params) {
    try {
      const parsed = JSON.parse(params || '{}')
      return parsed?.cabecalho?.molde || ''
    } catch (_) {
      return ''
    }
  }

  function sheetDisplayDescription(sheet) {
    const latestParams = sheet.revisions?.[0]?.parameters
    const mat = materialFromParams(latestParams) || firstMaterialFromRevisions(sheet.revisions)
    const molde = moldeFromParams(latestParams)

    const code = sheet.item_code || ''
    const base = String(sheet.description || '').trim()

    // Se a descrição salva é só o código, use o molde para completar
    let composed = base
    if (!composed && (code || molde)) {
      composed = [code, molde].filter(Boolean).join(' - ')
    } else if (composed && molde && composed === code) {
      composed = [code, molde].filter(Boolean).join(' - ')
    }

    // Evita duplicar o molde se já está presente
    if (composed && molde && !composed.toLowerCase().includes(molde.toLowerCase())) {
      const withMolde = [code || composed, molde].filter(Boolean).join(' - ')
      composed = withMolde
    }

    // Acrescenta o material se não estiver presente
    if (composed && mat && !composed.toLowerCase().includes(mat.toLowerCase())) {
      composed = `${composed} • ${mat}`
    } else if (!composed && mat) {
      composed = [code, mat].filter(Boolean).join(' - ')
    }

    return composed || code || 'Sem descrição'
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.machine_id || !form.item_code) {
      alert('Preencha máquina e item.');
      return
    }
    if (!form.parameters) {
      alert('Gere os parâmetros técnicos pelo formulário estruturado antes de salvar.');
      return
    }
    const newMatNorm = normalizeStr(materialFromParams(form.parameters))
    const duplicate = list.some((s) => normalizeStr(s.item_code) === normalizeStr(form.item_code)
      && normalizeStr(sheetMaterial(s)) === newMatNorm)
    if (duplicate) {
      alert('Já existe uma ficha para este item com o mesmo material utilizado. Altere o material para criar uma nova ficha.')
      return
    }
    const ok = window.confirm('Confirmar salvamento da ficha técnica?')
    if (!ok) return
    const molde = moldeFromParams(form.parameters)
    const baseDesc = [form.item_code, molde].filter(Boolean).join(' - ') || form.item_code
    const finalDescription = baseDesc
    const created = await createSheetWithRevision({
      machineId: form.machine_id,
      itemCode: form.item_code,
      description: finalDescription,
      parameters: form.parameters,
      author: form.author,
    })
    setList((prev) => [created, ...prev])
    resetForm()
  }

  async function handleNewRevision(sheet) {
    if (revSaving) return
    if (!revForm.parameters) {
      alert('Gere os parâmetros técnicos pelo formulário estruturado antes de salvar a revisão.');
      return
    }
    if (!revForm.author) {
      alert('Informe o responsável pela alteração.');
      return
    }
    const ok = window.confirm('Confirmar salvamento da revisão?')
    if (!ok) return
    setRevSaving(true)
    try {
      const latest = sheet.revisions?.[0]
      const previousParams = latest?.parameters
      const diffText = buildDiffText(previousParams, revForm.parameters)
      const updated = await createRevision({
        sheetId: sheet.id,
        machineId: sheet.machine_id,
        itemCode: sheet.item_code,
        description: sheet.description,
        parameters: revForm.parameters,
        author: revForm.author,
        changes: diffText,
      })

      // merge revisions locally
      setList((prev) => {
        const idx = prev.findIndex((s) => String(s.id) === String(sheet.id))
        if (idx === -1) return prev
        const copy = [...prev]
        const merged = {
          ...prev[idx],
          description: updated.description || prev[idx].description,
          revisions: [updated.revisions?.[0], ...(prev[idx].revisions || [])],
        }
        copy[idx] = merged
        return copy
      })
      // refetch to ensure realtime sync (supabase policies / other tabs)
      try {
        const refreshed = await fetchSheets({ machineId: filters.machine, itemCode: filters.item })
        if (Array.isArray(refreshed) && refreshed.length) {
          setList(refreshed)
        }
      } catch (fetchErr) {
        console.warn('handleNewRevision: falha ao refazer fetchSheets, mantendo lista local', fetchErr)
      }
      setAddingRevisionFor(null)
    } catch (err) {
      console.warn('handleNewRevision falhou', err)
      alert('Falha ao salvar revisão. Verifique conexão/permissões e tente novamente.')
    } finally {
      setRevSaving(false)
    }
  }

  function toggleRevisionOpen(sheetId, revision, defaultOpen = false) {
    const key = `${sheetId}-${revision}`
    setRevOpenState((prev) => {
      const next = new Map(prev)
      const current = next.has(key) ? next.get(key) : defaultOpen
      next.set(key, !current)
      return next
    })
  }

  function setAllRevisionsOpen(sheet, open) {
    if (!sheet?.revisions?.length) return
    setRevOpenState((prev) => {
      const next = new Map(prev)
      sheet.revisions.forEach((rev) => {
        const key = `${sheet.id}-rev-${rev.revision}`
        next.set(key, open)
      })
      return next
    })
  }

  function safeParseJSON(json) {
    try {
      return JSON.parse(json || '{}')
    } catch (_) {
      return {}
    }
  }

  function buildDiffText(prevParams, nextParams) {
    const prev = safeParseJSON(prevParams)
    const next = safeParseJSON(nextParams)

    const changes = []

    function pushChange(label, before, after) {
      const b = before ?? ''
      const a = after ?? ''
      if (String(b) === String(a)) return
      changes.push(`Alterado ${label} de ${b || 'vazio'} para ${a || 'vazio'}`)
    }

    // Helpers
    const compareTemps = (arrPrev = [], arrNext = [], sideLabel) => {
      const max = Math.max(arrPrev.length, arrNext.length)
      for (let i = 0; i < max; i += 1) {
        const p = arrPrev[i] || {}
        const n = arrNext[i] || {}
        const label = n.label || p.label
        if (!label) continue
        pushChange(`${sideLabel} ${label}`, p.pv, n.pv)
      }
    }

    // Cabeçalho
    pushChange('Molde', prev.cabecalho?.molde, next.cabecalho?.molde)
    pushChange('Cod. Item', prev.cabecalho?.codItem, next.cabecalho?.codItem)
    pushChange('Peso do Produto', prev.cabecalho?.pesoProduto, next.cabecalho?.pesoProduto)
    pushChange('Tempo de Ciclo', prev.cabecalho?.tempoCiclo, next.cabecalho?.tempoCiclo)
    pushChange('Número de Cavidades', prev.cabecalho?.numCavidades, next.cabecalho?.numCavidades)
    pushChange('Checado por', prev.cabecalho?.checadoPor, next.cabecalho?.checadoPor)

    // Materiais Utilizados
    pushChange('Cliente', prev.cliente?.nomeCliente, next.cliente?.nomeCliente)
    pushChange('Material', prev.cliente?.material, next.cliente?.material)
    pushChange('Cor / Pigmento', prev.cliente?.corPigmento, next.cliente?.corPigmento)
    pushChange('Tempo dosagem pigmento', prev.cliente?.tempoDosagem, next.cliente?.tempoDosagem)
    pushChange('Velocidade dosagem', prev.cliente?.velocidadeDosagem, next.cliente?.velocidadeDosagem)
    pushChange('% aplicação', prev.cliente?.aplicacao, next.cliente?.aplicacao)

    // Suprimento / Pneumática
    pushChange('Temp. Água', prev.suprimentoAgua?.tempAgua, next.suprimentoAgua?.tempAgua)
    pushChange('Pressão ar Sopro', prev.pneumatica?.arSopro, next.pneumatica?.arSopro)
    pushChange('Pressão ar Operação', prev.pneumatica?.arOperacao, next.pneumatica?.arOperacao)

    // Controle Injeção
    pushChange('Pressão Injeção', prev.controleInjecao?.pressaoInjecao, next.controleInjecao?.pressaoInjecao)
    pushChange('Pressão Recalque', prev.controleInjecao?.pressaoRecalque, next.controleInjecao?.pressaoRecalque)
    pushChange('Contrapressão', prev.controleInjecao?.contrapressao, next.controleInjecao?.contrapressao)
    pushChange('Velocidade Injeção', prev.controleInjecao?.velocidadeInjecao, next.controleInjecao?.velocidadeInjecao)

    // Posição Injeção
    pushChange('Carga', prev.posicaoInjecao?.carga, next.posicaoInjecao?.carga)
    pushChange('Recalque', prev.posicaoInjecao?.recalque, next.posicaoInjecao?.recalque)

    // Temperaturas
    compareTemps(prev.tempsLeft, next.tempsLeft, 'Temperatura Lado A')
    compareTemps(prev.tempsRight, next.tempsRight, 'Temperatura Lado B')

    // Molde valores
    const maxRows = Math.max((prev.moldeValores || []).length, (next.moldeValores || []).length)
    for (let i = 0; i < maxRows; i += 1) {
      const p = (prev.moldeValores || [])[i] || {}
      const n = (next.moldeValores || [])[i] || {}
      const rowLabel = `Linha ${i + 1}`
      pushChange(`${rowLabel} - Injeção`, p.injValor, n.injValor)
      pushChange(`${rowLabel} - Sopro`, p.soproVal, n.soproVal)
      pushChange(`${rowLabel} - Condicionamento`, p.condVal, n.condVal)
      pushChange(`${rowLabel} - Opcional`, p.opcVal, n.opcVal)
    }

    // Observações
    pushChange('Observações', prev.observacoes, next.observacoes)

    if (!changes.length) return 'Sem alterações registradas'
    return changes.join('\n')
  }

  function toggleLatest(sheetId) {
    setLatestOpen((prev) => {
      const n = new Set(prev)
      if (n.has(sheetId)) n.delete(sheetId); else n.add(sheetId)
      return n
    })
  }

  function renderStructured(params) {
    let parsed = null
    try {
      const obj = JSON.parse(params)
      if (obj && typeof obj === 'object') parsed = obj
    } catch (_) { parsed = null }
    if (!parsed) return null

    const cab = parsed.cabecalho || {}
    const cli = parsed.cliente || {}
    const sup = parsed.suprimentoAgua || {}
    const pneu = parsed.pneumatica || {}
    const ctrl = parsed.controleInjecao || {}
    const pos = parsed.posicaoInjecao || {}
    const tempsL = parsed.tempsLeft || []
    const tempsR = parsed.tempsRight || []
    const molde = parsed.moldeValores || []
    const obs = parsed.observacoes

    return (
      <div className="ficha-structured-view">
        <div className="ficha-grid">
          <div><strong>Molde</strong><div>{cab.molde || '—'}</div></div>
          <div><strong>Cod. Item</strong><div>{cab.codItem || '—'}</div></div>
          <div><strong>Peso do Produto</strong><div>{cab.pesoProduto || '—'}</div></div>
          <div><strong>Tempo de Ciclo</strong><div>{cab.tempoCiclo || '—'}</div></div>
          <div><strong>Número de Cavidades</strong><div>{cab.numCavidades || '—'}</div></div>
          <div><strong>Checado por</strong><div>{cab.checadoPor || '—'}</div></div>
        </div>

        <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 12 }}>
          <div>
            <h4>Material Utilizado</h4>
            <div><strong>Material</strong><div>{cli.material || '—'}</div></div>
            <div><strong>Cor / Pigmento</strong><div>{cli.corPigmento || '—'}</div></div>
            <div><strong>Tempo dosagem pigmento</strong><div>{cli.tempoDosagem || '—'}</div></div>
            <div><strong>Velocidade dosagem</strong><div>{cli.velocidadeDosagem || '—'}</div></div>
            <div><strong>% aplicação</strong><div>{cli.aplicacao || '—'}</div></div>
          </div>
          <div>
            <h4>Suprimento / Pneumática</h4>
            <div><strong>Temp. Água</strong><div>{sup.tempAgua || '—'}</div></div>
            <div><strong>Pressão ar Sopro</strong><div>{pneu.arSopro || '—'}</div></div>
            <div><strong>Pressão ar Operação</strong><div>{pneu.arOperacao || '—'}</div></div>
          </div>
        </div>

        <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 12 }}>
          <div>
            <h4>Controle Injeção</h4>
            <div><strong>Pressão Injeção</strong><div>{ctrl.pressaoInjecao || '—'}</div></div>
            <div><strong>Pressão Recalque</strong><div>{ctrl.pressaoRecalque || '—'}</div></div>
            <div><strong>Contrapressão</strong><div>{ctrl.contrapressao || '—'}</div></div>
            <div><strong>Velocidade Injeção</strong><div>{ctrl.velocidadeInjecao || '—'}</div></div>
          </div>
          <div>
            <h4>Posição Injeção</h4>
            <div><strong>Carga</strong><div>{pos.carga || '—'}</div></div>
            <div><strong>Recalque</strong><div>{pos.recalque || '—'}</div></div>
          </div>
        </div>

        <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 12 }}>
          <div>
            <h4>Temperatura Lado A</h4>
            {tempsL.map((t) => (
              <div key={t.label} className="ficha-row-inline">
                <span>{t.label}</span>
                <span>{t.pv || '—'}</span>
              </div>
            ))}
          </div>
          <div>
            <h4>Temperatura Lado B</h4>
            {tempsR.map((t) => (
              <div key={t.label} className="ficha-row-inline">
                <span>{t.label}</span>
                <span>{t.pv || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4>Dados do Molde</h4>
          <div className="ficha-molde-grid">
            <div className="ficha-molde-header">
              <span>Injeção</span>
              <span>Sopro</span>
              <span>Condicionamento</span>
              <span>Opcional</span>
            </div>
            {(molde || []).map((row, idx) => (
              <div key={`molde-${idx}`} className="ficha-molde-row">
                <div>
                  <div className="muted">{row.injecao || '—'}</div>
                  <div>{row.injValor || '—'}</div>
                </div>
                <div>
                  <div className="muted">{row.sopro || '—'}</div>
                  <div>{row.soproVal || '—'}</div>
                </div>
                <div>
                  <div className="muted">{row.cond || '—'}</div>
                  <div>{row.condVal || '—'}</div>
                </div>
                <div>
                  <div className="muted">{row.opc || '—'}</div>
                  <div>{row.opcVal || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4>Observações</h4>
          <div>{obs || '—'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="ficha-page">
      <div className="ficha-form-card">
        <div className="ficha-list-header" style={{ marginBottom: 12 }}>
          <button className="btn" onClick={() => { setShowForm(true); resetForm() }}>Inserir nova ficha</button>
          <button className="btn ghost" onClick={() => { setShowForm(false); resetForm() }}>Consultar fichas</button>
        </div>

        {showForm && (
          <>
            <h3>Nova ficha técnica (gera Revisão 00)</h3>
            <p className="muted">Preencha os dados do cabeçalho e use o formulário estruturado. O botão salvar fica no final.</p>
            <form onSubmit={handleCreate}>
              <div className="ficha-grid">
                <label>Máquina *</label>
                <select value={form.machine_id} onChange={(e) => setForm((v) => ({ ...v, machine_id: e.target.value }))}>
                  {MAQUINAS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>

                <label>Item *</label>
                <div style={{ position: 'relative' }} ref={itemListRef}>
                  <input
                    value={qItem}
                    onChange={(e) => {
                      setQItem(e.target.value)
                      setForm((v) => ({ ...v, item_code: '' }))
                    }}
                    onFocus={() => { if (itemSuggestions.length) setItemOpenList(true) }}
                    placeholder="Buscar por código ou descrição"
                  />
                  {itemOpenList && (
                    <div
                      style={{
                        position: 'absolute',
                        zIndex: 10,
                        left: 0,
                        right: 0,
                        top: '100%',
                        background: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: 10,
                        marginTop: 6,
                        maxHeight: 240,
                        overflowY: 'auto',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
                      }}
                    >
                      {itemLoading && <div style={ddItemMuted}>buscando…</div>}
                      {!itemLoading && !itemSuggestions.length && <div style={ddItemMuted}>sem resultados</div>}
                      {!itemLoading && itemSuggestions.map((it) => (
                        <div key={it.id} style={ddItem} onMouseDown={() => pickSuggestion(it)}>
                          <div style={{ fontWeight: 700 }}>{it.code}</div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>
                            {it.description}{it.color ? ` • ${it.color}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {itemErr && <div style={{ color: '#b00020', fontSize: 12, marginTop: 6 }}>Erro: {itemErr}</div>}
                </div>

                <label>Responsável</label>
                <input value={form.author} onChange={(e) => setForm((v) => ({ ...v, author: e.target.value }))} placeholder="Quem cadastrou" />
              </div>

              <div className="ficha-template-wrapper">
                <FichaTemplateNissei
                  key={templateKey}
                  initialItemCode={form.item_code}
                  onGenerate={(payload) => {
                    setStructuredParams(payload)
                    const mat = payload?.cliente?.material
                    setForm((cur) => {
                      return {
                        ...cur,
                        parameters: JSON.stringify(payload || {}, null, 2),
                      }
                    })
                  }}
                  prefill={{
                    molde: itemMeta?.description,
                    codItem: form.item_code,
                    pesoProduto: itemMeta?.part_weight_g,
                    tempoCiclo: itemMeta?.cycle_seconds,
                    numCavidades: itemMeta?.cavities,
                    material: itemMeta?.resin,
                    corPigmento: itemMeta?.color,
                  }}
                />
                <div className="muted" style={{ marginTop: 4 }}>
                  Os campos estruturados são guardados localmente e enviados como JSON.
                </div>
              </div>

              <div className="ficha-form-actions ficha-actions-end">
                <button type="submit" className="btn primary">Salvar ficha</button>
              </div>
            </form>
          </>
        )}
      </div>

      <div className="ficha-list">
        <div className="ficha-list-header" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3>Fichas cadastradas</h3>
          <span className="muted">Mostrando {filteredList.length} item(s)</span>
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              marginLeft: 'auto',
              background: '#f7f7f9',
              padding: '8px 12px',
              borderRadius: 10,
              boxShadow: 'inset 0 0 0 1px #e2e2e2',
            }}
          >
            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Máquina
              <select
                value={searchFilters.machine}
                onChange={(e) => setSearchFilters((f) => ({ ...f, machine: e.target.value }))}
                style={{ minWidth: 110, padding: '6px 10px', borderRadius: 8, border: '1px solid #d5d5d5' }}
              >
                <option value="">Todas</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Código do item
                <input
                  value={searchFilters.item}
                  onChange={(e) => setSearchFilters((f) => ({ ...f, item: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }}
                  placeholder="Ex: 500007"
                  style={{ minWidth: 140, padding: '6px 10px', borderRadius: 8, border: '1px solid #d5d5d5' }}
                />
              </label>
              <button
                type="button"
                className="btn primary"
                onClick={applySearch}
                disabled={loading}
                style={{ padding: '8px 14px' }}
              >
                Pesquisar
              </button>
            </div>
          </div>
        </div>

        {filteredList.length === 0 && (
          <div className="muted" style={{ marginTop: 12 }}>Nenhuma ficha para os filtros atuais.</div>
        )}

        {filteredList.map((sheet) => {
          const latest = sheet.revisions?.[0]
          const isExpanded = expanded.has(sheet.id)
          const isLatestOpen = latestOpen.has(sheet.id)
          return (
            <div key={sheet.id} className="ficha-card">
              <div className="ficha-card-top">
                <div>
                  <div className="ficha-chip">Máquina {sheet.machine_id}</div>
                  <div className="ficha-chip">Item {sheet.item_code}</div>
                  <div className="ficha-chip ghost">Rev {latest?.revision ?? '00'}</div>
                  <div className="ficha-desc">{sheetDisplayDescription(sheet)}</div>
                  {latest && (
                    <div className="muted">Última revisão em {new Date(latest.created_at).toLocaleString('pt-BR')} • {latest.author || 'N/I'}</div>
                  )}
                </div>
                <div className="ficha-actions">
                  <button className="btn ghost" onClick={() => toggleLatest(sheet.id)}>{isLatestOpen ? 'Fechar ficha' : 'Ver ficha'}</button>
                  <button className="btn ghost" onClick={() => setExpanded((prev) => {
                    const n = new Set(prev)
                    if (n.has(sheet.id)) n.delete(sheet.id); else n.add(sheet.id)
                    return n
                  })}>{isExpanded ? 'Fechar revisões' : 'Ver revisões'}</button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (revSaving) return
                      const latestParams = sheet.revisions?.[0]?.parameters || ''
                      const parsed = safeParse(latestParams)
                      setRevForm((v) => ({
                        ...v,
                        parameters: parsed ? JSON.stringify(parsed, null, 2) : latestParams,
                        changes: '',
                        author: v.author || '',
                      }))
                      setRevStructuredParams(parsed)
                      setRevTemplateKey((k) => k + 1)
                      setAddingRevisionFor(sheet.id)
                    }}
                  >
                    Nova revisão
                  </button>
                </div>
              </div>

              {isLatestOpen && latest && (
                <div className="ficha-rev-card" style={{ marginTop: 10 }}>
                  <div className="ficha-rev-card-top">
                    <div>
                      <div className="ficha-chip ghost">Rev {latest.revision}</div>
                      <div className="muted">{new Date(latest.created_at).toLocaleString('pt-BR')} • {latest.author || 'N/I'}</div>
                    </div>
                  </div>
                  {renderStructured(latest.parameters) || (
                    <div className="ficha-rev-block">
                      <div className="ficha-block-title">Parâmetros</div>
                      <pre>{latest.parameters || '—'}</pre>
                    </div>
                  )}
                </div>
              )}

              {addingRevisionFor === sheet.id && (
                <div className="ficha-rev-form">
                  <div className="ficha-rev-grid">
                    <FichaTemplateNissei
                      key={revTemplateKey}
                      initialItemCode={sheet.item_code}
                      initialData={safeParse(sheet.revisions?.[0]?.parameters) || undefined}
                      onGenerate={(payload) => {
                        setRevStructuredParams(payload)
                        setRevForm((v) => ({ ...v, parameters: JSON.stringify(payload || {}, null, 2) }))
                      }}
                      prefill={{
                        molde: revItemMeta?.description,
                        codItem: sheet.item_code,
                        pesoProduto: revItemMeta?.part_weight_g,
                        tempoCiclo: revItemMeta?.cycle_seconds,
                        numCavidades: revItemMeta?.cavities,
                        material: revItemMeta?.resin,
                        corPigmento: revItemMeta?.color,
                      }}
                    />
                    <label>Responsável</label>
                    <input value={revForm.author} onChange={(e) => setRevForm((v) => ({ ...v, author: e.target.value }))} placeholder="Quem editou" />
                  </div>
                  <div className="ficha-form-actions">
                    <button className="btn ghost" onClick={() => setAddingRevisionFor(null)}>Cancelar</button>
                    <button className="btn primary" disabled={revSaving} onClick={() => handleNewRevision(sheet)}>
                      {revSaving ? 'Salvando...' : 'Salvar revisão'}
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && (
                <div className="ficha-history">
                  <div className="ficha-history-actions">
                    <button className="btn ghost" onClick={() => setAllRevisionsOpen(sheet, true)}>Expandir todas</button>
                    <button className="btn ghost" onClick={() => setAllRevisionsOpen(sheet, false)}>Recolher todas</button>
                  </div>
                  {sheet.revisions?.map((rev, idx) => {
                    const key = `${sheet.id}-rev-${rev.revision}`
                    const defaultOpen = idx === 0
                    const isOpen = revOpenState.has(key) ? revOpenState.get(key) : defaultOpen
                    return (
                    <div key={`${sheet.id}-rev-${rev.revision}`} className="ficha-rev-card">
                      <div className="ficha-rev-card-top">
                        <div>
                          <div className="ficha-chip ghost">Rev {rev.revision}</div>
                          <div className="muted">{new Date(rev.created_at).toLocaleString('pt-BR')} • {rev.author || 'N/I'}</div>
                        </div>
                      </div>

                      {isOpen && (
                        <>
                          <div className="ficha-rev-block">
                            <div className="ficha-block-title">Campos alterados</div>
                            <pre>{rev.changes || 'Sem descrição das alterações'}</pre>
                          </div>
                        </>
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
