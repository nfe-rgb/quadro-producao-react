import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'nfe@savantiplasticos.com.br'
const DEFAULT_MONTHLY_CREDITS = 1000
const VALID_TONES = new Set(['padrao', 'franco', 'profissional', 'amigavel', 'diferentao', 'eficiente', 'cinico'])

function text(value) {
  return String(value ?? '').trim()
}

function buildSupabaseClient(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase nao configurado no backend.')
  const token = text(req.headers.authorization).replace(/^Bearer\s+/i, '')
  if (!token) {
    const error = new Error('Sessao ausente. Faca login novamente.')
    error.statusCode = 401
    throw error
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function isAdmin(user) {
  return text(user?.email).toLowerCase() === ADMIN_EMAIL
}

function defaultAccount(user) {
  return {
    user_id: user.id,
    email: user.email || '',
    monthly_credits: DEFAULT_MONTHLY_CREDITS,
    monthly_used: 0,
    purchased_credits: 0,
    available_credits: DEFAULT_MONTHLY_CREDITS,
    monthly_remaining: DEFAULT_MONTHLY_CREDITS,
    cycle_start: new Date().toISOString().slice(0, 10),
  }
}

export default async function handler(req, res) {
  try {
    const supabase = buildSupabaseClient(req)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'Sessao invalida. Faca login novamente.' })
      return
    }
    const user = userData.user
    const admin = isAdmin(user)

    if (req.method === 'GET') {
      const [{ data: preferences, error: preferencesError }, { data: account, error: accountError }] = await Promise.all([
        supabase.from('ai_user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('ai_credit_accounts').select('*').eq('user_id', user.id).maybeSingle(),
      ])
      if (preferencesError) throw preferencesError
      if (accountError) throw accountError
      const userAccount = account ? { ...account, monthly_remaining: Math.max(0, account.monthly_credits - account.monthly_used), available_credits: Math.max(0, account.monthly_credits - account.monthly_used) + account.purchased_credits } : defaultAccount(user)
      const response = {
        preferences: preferences || { tone_style: 'padrao', nickname: '', characteristics: '', memory_enabled: true, memory_summary: '' },
        account: admin ? { ...userAccount, available_credits: -1, monthly_remaining: -1 } : userAccount,
        admin,
      }
      if (admin) {
        const { data: accounts, error: accountsError } = await supabase.from('ai_credit_accounts').select('*').order('email', { ascending: true })
        if (accountsError) throw accountsError
        response.users = (accounts || []).map((item) => ({ ...item, monthly_remaining: Math.max(0, item.monthly_credits - item.monthly_used), available_credits: Math.max(0, item.monthly_credits - item.monthly_used) + item.purchased_credits }))
      }
      res.status(200).json(response)
      return
    }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      const preferences = {
        user_id: user.id,
        email: user.email || '',
        tone_style: VALID_TONES.has(text(body.tone_style)) ? text(body.tone_style) : 'padrao',
        nickname: text(body.nickname).slice(0, 80) || null,
        characteristics: text(body.characteristics).slice(0, 1000) || null,
        memory_enabled: body.memory_enabled !== false,
        memory_summary: text(body.memory_summary).slice(0, 4000) || null,
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await supabase.from('ai_user_preferences').upsert(preferences).select('*').single()
      if (error) throw error
      res.status(200).json({ preferences: data })
      return
    }

    if (req.method === 'POST' && admin) {
      const body = req.body || {}
      const targetUserId = text(body.user_id)
      const purchasedCredits = Number(body.purchased_credits)
      const monthlyCredits = Number(body.monthly_credits)
      if (!targetUserId) {
        res.status(400).json({ error: 'Usuário não informado.' })
        return
      }
      if (!Number.isInteger(purchasedCredits) && !Number.isInteger(monthlyCredits)) {
        res.status(400).json({ error: 'Informe créditos extras ou novo limite mensal.' })
        return
      }
      const { data: target, error: targetError } = await supabase.from('ai_credit_accounts').select('*').eq('user_id', targetUserId).maybeSingle()
      if (targetError) throw targetError
      if (!target) {
        res.status(404).json({ error: 'Conta de créditos ainda não criada para este usuário.' })
        return
      }
      const updates = { updated_at: new Date().toISOString() }
      if (Number.isInteger(purchasedCredits)) updates.purchased_credits = Math.max(0, target.purchased_credits + purchasedCredits)
      if (Number.isInteger(monthlyCredits) && monthlyCredits >= 0) updates.monthly_credits = monthlyCredits
      const { data, error } = await supabase.from('ai_credit_accounts').update(updates).eq('user_id', targetUserId).select('*').single()
      if (error) throw error
      await supabase.from('ai_credit_transactions').insert({ user_id: targetUserId, amount: purchasedCredits || 0, kind: 'admin_adjustment', description: 'Ajuste manual pelo administrador', created_by: user.id })
      res.status(200).json({ account: data })
      return
    }

    res.status(405).json({ error: 'Método não permitido.' })
  } catch (error) {
    const status = error?.statusCode || 500
    console.error('AI account failed:', error)
    res.status(status).json({ error: error?.message || 'Falha ao consultar conta do Ícaro.' })
  }
}
