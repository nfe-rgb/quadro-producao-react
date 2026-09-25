import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const SUGGESTIONS = [
  'Produção de hoje',
  'Como está a P1?',
  'Principais paradas',
  'Capacidade em R$',
]

const SHOW_ANALYSIS_DETAILS = import.meta.env.VITE_AI_ASSISTANT_DEBUG === 'true'
const ICARO_LOGO_SRC = '/icaro-logo.png'
const TONE_OPTIONS = [
  ['padrao', 'Padrão'],
  ['franco', 'Franco'],
  ['profissional', 'Profissional'],
  ['amigavel', 'Amigável'],
  ['diferentao', 'Diferentão'],
  ['eficiente', 'Eficiente'],
  ['cinico', 'Cínico'],
]

const TOOL_LABELS = {
  consultar_producao: 'Consultou produção',
  consultar_capacidade: 'Calculou capacidade',
  consultar_paradas: 'Analisou paradas',
  consultar_refugos: 'Consultou refugos',
  consultar_oee: 'Calculou OEE',
  consultar_situacao_maquina: 'Consultou situação da máquina',
  consultar_planejado_realizado: 'Comparou planejado e realizado',
  comparar_producao_periodo_anterior: 'Comparou períodos',
  consultar_ordem_producao: 'Consultou O.P.',
  consultar_ordens_maquina: 'Consultou O.Ps da máquina',
  consultar_valorizacao_producao: 'Calculou valor produzido',
  projetar_producao: 'Projetou produção',
}

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function buildHistorySummary(messages) {
  const relevant = messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join('\n')
  return relevant.slice(0, 1200)
}

function formatNumber(value, unit) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value ?? '-')
  if (unit === 'BRL') {
    return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }
  return numeric.toLocaleString('pt-BR', { maximumFractionDigits: unit === 'horas' ? 2 : 0 })
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function getToolLabel(toolName) {
  return TOOL_LABELS[toolName] || 'Consultou dados'
}

function buildToolSummary(toolCall) {
  const result = toolCall?.result || {}
  const metrics = Array.isArray(result.metrics) ? result.metrics : []
  const primaryMetric = metrics[0]

  if (primaryMetric) {
    return {
      title: getToolLabel(toolCall.tool),
      value: `${formatNumber(primaryMetric.value, primaryMetric.unit)} ${primaryMetric.unit === 'BRL' ? '' : primaryMetric.unit || ''}`.trim(),
      meta: [primaryMetric.entity, primaryMetric.metric, `Atualizado às ${formatTime(primaryMetric.reference_time)}`].filter(Boolean).join(' • '),
    }
  }

  if (toolCall.tool === 'consultar_capacidade' && result.dailyCapacityPieces != null) {
    return {
      title: getToolLabel(toolCall.tool),
      value: `${formatNumber(result.dailyCapacityPieces, 'pecas')} peças`,
      meta: result.dailyCapacityValue != null ? formatNumber(result.dailyCapacityValue, 'BRL') : '',
    }
  }

  if (toolCall.tool === 'consultar_producao' && result.totalPieces != null) {
    return {
      title: getToolLabel(toolCall.tool),
      value: `${formatNumber(result.totalPieces, 'pecas')} peças`,
      meta: toolCall?.period?.label || '',
    }
  }

  return {
    title: getToolLabel(toolCall.tool),
    value: toolCall?.period?.label || 'Dados agregados',
    meta: toolCall?.filters?.machineId || '',
  }
}

async function readJsonResponse(response, endpoint) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    const contentType = response.headers.get('content-type') || 'tipo de conteúdo desconhecido'
    throw new Error(`${endpoint} respondeu HTTP ${response.status} com ${contentType}, não JSON. No ambiente local, inicie npm run dev:api e npm run dev em terminais separados.`)
  }
}

function waitForIceGatheringComplete(peerConnection) {
  if (peerConnection.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
      reject(new Error('Tempo esgotado ao preparar a conexão de voz.'))
    }, 12000)

    function onStateChange() {
      if (peerConnection.iceGatheringState !== 'complete') return
      window.clearTimeout(timeout)
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }

    peerConnection.addEventListener('icegatheringstatechange', onStateChange)
    onStateChange()
  })
}

