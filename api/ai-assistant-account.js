import { createClient } from '@supabase/supabase-js'
import { assertAiAssistantAdmin } from './ai-assistant-auth.js'

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

export default async function handler(req, res) {
  try {
    const supabase = buildSupabaseClient(req)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'Sessao invalida. Faca login novamente.' })
      return
    }
    const user = userData.user
    assertAiAssistantAdmin(user)

    if (req.method === 'GET') {
      const [{ data: preferences, error: preferencesError }, { data: messages, error: messagesError }] = await Promise.all([
        supabase.from('ai_user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('ai_assistant_messages').select('id, role, content, metadata, created_at').eq('user_id', user.id).order('created_at', { ascending: true }).limit(100),
      ])
      if (preferencesError) throw preferencesError
      if (messagesError) throw messagesError
      const response = {
        preferences: preferences || { tone_style: 'padrao', nickname: '', characteristics: '', memory_enabled: true, memory_summary: '' },
        messages: (messages || []).map((message) => ({ id: message.id, role: message.role, content: message.content, ...(message.metadata || {}) })),
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

    if (req.method === 'DELETE') {
      const { error } = await supabase.from('ai_assistant_messages').delete().eq('user_id', user.id)
      if (error) throw error
      res.status(200).json({ cleared: true })
      return
    }

    if (req.method === 'POST' && text(req.body?.action) === 'save_message') {
      const message = req.body?.message || {}
      const role = text(message.role)
      const content = text(message.content)
      if (!['user', 'assistant'].includes(role) || !content) {
        res.status(400).json({ error: 'Mensagem inválida.' })
        return
      }
      const { error } = await supabase.from('ai_assistant_messages').insert({
        id: text(message.id) || undefined,
        user_id: user.id,
        role,
        content: content.slice(0, 12000),
        metadata: {
          fallback: Boolean(message.fallback),
          fallbackReason: text(message.fallbackReason),
          sources: Array.isArray(message.sources) ? message.sources.slice(0, 20) : [],
          toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls.slice(0, 20) : [],
          machineProjection: Array.isArray(message.machineProjection) ? message.machineProjection.slice(0, 50) : null,
        },
      })
      if (error) throw error
      res.status(201).json({ saved: true })
      return
    }

    res.status(405).json({ error: 'Método não permitido.' })
  } catch (error) {
    const status = error?.statusCode || 500
    console.error('AI account failed:', error)
    res.status(status).json({ error: error?.message || 'Falha ao consultar conta do Ícaro.' })
  }
}
