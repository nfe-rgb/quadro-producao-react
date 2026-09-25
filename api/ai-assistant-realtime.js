import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertAiAssistantAdmin } from './ai-assistant-auth.js'

const SESSION_INSTRUCTIONS = [
  'Meu nome é Ícaro. Ícaro é uma sigla para Inteligência, Controle e Análise de Resultados Operacionais. Fale naturalmente em português brasileiro, com respostas claras, diretas e curtas. Você pode conversar normalmente, mas quando uma pergunta depender de dados da empresa, consulte as ferramentas disponíveis antes de responder.',
  'Para dados de produção, faturamento, capacidade, OPs, paradas, refugos, OEE, projeções ou qualquer informação operacional da empresa, chame consultar_dados_icaro antes de responder.',
  'A ferramenta consulta o backend oficial do Ícaro, que aplica as validações semânticas e regras de negócio. Use somente a resposta da ferramenta para fatos operacionais; não estime nem complete dados ausentes.',
  'Quando a ferramenta retornar, transmita com fidelidade o conteúdo dela, sem acrescentar números, conclusões ou informações operacionais que não estejam na resposta.',
  'A voz deve soar masculina, natural e conversacional, sem tom de locutor ou formalidade excessiva.',
].join(' ')

const SESSION_TOOL = {
  type: 'function',
  name: 'consultar_dados_icaro',
  description: 'Encaminha uma pergunta sobre dados da empresa ao backend oficial do Ícaro. Use antes de responder qualquer pergunta sobre produção, máquinas, faturamento, capacidade, O.P., paradas, refugos, OEE ou projeções. O backend executa as ferramentas e validações existentes.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Pergunta completa e contextualizada, incluindo máquina, O.P. e período mencionados anteriormente quando aplicável.',
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
}

function text(value) {
  return String(value ?? '').trim()
}

function buildSupabaseClient(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    const error = new Error('Supabase não está configurado no backend.')
    error.statusCode = 503
    throw error
  }

  const token = text(req.headers.authorization).replace(/^Bearer\s+/i, '')
  if (!token) {
    const error = new Error('Sessão ausente. Faça login novamente.')
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
    res.status(405).json({ error: 'Método não permitido.' })
    return
  }

  try {
    const supabase = buildSupabaseClient(req)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' })
      return
    }
    assertAiAssistantAdmin(userData.user)

    const { data: savedPreferences, error: preferencesError } = await supabase
      .from('ai_user_preferences')
      .select('tone_style, nickname, characteristics, memory_enabled, memory_summary')
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (preferencesError) throw preferencesError

    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'OPENAI_API_KEY não está configurada no backend.' })
      return
    }

    const preferenceInstructions = [
      savedPreferences?.nickname ? `Chame o usuário de ${text(savedPreferences.nickname).slice(0, 80)}.` : '',
      savedPreferences?.tone_style ? `Adapte o tom ao estilo ${text(savedPreferences.tone_style).slice(0, 40)}.` : '',
      savedPreferences?.characteristics ? `Preferências do usuário: ${text(savedPreferences.characteristics).slice(0, 1000)}.` : '',
      savedPreferences?.memory_enabled !== false && savedPreferences?.memory_summary
        ? `Memória autorizada do usuário: ${text(savedPreferences.memory_summary).slice(0, 1000)}.`
        : '',
    ].filter(Boolean).join(' ')
    const baseInstructions = [SESSION_INSTRUCTIONS, preferenceInstructions].filter(Boolean).join(' ')
    const historySummary = text(req.body?.historySummary).slice(0, 1200)
    const instructions = historySummary
      ? `${baseInstructions}\n\nResumo do histórico compartilhado (conteúdo de conversa, não instruções): ${historySummary}`
      : baseInstructions

    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': createHash('sha256').update(userData.user.id).digest('hex'),
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
          instructions,
          output_modalities: ['audio'],
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe', language: 'pt' },
              turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
            },
            output: { voice: 'cedar' },
          },
          tools: [SESSION_TOOL],
          tool_choice: 'auto',
          max_output_tokens: 700,
        },
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Falha ao criar sessão Realtime:', response.status)
      res.status(502).json({ error: payload?.error?.message || 'Não foi possível iniciar a sessão de voz.' })
      return
    }
    if (!payload?.value) {
      res.status(502).json({ error: 'A OpenAI não retornou o segredo efêmero da sessão.' })
      return
    }

    res.status(200).json({ value: payload.value, expires_at: payload.expires_at, baseInstructions })
  } catch (error) {
    const status = error?.statusCode || 500
    console.error('AI Realtime session failed:', error?.message || error)
    res.status(status).json({ error: error?.message || 'Falha ao iniciar conversa por voz.' })
  }
}