function getRealtimeResponseText(response) {
  return (response?.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .map((content) => content.transcript || content.text || '')
    .join(' ')
    .trim()
}

function IcaroLogo({ className = '', alt = 'Ícaro' }) {
  const [failed, setFailed] = useState(false)

  if (failed) return <span className={`ai-logo-fallback ${className}`} aria-hidden="true">Í</span>

  return <img className={`ai-logo-image ${className}`} src={ICARO_LOGO_SRC} alt={alt} onError={() => setFailed(true)} />
}

function AssistantMark({ active = false }) {
  return (
    <span className={`ai-mark ${active ? 'is-active' : ''}`} aria-hidden="true">
      <IcaroLogo alt="" />
    </span>
  )
}

function AssistantMessage({ message }) {
  const sources = Array.isArray(message.sources) ? message.sources : []
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : []
  const isAssistant = message.role === 'assistant'

  return (
    <div className={`ai-chat-message is-${message.role}`}>
      {isAssistant ? <AssistantMark /> : null}
      <div className="ai-chat-bubble">
        {isAssistant ? <div className="ai-message-author">Ícaro</div> : null}
        <div className="ai-chat-text">{message.content}</div>
        {Array.isArray(message.machineProjection) && message.machineProjection.length ? (
          <div className="ai-machine-projection-table" role="table" aria-label="Projeção de faturamento por máquina">
            <div className="ai-machine-projection-row is-header" role="row"><span>Máquina</span><span>Peças</span><span>Faturamento</span></div>
            {message.machineProjection.map((row) => <div className="ai-machine-projection-row" role="row" key={row.machineId}><strong>{row.machineId}</strong><span>{Number(row.projectedTotalPieces || 0).toLocaleString('pt-BR')}</span><span>{Number(row.projectedTotalValue || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>)}
          </div>
        ) : null}
        {message.fallback ? (
          <div className="ai-chat-fallback-note">
            Resposta gerada pela análise local. {message.fallbackReason || 'Verifique OPENAI_API_KEY/modelo se esperava interpretação do GPT.'}
          </div>
        ) : null}
        {toolCalls.length || sources.length ? (
          <details className="ai-chat-details">
            <summary>Ver dados utilizados</summary>
            {toolCalls.length ? (
              <div className="ai-data-list">
                {toolCalls.map((toolCall, index) => {
                  const summary = buildToolSummary(toolCall)
                  return (
                    <div className="ai-data-item" key={`${toolCall.tool || 'tool'}-${index}`}>
                      <span>{summary.title}</span>
                      <strong>{summary.value}</strong>
                      {summary.meta ? <small>{summary.meta}</small> : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
            {sources.length && SHOW_ANALYSIS_DETAILS ? (
              <div className="ai-chat-sources">
                <strong>Fontes consultadas</strong>
                <ul>
                  {sources.map((source) => <li key={source}>{source}</li>)}
                </ul>
              </div>
            ) : null}
            {toolCalls.length && SHOW_ANALYSIS_DETAILS ? <pre>{JSON.stringify(toolCalls, null, 2)}</pre> : null}
          </details>
        ) : null}
      </div>
    </div>
  )
}

export default function AiAssistantChat({ authUser, isAdmin = false }) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newMessageAvailable, setNewMessageAvailable] = useState(false)
  const [activeContext, setActiveContext] = useState(null)
  const [realtimeStatus, setRealtimeStatus] = useState('idle')
  const [preferences, setPreferences] = useState({ tone_style: 'padrao', nickname: '', characteristics: '', memory_enabled: true, memory_summary: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [voiceInputState, setVoiceInputState] = useState('idle')
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(() => {
    try {
      return window.localStorage.getItem('icaro-voice-output') === 'true'
    } catch {
      return false
    }
  })
  const inputRef = useRef(null)
  const bodyRef = useRef(null)
  const panelTimerRef = useRef(null)
  const recognitionRef = useRef(null)
  const audioRef = useRef(null)
  const messagesRef = useRef([])
  const activeContextRef = useRef(null)
  const realtimePeerConnectionRef = useRef(null)
  const realtimeMediaStreamRef = useRef(null)
  const realtimeDataChannelRef = useRef(null)
  const realtimeAudioRef = useRef(null)
  const realtimeBaseInstructionsRef = useRef('')
  const realtimeUserItemIdsRef = useRef(new Set())
  const realtimeCallIdsRef = useRef(new Set())
  const realtimePendingAssistantMetadataRef = useRef(null)

  const canUseAssistant = !!authUser && isAdmin
  const historySummary = useMemo(() => buildHistorySummary(messages), [messages])
  const voiceStatusLabels = { connecting: 'Conectando', listening: 'Ouvindo', thinking: 'Pensando', speaking: 'Falando' }
  const statusLabel = realtimeStatus !== 'idle'
    ? voiceStatusLabels[realtimeStatus] || 'Conectando'
    : error ? 'Problema de conexão' : voiceInputState === 'listening' ? 'Ouvindo' : voiceInputState === 'processing' ? 'Processando voz' : loading ? 'Analisando' : 'Online'

  useEffect(() => {
    try {
      window.localStorage.setItem('icaro-voice-output', String(voiceOutputEnabled))
    } catch {
      // Preferência local indisponível não impede o chat.
    }
  }, [voiceOutputEnabled])

  useEffect(() => () => {
    recognitionRef.current?.abort?.()
    audioRef.current?.pause?.()
    if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src)
    window.speechSynthesis?.cancel?.()
    realtimeDataChannelRef.current?.close?.()
    realtimePeerConnectionRef.current?.close?.()
    realtimeMediaStreamRef.current?.getTracks?.().forEach((track) => track.stop())
    if (realtimeAudioRef.current) realtimeAudioRef.current.srcObject = null
  }, [])

  const getAccountToken = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return token
  }, [])

  const loadAccount = useCallback(async () => {
    try {
      const token = await getAccountToken()
      const response = await fetch('/api/ai-assistant-account', { headers: { Authorization: `Bearer ${token}` } })
      const payload = await readJsonResponse(response, '/api/ai-assistant-account')
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar a conta do Ícaro.')
      setPreferences((current) => ({ ...current, ...(payload.preferences || {}) }))
      const loadedMessages = Array.isArray(payload.messages) ? payload.messages : []
      messagesRef.current = loadedMessages
      setMessages(loadedMessages)
    } catch (err) {
      console.warn('Falha ao carregar conta do Ícaro:', err)
    }
  }, [getAccountToken])

  useEffect(() => {
    if (authUser) loadAccount()
  }, [authUser, loadAccount])

  const persistMessage = useCallback(async (message) => {
    try {
      const token = await getAccountToken()
      await fetch('/api/ai-assistant-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_message', message }),
      })
    } catch (err) {
      console.warn('Falha ao persistir mensagem do Ícaro:', err)
    }
  }, [getAccountToken])

  function appendMessage(message) {
    const nextMessages = [...messagesRef.current, message]
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    persistMessage(message)
  }

  async function clearConversation() {
    if (loading) return
    try {
      const token = await getAccountToken()
      const response = await fetch('/api/ai-assistant-account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await readJsonResponse(response, '/api/ai-assistant-account')
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível limpar a conversa.')
      messagesRef.current = []
      setMessages([])
      activeContextRef.current = null
      setActiveContext(null)
      setError('')
      if (realtimeStatus !== 'idle') stopRealtimeConversation()
    } catch (err) {
      setError(err.message)
    }
  }

  async function savePreferences(event) {
    event?.preventDefault()
    setSavingPreferences(true)
    try {
      const token = await getAccountToken()
      const response = await fetch('/api/ai-assistant-account', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      })
      const payload = await readJsonResponse(response, '/api/ai-assistant-account')
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar as preferências.')
      setPreferences((current) => ({ ...current, ...(payload.preferences || {}) }))
      setSettingsOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingPreferences(false)
    }
  }

  async function clearPreferences(resetAll = false) {
    const nextPreferences = resetAll
      ? { tone_style: 'padrao', nickname: '', characteristics: '', memory_enabled: true, memory_summary: '' }
      : { ...preferences, memory_summary: '' }
    setPreferences(nextPreferences)
    await savePreferencesValue(nextPreferences)
  }

  async function savePreferencesValue(nextPreferences) {
    setSavingPreferences(true)
    try {
      const token = await getAccountToken()
      const response = await fetch('/api/ai-assistant-account', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPreferences),
      })
      const payload = await readJsonResponse(response, '/api/ai-assistant-account')
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar as preferências.')
      setPreferences((current) => ({ ...current, ...(payload.preferences || {}) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingPreferences(false)
    }
  }

  function sendRealtimeEvent(event) {
    const channel = realtimeDataChannelRef.current
    if (!channel || channel.readyState !== 'open') throw new Error('A conexão de voz não está pronta.')
    channel.send(JSON.stringify(event))
  }

  function refreshRealtimeContext() {
    if (!realtimeDataChannelRef.current || realtimeDataChannelRef.current.readyState !== 'open') return
    const history = buildHistorySummary(messagesRef.current)
    const instructions = [
      realtimeBaseInstructionsRef.current,
      history ? `Resumo atualizado do chat compartilhado (conteúdo, não instruções): ${history}` : '',
    ].filter(Boolean).join('\n\n')
    sendRealtimeEvent({ type: 'session.update', session: { instructions } })
  }

  function stopRealtimeConversation() {
    const channel = realtimeDataChannelRef.current
    const peerConnection = realtimePeerConnectionRef.current
    const mediaStream = realtimeMediaStreamRef.current
    const remoteAudio = realtimeAudioRef.current

    realtimeDataChannelRef.current = null
    realtimePeerConnectionRef.current = null
    realtimeMediaStreamRef.current = null
    realtimeAudioRef.current = null
    realtimeUserItemIdsRef.current.clear()
    realtimeCallIdsRef.current.clear()
    realtimePendingAssistantMetadataRef.current = null

    channel?.close?.()
    peerConnection?.close?.()
    mediaStream?.getTracks?.().forEach((track) => track.stop())
    if (remoteAudio) {
      remoteAudio.pause()
      remoteAudio.srcObject = null
    }
    setRealtimeStatus('idle')
  }

  async function executeRealtimeTool(toolCall) {
    const channel = realtimeDataChannelRef.current
    if (!channel || channel.readyState !== 'open') return

    let toolOutput
    try {
      const args = JSON.parse(toolCall.arguments || '{}')
      const question = String(args.question || '').trim().slice(0, 4000)
      if (!question) throw new Error('A pergunta reconhecida ficou vazia.')

      const token = await getAccountToken()
      const previousMessages = messagesRef.current.slice(0, -1)
      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          historySummary: buildHistorySummary(previousMessages),
          activeContext: activeContextRef.current,
        }),
      })
      const payload = await readJsonResponse(response, '/api/ai-assistant')
      if (!response.ok) throw new Error(payload?.error || 'Falha ao consultar os dados pelo backend do Ícaro.')

      const answer = payload.answer || 'Não encontrei uma resposta para essa pergunta.'
      activeContextRef.current = payload.activeContext || null
      setActiveContext(activeContextRef.current)
      realtimePendingAssistantMetadataRef.current = {
        answer,
        fallback: !!payload.fallback,
        fallbackReason: payload.fallbackReason || '',
        sources: payload.sources || [],
        toolCalls: payload.toolCalls || [],
        machineProjection: payload.machineProjection || null,
      }
      toolOutput = { answer }
    } catch (toolError) {
      console.error('Falha na ferramenta delegada do Ícaro:', toolError)
      setError(toolError.message || 'Não consegui consultar os dados agora.')
      realtimePendingAssistantMetadataRef.current = { answer: 'Não consegui consultar os dados agora.' }
      toolOutput = { error: 'Não foi possível consultar os dados no backend. Informe isso sem estimar ou inventar valores.' }
    }

    if (channel.readyState !== 'open') return
    channel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: toolCall.call_id, output: JSON.stringify(toolOutput) },
    }))
  }

  async function handleRealtimeEvent(event) {
    if (event.type === 'error') {
      setError(event.error?.message || 'A sessão de voz encontrou um erro.')
      return
    }
    if (event.type === 'input_audio_buffer.speech_started') {
      setRealtimeStatus('listening')
      audioRef.current?.pause?.()
      window.speechSynthesis?.cancel?.()
      return
    }
    if (event.type === 'input_audio_buffer.speech_stopped' || event.type === 'response.created') {
      setRealtimeStatus('thinking')
      return
    }
    if (event.type === 'output_audio_buffer.started' || event.type === 'response.output_audio_transcript.delta') {
      setRealtimeStatus('speaking')
      return
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const itemId = event.item_id
      const transcript = String(event.transcript || '').trim()
      if (!transcript || (itemId && realtimeUserItemIdsRef.current.has(itemId))) return
      if (itemId) realtimeUserItemIdsRef.current.add(itemId)
      appendMessage({ id: createMessageId(), role: 'user', content: transcript })
      return
    }
    if (event.type !== 'response.done') return

    const output = event.response?.output || []
    const toolCalls = output.filter((item) => item.type === 'function_call' && item.name === 'consultar_dados_icaro')
    if (toolCalls.length) {
      setRealtimeStatus('thinking')
      for (const toolCall of toolCalls) {
        if (!toolCall.call_id || realtimeCallIdsRef.current.has(toolCall.call_id)) continue
        realtimeCallIdsRef.current.add(toolCall.call_id)
        await executeRealtimeTool(toolCall)
      }
      if (realtimeDataChannelRef.current?.readyState === 'open') {
        sendRealtimeEvent({ type: 'response.create' })
      }
      return
    }

    if (event.response?.status === 'completed') {
      const metadata = realtimePendingAssistantMetadataRef.current || {}
      const transcript = getRealtimeResponseText(event.response)
      const content = transcript || metadata.answer || ''
      if (content) {
        appendMessage({
          id: createMessageId(),
          role: 'assistant',
          content,
          fallback: !!metadata.fallback,
          fallbackReason: metadata.fallbackReason || '',
          sources: metadata.sources || [],
          toolCalls: metadata.toolCalls || [],
          machineProjection: metadata.machineProjection || null,
        })
      }
      realtimePendingAssistantMetadataRef.current = null
    }
    setRealtimeStatus('listening')
  }

  async function startRealtimeConversation() {
    if (realtimeStatus !== 'idle') return
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador não oferece suporte à conversa por voz em tempo real.')
      return
    }

    setError('')
    setRealtimeStatus('connecting')
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      realtimeMediaStreamRef.current = mediaStream

      const token = await getAccountToken()
      const sessionResponse = await fetch('/api/ai-assistant-realtime', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ historySummary: buildHistorySummary(messagesRef.current) }),
      })
      const sessionPayload = await readJsonResponse(sessionResponse, '/api/ai-assistant-realtime')
      if (!sessionResponse.ok) throw new Error(sessionPayload?.error || 'Não foi possível abrir uma sessão de voz.')
      realtimeBaseInstructionsRef.current = sessionPayload.baseInstructions || ''

      const peerConnection = new RTCPeerConnection()
      realtimePeerConnectionRef.current = peerConnection
      mediaStream.getAudioTracks().forEach((track) => peerConnection.addTrack(track, mediaStream))

      peerConnection.addEventListener('track', (event) => {
        const remoteAudio = new Audio()
        remoteAudio.autoplay = true
        remoteAudio.playsInline = true
        remoteAudio.srcObject = event.streams?.[0] || new MediaStream([event.track])
        remoteAudio.addEventListener('playing', () => setRealtimeStatus('speaking'))
        remoteAudio.addEventListener('pause', () => {
          if (realtimePeerConnectionRef.current === peerConnection) setRealtimeStatus('listening')
        })
        realtimeAudioRef.current = remoteAudio
        remoteAudio.play().catch(() => setError('Permita a reprodução de áudio neste navegador.'))
      })
      peerConnection.addEventListener('connectionstatechange', () => {
        if (realtimePeerConnectionRef.current !== peerConnection) return
        if (peerConnection.connectionState === 'failed') {
          setError('A conexão de voz foi interrompida. Tente iniciar novamente.')
          stopRealtimeConversation()
        }
      })

      const dataChannel = peerConnection.createDataChannel('oai-events')
      realtimeDataChannelRef.current = dataChannel
      dataChannel.addEventListener('open', () => setRealtimeStatus('listening'))
      dataChannel.addEventListener('message', ({ data }) => {
        try {
          void handleRealtimeEvent(JSON.parse(data))
        } catch (eventError) {
          console.warn('Evento Realtime inválido:', eventError)
        }
      })

      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      await waitForIceGatheringComplete(peerConnection)
      const sdp = peerConnection.localDescription?.sdp
      if (!sdp) throw new Error('Não foi possível preparar a conexão de voz.')

      const connectionResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionPayload.value}`,
          'Content-Type': 'application/sdp',
        },
        body: sdp,
      })
      const answerSdp = await connectionResponse.text()
      if (!connectionResponse.ok) {
        let message = `A OpenAI recusou a conexão de voz (HTTP ${connectionResponse.status}).`
        try { message = JSON.parse(answerSdp)?.error?.message || message } catch { /* Resposta não JSON. */ }
        throw new Error(message)
      }
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (startError) {
      stopRealtimeConversation()
      setError(startError?.name === 'NotAllowedError' ? 'Permissão do microfone negada.' : startError.message || 'Não foi possível iniciar a conversa por voz.')
    }
  }

  useEffect(() => () => clearTimeout(panelTimerRef.current), [])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return

    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight
    const nearBottom = distanceFromBottom < 90

    if (nearBottom) {
      requestAnimationFrame(() => {
        body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
      })
      setNewMessageAvailable(false)
    } else if (messages.length || loading) {
      setNewMessageAvailable(true)
    }
  }, [messages, loading])

  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }, [input])

  function openPanel() {
    clearTimeout(panelTimerRef.current)
    setClosing(false)
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function closePanel() {
    if (realtimeStatus !== 'idle') stopRealtimeConversation()
    setClosing(true)
    clearTimeout(panelTimerRef.current)
    panelTimerRef.current = setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 220)
  }

  function handleBodyScroll() {
    const body = bodyRef.current
    if (!body) return
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 90
    if (nearBottom) setNewMessageAvailable(false)
  }

  function scrollToBottom() {
    const body = bodyRef.current
    if (!body) return
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
    setNewMessageAvailable(false)
  }

  function speakNativeFallback(text) {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(String(text || '').replace(/[*_#|`]/g, ''))
    utterance.lang = 'pt-BR'
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }

  async function speakResponse(text) {
    if (!voiceOutputEnabled) return
    try {
      const token = await getAccountToken()
      const response = await fetch('/api/ai-assistant-tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) throw new Error('Falha no OpenAI TTS.')
      const audioBlob = await response.blob()
      if (audioRef.current) {
        audioRef.current.pause()
        if (audioRef.current.src) URL.revokeObjectURL(audioRef.current.src)
      }
      const audioUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(audioUrl)
      await audio.play()
    } catch (error) {
      console.warn('OpenAI TTS indisponível; usando voz nativa como fallback:', error)
      speakNativeFallback(text)
    }
  }

  function toggleVoiceOutput() {
    setVoiceOutputEnabled((current) => {
      const next = !current
      if (!next) {
        audioRef.current?.pause?.()
        window.speechSynthesis?.cancel?.()
      }
      return next
    })
  }

  async function toggleVoiceInput() {
    if (realtimeStatus !== 'idle') return
    if (voiceInputState === 'listening') {
      recognitionRef.current?.stop?.()
      return
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      setVoiceInputState('error')
      setError('A entrada por voz não é compatível com este navegador.')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceInputState('error')
      setError('Este navegador não permite solicitar acesso ao microfone.')
      return
    }

    try {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      microphoneStream.getTracks().forEach((track) => track.stop())
    } catch (error) {
      setVoiceInputState('error')
      setError(error?.name === 'NotAllowedError' ? 'Permissão do microfone negada.' : 'Não foi possível acessar o microfone.')
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      setError('')
      setVoiceInputState('listening')
    }
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results || []).map((result) => result[0]?.transcript || '').join(' ').trim()
      setVoiceInputState('processing')
      if (transcript) sendQuestion(transcript)
      else setVoiceInputState('idle')
    }
    recognition.onerror = (event) => {
      setVoiceInputState('error')
      setError(event.error === 'not-allowed' ? 'Permissão do microfone negada.' : 'Não foi possível entender o áudio.')
    }
    recognition.onend = () => setVoiceInputState((current) => current === 'processing' ? current : 'idle')
    recognitionRef.current = recognition
    recognition.start()
  }

  async function sendQuestion(questionText = input) {
    const question = String(questionText || '').trim()
    if (!question || loading) return

    setError('')
    setInput('')
    setLoading(true)

    const userMessage = { id: createMessageId(), role: 'user', content: question }
    appendMessage(userMessage)

    try {
      const token = await getAccountToken()

      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          historySummary,
          activeContext,
        }),
      })

      const payload = await readJsonResponse(response, '/api/ai-assistant')
      if (!response.ok) throw new Error(payload?.error || 'Falha ao consultar o assistente.')

      activeContextRef.current = payload.activeContext || null
      setActiveContext(activeContextRef.current)
      const assistantMessage = {
          id: createMessageId(),
          role: 'assistant',
          content: payload.answer || 'Não encontrei uma resposta para essa pergunta.',
          fallback: !!payload.fallback,
          fallbackReason: payload.fallbackReason || '',
          sources: payload.sources || [],
          toolCalls: payload.toolCalls || [],
          machineProjection: payload.machineProjection || null,
        }
      appendMessage(assistantMessage)
      if (realtimeStatus !== 'idle') refreshRealtimeContext()
      else speakResponse(payload.answer)
    } catch (err) {
      console.warn('Falha ao consultar assistente IA:', err)
      setError('Não consegui consultar os dados agora.')
    } finally {
      setLoading(false)
      setVoiceInputState('idle')
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    sendQuestion()
  }

  if (!canUseAssistant) return null

  return (
    <>
      <button type="button" className={`ai-assistant-fab ${loading ? 'is-busy' : ''}`} onClick={openPanel} aria-label="Abrir Ícaro">
        <IcaroLogo className="ai-fab-logo" alt="" />
      </button>

      {open ? (
        <aside className={`ai-chat-panel ${closing ? 'is-closing' : ''}`} aria-label="Ícaro, assistente IA de produção">
          <header className="ai-chat-header">
            <div className="ai-chat-title-wrap">
              <AssistantMark active={loading} />
              <div>
                <strong>Ícaro</strong>
                <span className={`ai-chat-status ${error ? 'is-error' : loading || ['connecting', 'thinking'].includes(realtimeStatus) ? 'is-busy' : ''}`}>
                  <i aria-hidden="true" /> {statusLabel}
                </span>
              </div>
            </div>
            <div className="ai-chat-header-actions">
              <button type="button" className="ai-chat-clear" onClick={clearConversation} disabled={loading || !messages.length} aria-label="Limpar conversa" title="Limpar conversa">
                Limpar
              </button>
              <button type="button" className={`ai-chat-voice-output ${voiceOutputEnabled ? 'is-enabled' : ''}`} onClick={toggleVoiceOutput} aria-label={voiceOutputEnabled ? 'Desativar voz do Ícaro' : 'Ativar voz do Ícaro'} title={voiceOutputEnabled ? 'Ouvir Ícaro: ativado' : 'Ouvir Ícaro: desativado'}>
                {voiceOutputEnabled ? '🔊' : '🔇'}
              </button>
              <button type="button" className="ai-chat-settings" onClick={() => setSettingsOpen(true)} aria-label="Abrir configurações" title="Configurações">
                ⚙
              </button>
              <button type="button" className="ai-chat-close" onClick={closePanel} aria-label="Fechar Ícaro">
                ×
              </button>
            </div>
          </header>

          <div className="ai-chat-body" ref={bodyRef} onScroll={handleBodyScroll}>
            {!messages.length ? (
              <div className="ai-chat-empty">
                <div className="ai-empty-orb" aria-hidden="true"><AssistantMark active /></div>
                <h2>Ícaro</h2>
                <p>Pergunte sobre produção, máquinas, paradas, capacidade ou indicadores.</p>
                <div className="ai-suggestion-grid">
                  {SUGGESTIONS.map((suggestion, index) => (
                    <button key={suggestion} type="button" style={{ '--delay': `${index * 45}ms` }} onClick={() => sendQuestion(suggestion)} disabled={loading}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => <AssistantMessage key={message.id} message={message} />)
            )}
            {loading ? (
              <div className="ai-chat-loading" role="status" aria-live="polite">
                <AssistantMark active />
                <span>Pensando</span>
                <i />
                <i />
                <i />
              </div>
            ) : null}
            {error ? (
              <div className="ai-chat-error">
                <span>{error}</span>
                <button type="button" onClick={() => setError('')}>Ok</button>
              </div>
            ) : null}
            {newMessageAvailable ? (
              <button type="button" className="ai-new-message" onClick={scrollToBottom}>↓ Nova mensagem</button>
            ) : null}
          </div>

          <form className="ai-chat-form" onSubmit={handleSubmit}>
            <div className="ai-input-shell">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Pergunte alguma coisa..."
                rows={1}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    sendQuestion()
                  }
                }}
              />
              <button type="button" className={`ai-voice-input ${voiceInputState !== 'idle' ? `is-${voiceInputState}` : ''}`} onClick={toggleVoiceInput} disabled={realtimeStatus !== 'idle' || (loading && voiceInputState !== 'listening')} aria-label="Falar com Ícaro" title={voiceInputState === 'listening' ? 'Parar de ouvir' : 'Falar com Ícaro'}>
                {voiceInputState === 'processing' ? '…' : voiceInputState === 'error' ? '!' : '🎙️'}
              </button>
              <button type="submit" className="ai-send-button" disabled={loading || !input.trim()} aria-label="Enviar mensagem">
                ➤
              </button>
            </div>
            <div className="ai-realtime-controls">
              {realtimeStatus !== 'idle' ? <span role="status" aria-live="polite">{voiceStatusLabels[realtimeStatus] || 'Conectando'}</span> : null}
              <button type="button" className={`ai-realtime-toggle ${realtimeStatus !== 'idle' ? 'is-active' : ''}`} onClick={realtimeStatus === 'idle' ? startRealtimeConversation : stopRealtimeConversation}>
                {realtimeStatus === 'idle' ? 'Conversar por voz' : 'Encerrar conversa'}
              </button>
            </div>
          </form>
        </aside>
      ) : null}
      {settingsOpen ? (
        <div className="ai-settings-modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section className="ai-settings-panel" role="dialog" aria-modal="true" aria-label="Configurações do Ícaro" onClick={(event) => event.stopPropagation()}>
            <form onSubmit={savePreferences}>
              <div className="ai-settings-heading"><strong>Personalização</strong><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Fechar configurações">×</button></div>
              <label>Como Ícaro deve falar?
                <select value={preferences.tone_style || 'padrao'} onChange={(event) => setPreferences((current) => ({ ...current, tone_style: event.target.value }))}>
                  {TONE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>Como ele deve chamar você?
                <input value={preferences.nickname || ''} onChange={(event) => setPreferences((current) => ({ ...current, nickname: event.target.value }))} maxLength={80} placeholder="Seu apelido" />
              </label>
              <label>Características e preferências
                <textarea value={preferences.characteristics || ''} onChange={(event) => setPreferences((current) => ({ ...current, characteristics: event.target.value }))} maxLength={1000} rows={3} placeholder="Ex.: seja direto e use exemplos da produção" />
              </label>
              <label className="ai-settings-toggle"><input type="checkbox" checked={preferences.memory_enabled !== false} onChange={(event) => setPreferences((current) => ({ ...current, memory_enabled: event.target.checked }))} /> Usar memória nas conversas</label>
              <div className="ai-settings-secondary-actions"><button type="button" onClick={() => clearPreferences(false)} disabled={savingPreferences}>Limpar memória</button><button type="button" onClick={() => clearPreferences(true)} disabled={savingPreferences}>Restaurar configurações</button></div>
              <div className="ai-settings-actions">
                <button type="button" className="ai-settings-cancel" onClick={() => setSettingsOpen(false)} disabled={savingPreferences}>Cancelar</button>
                <button type="submit" className="ai-settings-save" disabled={savingPreferences}>{savingPreferences ? 'Salvando...' : 'Salvar personalização'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}