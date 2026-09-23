import { createClient } from '@supabase/supabase-js'

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'marin'
const ZONE = 'America/Sao_Paulo'

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Metodo nao permitido.' })
    return
  }

  try {
    const supabase = buildSupabaseClient(req)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'Sessao invalida. Faca login novamente.' })
      return
    }

    const input = text(req.body?.text)
    if (!input) {
      res.status(400).json({ error: 'Texto vazio.' })
      return
    }
    if (input.length > 4000) {
      res.status(413).json({ error: 'Texto muito longo para conversao em voz.' })
      return
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'OPENAI_API_KEY nao configurada para voz.' })
      return
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input,
        response_format: 'mp3',
        instructions: `Fale em portugues brasileiro natural, com ritmo fluido e tom profissional e acolhedor. Fuso operacional: ${ZONE}.`,
      }),
    })

    if (!response.ok) {
      const details = await response.text()
      const error = new Error(`OpenAI TTS retornou HTTP ${response.status}.`)
      error.details = details
      throw error
    }

    const audio = Buffer.from(await response.arrayBuffer())
    res.status(200)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', audio.length)
    res.end(audio)
  } catch (error) {
    const status = error?.statusCode || 500
    console.error('AI TTS failed:', error?.message || error)
    res.status(status).json({ error: error?.message || 'Falha ao gerar voz do Ícaro.' })
  }
}
