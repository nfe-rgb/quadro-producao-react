// src/abas/NovaOrdem.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { MAQUINAS } from '../lib/constants'
import Modal from '../components/Modal'

export default function NovaOrdem({ form, setForm, criarOrdem, setTab }) {
  // ====== Busca de itens ligada ao campo "Produto" ======
  const [qProd, setQProd] = useState(form.product || '') // espelho do campo Produto
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [pickedItem, setPickedItem] = useState(null)
  const [openList, setOpenList] = useState(false)
  const [checkingItemCode, setCheckingItemCode] = useState(false)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [missingItemModal, setMissingItemModal] = useState({ open: false, code: '' })
  const [duplicateOrderModal, setDuplicateOrderModal] = useState({ open: false, code: '', matches: [], pendingForm: null, busy: false })
  const debRef = useRef(null)
  const listRef = useRef(null)
  const creatingOrderRef = useRef(false)

  // mantém qProd sincronizado quando a tela monta
  useEffect(() => { setQProd(form.product || '') }, []) // ao montar

  // Debounce de busca conforme digita no Produto
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)

    const term = (qProd || '').trim()
    if (!term) {
      setSuggestions([])
      setOpenList(false)
      setPickedItem(null)
      return
    }

    debRef.current = setTimeout(async () => {
      await fetchByProductTerm(term)
    }, 250)

    return () => { if (debRef.current) clearTimeout(debRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qProd])

  async function fetchByProductTerm(term) {
    setLoading(true); setErr(null)

    // Se usuário digitar no padrão "CODE - DESC", tenta extrair CODE (antes do hífen)
    const codeGuess = term.split('-')[0]?.trim()

    // Monta filtro OR: code ILIKE %term% OR description ILIKE %term%
    // (se codeGuess existir e for "limpo", também tenta ILIKE por ele)
    const ors = [
      `code.ilike.%${escapeLike(term)}%`,
      `description.ilike.%${escapeLike(term)}%`,
    ]
    if (codeGuess && codeGuess.length >= 2) {
      ors.unshift(`code.ilike.%${escapeLike(codeGuess)}%`)
    }

    const { data, error } = await supabase
      .from('items')
      .select('id, code, description, color, cycle_seconds, cavities, part_weight_g, unit_value, resin')
      .or(ors.join(','))
      .order('code', { ascending: true })
      .limit(12)

    setLoading(false)
    if (error) { setErr(error.message); setSuggestions([]); setOpenList(false); return }

    setSuggestions(data || [])
    setOpenList((data || []).length > 0)

    // Auto-match se digitou exatamente o code ou "code - desc"
    const exact = (data || []).find(it => isExactProductMatch(term, it))
    if (exact) applyItem(exact, { keepUserColorIfDifferent: false })
  }

  function isExactProductMatch(term, it) {
    const t = String(term || '').toLowerCase().trim()
    const code = String(it.code || '').toLowerCase().trim()
    const desc = String(it.description || '').toLowerCase().trim()
    return t === code || t === `${code} - ${desc}`.toLowerCase()
  }

  function escapeLike(s) {
    return String(s).replace(/[%_]/g, m => '\\' + m)
  }

  function pickSuggestion(item) {
    setOpenList(false)
    applyItem(item)
  }

  function applyItem(item, opts = {}) {
    setPickedItem(item)
    setQProd(`${item.code} - ${item.description}`)
    setForm(f => ({
      ...f,
      product: `${item.code} - ${item.description}`,
      color: (opts.keepUserColorIfDifferent && f.color && f.color !== '' && f.color !== item.color)
        ? f.color
        : (item.color || '')
    }))
  }

  async function submitCreateOrder(nextForm) {
    if (creatingOrderRef.current) return false

    creatingOrderRef.current = true
    setCreatingOrder(true)
    try {
      return (await criarOrdem(nextForm, setForm, setTab)) !== false
    } finally {
      creatingOrderRef.current = false
      setCreatingOrder(false)
    }
  }

  function closeDuplicateOrderModal() {
    if (duplicateOrderModal.busy) return
    setDuplicateOrderModal({ open: false, code: '', matches: [], pendingForm: null, busy: false })
  }

  async function confirmDuplicateOrderCreation() {
    const pendingForm = duplicateOrderModal.pendingForm
    if (!pendingForm || creatingOrderRef.current) return

    setDuplicateOrderModal(prev => ({ ...prev, busy: true }))
    const created = await submitCreateOrder(pendingForm)
    if (created) {
      setDuplicateOrderModal({ open: false, code: '', matches: [], pendingForm: null, busy: false })
      return
    }

    setDuplicateOrderModal(prev => ({ ...prev, busy: false }))
  }

  async function validateDuplicateOrder(nextForm) {
    const normalizedCode = String(nextForm?.code || '').trim()
    if (!normalizedCode) return false

    const { data, error } = await supabase
      .from('orders')
      .select('id, code, machine_id, status, finalized, created_at')
      .eq('code', normalizedCode)
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      alert('Não foi possível validar o número da O.P.: ' + error.message)
      return false
    }

    if (!data?.length) {
      return await submitCreateOrder(nextForm)
    }

    setDuplicateOrderModal({
      open: true,
      code: normalizedCode,
      matches: data,
      pendingForm: nextForm,
      busy: false,
    })
    return false
  }

  async function handleCreateOrder() {
    if (creatingOrderRef.current) return

    const baseForm = {
      ...form,
      code: String(form.code || '').trim(),
    }

    const term = String(qProd || '').trim()
    if (!term) {
      await validateDuplicateOrder(baseForm)
      return
    }

    if (pickedItem && isExactProductMatch(term, pickedItem)) {
      await validateDuplicateOrder(baseForm)
      return
    }

    const codeGuess = term.split('-')[0]?.trim()
    if (!codeGuess) {
      await validateDuplicateOrder(baseForm)
      return
    }

    setCheckingItemCode(true)
    try {
      const { data, error } = await supabase
        .from('items')
        .select('id, code, description, color, cycle_seconds, cavities, part_weight_g, unit_value, resin')
        .eq('code', codeGuess)
        .maybeSingle()

      if (error) {
        setErr(error.message || 'Não foi possível validar o código do item.')
        return
      }

      if (!data) {
        setMissingItemModal({ open: true, code: codeGuess })
        return
      }

      const nextProduct = `${data.code} - ${data.description}`
      const nextColor = (form.color && form.color !== '' && form.color !== data.color)
        ? form.color
        : (data.color || '')
      const nextForm = {
        ...baseForm,
        product: nextProduct,
        color: nextColor,
      }

      setPickedItem(data)
      setQProd(nextProduct)
      setForm(nextForm)
      await validateDuplicateOrder(nextForm)
    } finally {
      setCheckingItemCode(false)
    }
  }

  // fecha a lista ao clicar fora
  useEffect(() => {
    function onDocClick(e) {
      if (!listRef.current) return
      if (!listRef.current.contains(e.target)) setOpenList(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  // pílulas técnicas (somente leitura)
  const techPills = useMemo(() => {
    if (!pickedItem) return []
    const it = pickedItem
    return [
      ['Ciclo (s)', it.cycle_seconds],
      ['Cavidades', it.cavities],
      ['Peso (g)', it.part_weight_g],
      ['Valor (R$)', it.unit_value],
      ['Resina', it.resin],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '')
  }, [pickedItem])

  return (
    <div className="grid" style={{ maxWidth: 900 }}>
      <div className="card">
        <div className="grid2">
          {/* Número O.P (independente do cadastro de itens) */}
          <div>
            <div className="label">Número O.P</div>
            <input
              className="input"
              value={form.code}
              onChange={e=>setForm(f=>({...f, code:e.target.value}))}
              placeholder="Ex.: 1015"
            />
          </div>

          {/* Máquina */}
          <div>
            <div className="label">Máquina</div>
            <select
              className="select"
              value={form.machine_id}
              onChange={e=>setForm(f=>({...f, machine_id:e.target.value}))}
            >
              {MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Cliente */}
          <div>
            <div className="label">Cliente</div>
            <input
              className="input"
              value={form.customer}
              onChange={e=>setForm(f=>({...f, customer:e.target.value}))}
            />
          </div>

          {/* Produto (com busca por itens) */}
          <div style={{ position: 'relative' }} ref={listRef}>
            <div className="label">Produto</div>
            <input
              className="input"
              value={qProd}
              onChange={(e) => {
                const val = e.target.value
                setQProd(val)
                setForm(f => ({ ...f, product: val }))
                setPickedItem(null) // reseta até confirmar
              }}
              onFocus={() => { if (suggestions.length) setOpenList(true) }}
              placeholder='Ex.: "500009 - FRASCO PET 200 ML RT R24/410"'
              autoComplete="off"
            />
            {openList && (
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
                {loading && <div style={ddItemMuted}>buscando…</div>}
                {!loading && !suggestions.length && <div style={ddItemMuted}>sem resultados</div>}
                {!loading && suggestions.map(it => (
                  <div key={it.id} style={ddItem} onMouseDown={() => pickSuggestion(it)}>
                    <div style={{ fontWeight: 700 }}>{it.code}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {it.description}{it.color ? ` • ${it.color}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {err && <div style={{ color: '#b00020', fontSize: 12, marginTop: 6 }}>Erro: {err}</div>}
          </div>

          {/* Cor (auto-preenchida, mas editável) */}
          <div>
            <div className="label">Cor</div>
            <input
              className="input"
              value={form.color}
              onChange={e=>setForm(f=>({...f, color:e.target.value}))}
              placeholder="Ex.: Natural, Azul, Vermelho"
            />
          </div>

          {/* Restante dos campos */}
          <div><div className="label">Quantidade</div><input className="input" value={form.qty} onChange={e=>setForm(f=>({...f, qty:e.target.value}))}/></div>
          <div><div className="label">Volumes</div><input className="input" value={form.boxes} onChange={e=>setForm(f=>({...f, boxes:e.target.value}))}/></div>
          <div><div className="label">Padrão</div><input className="input" value={form.standard} onChange={e=>setForm(f=>({...f, standard:e.target.value}))}/></div>
          <div><div className="label">Prazo de Entrega</div><input type="date" className="input" value={form.due_date} onChange={e=>setForm(f=>({...f, due_date:e.target.value}))}/></div>
          <div><div className="label">Observações</div><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))}/></div>
        </div>

        {/* Pílulas técnicas do item selecionado (somente leitura) */}
        {pickedItem && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {techPills.map(([k, v]) => (
              <span key={k} style={pill}>{k}: <b style={{ marginLeft: 6 }}>{String(v)}</b></span>
            ))}
          </div>
        )}

        <div className="sep"></div>
        <button className="btn primary" onClick={handleCreateOrder} disabled={checkingItemCode || creatingOrder}>
          {creatingOrder ? 'Criando...' : checkingItemCode ? 'Validando item…' : 'Adicionar'}
        </button>
      </div>

      <Modal
        open={missingItemModal.open}
        onClose={() => setMissingItemModal({ open: false, code: '' })}
        title="Item não cadastrado"
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0 }}>
            O código <b>{missingItemModal.code || '-'}</b> ainda não foi cadastrado na base de itens.
          </p>
          <p style={{ margin: 0 }}>
            Por favor, avisar o responsável para realizar o cadastro antes de criar a O.P.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={() => setMissingItemModal({ open: false, code: '' })}>
              Entendi
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={duplicateOrderModal.open}
        onClose={closeDuplicateOrderModal}
        title="O.P. já cadastrada"
        closeOnBackdrop={!duplicateOrderModal.busy}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0 }}>
            Já existe uma O.P. com o número <b>{duplicateOrderModal.code || '-'}</b> registrado.
          </p>
          <p style={{ margin: 0 }}>
            Deseja realmente gerar outra ordem com este mesmo número?
          </p>

          {!!duplicateOrderModal.matches.length && (
            <div style={{ display: 'grid', gap: 8 }}>
              {duplicateOrderModal.matches.map((match) => {
                const statusLabel = match.finalized ? 'FINALIZADA' : (match.status || 'SEM STATUS')
                return (
                  <div key={match.id} style={duplicateRow}>
                    <strong>{match.machine_id || 'SEM MÁQUINA'}</strong>
                    <span>{statusLabel}</span>
                    <span>{formatOrderCreatedAt(match.created_at)}</span>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={closeDuplicateOrderModal} disabled={duplicateOrderModal.busy}>
              Cancelar
            </button>
            <button className="btn primary" onClick={confirmDuplicateOrderCreation} disabled={duplicateOrderModal.busy}>
              {duplicateOrderModal.busy ? 'Gerando...' : 'Gerar mesmo assim'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function formatOrderCreatedAt(value) {
  if (!value) return 'Sem data'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Sem data'
  return parsed.toLocaleString('pt-BR')
}

/* ===== estilos locais da dropdown/pílulas ===== */
const ddItem = {
  padding: '10px 12px',
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
}
const ddItemMuted = {
  padding: '10px 12px',
  opacity: 0.7,
}
const pill = {
  padding: '6px 10px',
  border: '1px solid #ddd',
  borderRadius: 999,
  fontSize: 12,
  background: '#fafafa',
}
const duplicateRow = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, 1fr) minmax(120px, 1fr) minmax(150px, 1.2fr)',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid #e7e7e7',
  borderRadius: 10,
  background: '#fafafa',
  alignItems: 'center',
}
