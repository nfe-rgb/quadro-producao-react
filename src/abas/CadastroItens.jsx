// src/abas/CadastroItens.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { ADMIN_EMAILS } from '../lib/constants.js'
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
const cleanText = (v) => String(v ?? '').trim()

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
      .select('id, code, description, color, cycle_seconds, cavities, part_weight_g, unit_value, resin, created_at')
      .order('created_at', { ascending: false })
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

  // ============== FORM / MODAL (sempre declarar hooks) ==============
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    code: '',
    description: '',
    color: '',
    cycle_seconds: '',
    cavities: '',
    part_weight_g: '',
    unit_value: '',
    resin: '',
  })
  const [formErr, setFormErr] = useState(null)

  const resetForm = () => {
    setForm({
      code: '',
      description: '',
      color: '',
      cycle_seconds: '',
      cavities: '',
      part_weight_g: '',
      unit_value: '',
      resin: '',
    })
    setFormErr(null)
  }
  const onChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }
  const validate = () => {
    const code = cleanText(form.code)
    const description = cleanText(form.description)
    if (!code) return 'Código é obrigatório.'
    if (!description) return 'Descrição é obrigatória.'
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
    const payload = {
      code: cleanText(form.code),
      description: cleanText(form.description),
      color: cleanText(form.color),
      cycle_seconds: toPosFloat(form.cycle_seconds),
      cavities: toPosInt(form.cavities),
      part_weight_g: toPosFloat(form.part_weight_g),
      unit_value: toPosFloat(form.unit_value),
      resin: cleanText(form.resin),
    }
    setSaving(true)
    const { error } = await supabase.from('items').insert(payload)
    setSaving(false)
    if (error) { setFormErr(error.message ?? 'Erro ao salvar.'); return }
    setOpen(false); resetForm(); await fetchItems()
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
  async function handleImportCSV(file) {
    return new Promise((resolve) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: normalizeKey,
        complete: async ({ data, meta, errors }) => {
          if (errors?.length) {
            setImportErr(`Erro ao ler CSV: ${errors[0].message || 'verifique o arquivo'}`)
            return resolve()
          }
          const hdrErr = validateHeaders(meta.fields || [])
          if (hdrErr) { setImportErr(hdrErr); return resolve() }

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
            mapped.push(payload)
          }

          if (!mapped.length) {
            setImportErr('Nenhuma linha válida encontrada no CSV.')
            return resolve()
          }

          setImporting(true)
          let failed = null
          const CHUNK = 300
          for (let i = 0; i < mapped.length; i += CHUNK) {
            const slice = mapped.slice(i, i + CHUNK)
            const { error } = await supabase.from('items').insert(slice)
            if (error) { failed = error.message; break }
          }
          setImporting(false)

          if (failed) setImportErr('Erro ao importar: ' + failed)
          else await fetchItems()
          resolve()
        }
      })
    })
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
                onClick={() => { resetForm(); setOpen(true) }}
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
          <div style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: 12, background: '#fafafa', borderBottom: '1px solid #eee' }}>
              <strong>Itens cadastrados</strong>
            </div>

            {loading ? (
              <div style={{ padding: 16 }}>Carregando…</div>
            ) : error ? (
              <div style={{ padding: 16, color: '#b00020' }}>Erro: {error}</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 16, opacity: 0.7 }}>Nenhum item cadastrado ainda.</div>
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
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* MODAL: CADASTRO DE ITEM */}
          <Modal open={open} onClose={() => !saving && setOpen(false)} title="Cadastrar item">
            <div style={{ display: 'grid', gap: 12, paddingTop: 4 }}>
              {formErr && (
                <div style={{ padding: 10, borderRadius: 10, background: '#fff3f3', color: '#a80000' }}>
                  {formErr}
                </div>
              )}

              <div style={grid2}>
                <Field label="Código*" name="code" value={form.code} onChange={onChange} placeholder="Ex.: ABC-123" />
                <Field label="Descrição*" name="description" value={form.description} onChange={onChange} placeholder="Nome da peça" />
              </div>

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

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button disabled={saving} onClick={() => setOpen(false)} style={btnGhost}>Cancelar</button>
                <button disabled={saving} onClick={handleSave} style={btnPrimary}>{saving ? 'Salvando…' : 'Salvar'}</button>
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
