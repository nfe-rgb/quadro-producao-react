// src/abas/Login.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      setUser(data?.user ?? null)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  async function signIn(e) {
    e.preventDefault()
    setError(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); return }
    setUser(data.user)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
  }

  if (loading) return <div style={{ padding: 24 }}>Verificando sessão…</div>

  if (user) {
    return (
      <div style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 420 }}>
        <h2 style={{ margin: 0 }}>Você está autenticado</h2>
        <div><b>E-mail:</b> {user.email}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => { location.href = '/admin/itens' }}>
            Ir para Cadastro de Itens
          </button>
          <button className="btn ghost" onClick={signOut}>Sair</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 420 }}>
      <h2 style={{ margin: 0 }}>Entrar</h2>
      {error && <div style={{ background: '#ffecec', color: '#a80000', padding: 10, borderRadius: 10 }}>{error}</div>}
      <form onSubmit={signIn} style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12 }}>E-mail</span>
          <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12 }}>Senha</span>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn primary" type="submit">Entrar</button>
        </div>
      </form>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        Precisa de acesso? Cadastre o e-mail no Supabase Studio (Authentication → Users).
      </div>
    </div>
  )
}
