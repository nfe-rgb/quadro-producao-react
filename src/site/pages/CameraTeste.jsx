import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { getTestCameraChannelName, normalizePairCode } from '../../lib/testeCamera'
import '../../styles/teste-camera.css'

const CHANNEL_STATUS_LABEL = {
  SUBSCRIBED: 'Celular conectado ao canal.',
  CLOSED: 'Canal encerrado.',
  TIMED_OUT: 'Conexao expirada.',
  CHANNEL_ERROR: 'Erro de realtime.',
}

const PREVIEW_INTERVAL_MS = 4200
const CAMERA_WIDTH_IDEAL = 640
const CAMERA_HEIGHT_IDEAL = 480
const MOTION_INTERVAL_MS = 65
const MOTION_SAMPLE_SIZE = 112
const DETECTION_ZONE_WIDTH_RATIO = 0.84
const DETECTION_ZONE_HEIGHT_RATIO = 0.58
const DETECTION_ZONE_TOP_RATIO = 0.06
const DETECTION_ZONE_MIN_WIDTH = 320
const DETECTION_ZONE_MIN_HEIGHT = 220
const GATE_LINE_RATIO = 0.72
const MOTION_DIFF_THRESHOLD = 22
const MOTION_MIN_BLOB_AREA = 18
const MOTION_SHAKE_CHANGED_RATIO = 0.32
const MOTION_SHAKE_SPREAD_RATIO = 0.82
const MOTION_MAX_BLOB_RATIO = 0.26
const MOTION_MIN_VERTICAL_DELTA = 6
const MOTION_GATE_COOLDOWN_MS = 110
const MOTION_MIN_COLUMN_PIXELS = 3

function formatClock(value) {
  if (!value) return '--:--:--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--:--:--'
  return parsed.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function buildDeviceName() {
  const platform = String(navigator.platform || 'Dispositivo movel').trim()
  const vendor = String(navigator.vendor || 'Navegador').trim()
  return `${platform} · ${vendor}`
}

export default function CameraTeste() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search || '')
  const incomingCode = normalizePairCode(searchParams.get('code'))

  const [pairCode, setPairCode] = useState(incomingCode)
  const [channelStatus, setChannelStatus] = useState(
    incomingCode ? 'Codigo carregado. Conecte o celular.' : 'Informe o codigo exibido em /teste.'
  )
  const [cameraStatus, setCameraStatus] = useState('Camera desligada')
  const [modelStatus, setModelStatus] = useState('Leitura ainda nao iniciada')
  const [isConnected, setIsConnected] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [lastCount, setLastCount] = useState(0)
  const [serialCount, setSerialCount] = useState(0)
  const [lastDetectionAt, setLastDetectionAt] = useState('')
  const [detectedClasses, setDetectedClasses] = useState({})
  const [errorMessage, setErrorMessage] = useState('')
  const [analysisRate, setAnalysisRate] = useState('0.0')

  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const workCanvasRef = useRef(null)
  const motionCanvasRef = useRef(null)
  const streamRef = useRef(null)
  const channelRef = useRef(null)
  const rafRef = useRef(0)
  const processingRef = useRef(false)
  const lastTickRef = useRef(0)
  const lastPreviewRef = useRef(0)
  const connectedCodeRef = useRef('')
  const autoConnectRef = useRef(false)
  const detectingRef = useRef(false)
  const tracksRef = useRef(new Map())
  const nextTrackIdRef = useRef(1)
  const serialCountRef = useRef(0)
  const previousMotionFrameRef = useRef(null)
  const lastShakeWarningRef = useRef(0)

  useEffect(() => {
    if (!incomingCode || autoConnectRef.current) return undefined
    autoConnectRef.current = true
    void connectToChannel(incomingCode)
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCode])

  useEffect(() => {
    return () => {
      stopDetectionLoop()
      stopCameraStream()
      disconnectChannel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendBroadcast(event, payload, overrideChannel = null) {
    const channel = overrideChannel || channelRef.current
    if (!channel) return
    try {
      await channel.send({ type: 'broadcast', event, payload })
    } catch (error) {
      console.warn('Falha ao enviar evento realtime:', error)
    }
  }

  function syncOverlaySize() {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay || !video.videoWidth || !video.videoHeight) return

    overlay.width = video.videoWidth
    overlay.height = video.videoHeight
  }

  function clearOverlay() {
    const overlay = overlayRef.current
    if (!overlay) return
    const context = overlay.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, overlay.width, overlay.height)
  }

  function resetMotionHistory() {
    previousMotionFrameRef.current = null
  }

  function buildDetectionZone(frameWidth, frameHeight) {
    const zoneWidth = Math.max(DETECTION_ZONE_MIN_WIDTH, frameWidth * DETECTION_ZONE_WIDTH_RATIO)
    const zoneHeight = Math.max(DETECTION_ZONE_MIN_HEIGHT, frameHeight * DETECTION_ZONE_HEIGHT_RATIO)
    const left = (frameWidth - zoneWidth) / 2
    const top = Math.max(8, frameHeight * DETECTION_ZONE_TOP_RATIO)

    return {
      left,
      right: left + zoneWidth,
      top,
      bottom: top + zoneHeight,
      width: zoneWidth,
      height: zoneHeight,
    }
  }

  function isCenterInsideZone(centerX, centerY, zone) {
    return (
      centerX >= zone.left &&
      centerX <= zone.right &&
      centerY >= zone.top &&
      centerY <= zone.bottom
    )
  }

  function getGateY(zone) {
    return zone.top + zone.height * GATE_LINE_RATIO
  }

  function updateSerialTracker(detections, frameWidth, frameHeight) {
    const nowTs = Date.now()
    const zone = buildDetectionZone(frameWidth, frameHeight)
    const gateY = getGateY(zone)
    const activeTracks = Array.from(tracksRef.current.values()).filter(
      (track) => nowTs - track.lastSeenAt < 2200
    )
    const availableTrackIds = new Set(activeTracks.map((track) => track.id))
    const nextTracks = new Map()
    const countedNow = []

    const enrichedDetections = detections.map((detection) => {
      const [x = 0, y = 0, width = 0, height = 0] = Array.isArray(detection?.bbox) ? detection.bbox : []
      const centerX = x + width / 2
      const centerY = y + height / 2
      return {
        ...detection,
        centerX,
        centerY,
        width,
        height,
        insideZone: isCenterInsideZone(centerX, centerY, zone),
      }
    })

    const detectionsInZone = enrichedDetections.filter((detection) => detection.insideZone)

    const annotatedDetections = detectionsInZone.map((detection) => {
      let bestTrack = null
      let bestDistance = Infinity

      activeTracks.forEach((track) => {
        if (!availableTrackIds.has(track.id)) return
        if (track.className !== String(detection?.class || '')) return

        const distance = Math.hypot(detection.centerX - track.centerX, detection.centerY - track.centerY)
        const maxDistance = Math.max(
          90,
          Math.min(230, Math.max(detection.width || 0, detection.height || 0) * 1.45)
        )

        if (distance <= maxDistance && distance < bestDistance) {
          bestTrack = track
          bestDistance = distance
        }
      })

      const track = bestTrack
        ? { ...bestTrack }
        : {
            id: nextTrackIdRef.current++,
            className: String(detection?.class || ''),
            hasCounted: false,
            prevCenterY: detection.centerY,
          }

      if (bestTrack) {
        availableTrackIds.delete(bestTrack.id)
      }

      let counted = false

      if (!track.hasCounted && Number(track.prevCenterY) < gateY && detection.centerY >= gateY) {
        const movedDownEnough = detection.centerY - Number(track.prevCenterY || 0) >= MOTION_MIN_VERTICAL_DELTA
        const cooldownReady = nowTs - Number(track.lastCountedAt || 0) >= MOTION_GATE_COOLDOWN_MS
        if (!movedDownEnough || !cooldownReady) {
          track.centerX = detection.centerX
          track.centerY = detection.centerY
          track.prevCenterY = detection.centerY
          track.lastSeenAt = nowTs
          track.bbox = detection.bbox
          nextTracks.set(track.id, track)

          return {
            ...detection,
            trackId: track.id,
            counted: false,
            countedAnyTime: track.hasCounted,
          }
        }

        serialCountRef.current += 1
        counted = true
        track.hasCounted = true
        track.lastCountedAt = nowTs
        countedNow.push({
          id: track.id,
          className: track.className || 'objeto',
          total: serialCountRef.current,
        })
      }

        track.centerX = detection.centerX
        track.centerY = detection.centerY
        track.prevCenterY = detection.centerY
      track.lastSeenAt = nowTs
      track.bbox = detection.bbox

      nextTracks.set(track.id, track)

      return {
        ...detection,
        trackId: track.id,
        counted,
        countedAnyTime: track.hasCounted,
      }
    })

    activeTracks.forEach((track) => {
      if (availableTrackIds.has(track.id)) {
        nextTracks.set(track.id, track)
      }
    })

    tracksRef.current = nextTracks

    return {
      zone,
      serialCount: serialCountRef.current,
      countedNow,
      detections: annotatedDetections,
    }
  }

  async function resetSerialCounter(options = {}) {
    const shouldAnnounce = options.announce !== false
    tracksRef.current = new Map()
    nextTrackIdRef.current = 1
    serialCountRef.current = 0
    setSerialCount(0)
    setLastCount(0)
    setDetectedClasses({})

    if (shouldAnnounce) {
      await sendBroadcast('status', {
        message: 'Contador seriado zerado.',
        tone: 'accent',
        at: new Date().toISOString(),
      })
    }
  }

  function drawDetections(detections, trackingState = null) {
    const overlay = overlayRef.current
    const video = videoRef.current
    if (!overlay || !video || !video.videoWidth || !video.videoHeight) return

    syncOverlaySize()

    const context = overlay.getContext('2d')
    if (!context) return

    context.clearRect(0, 0, overlay.width, overlay.height)

    const zone = trackingState?.zone || buildDetectionZone(overlay.width, overlay.height)
    const gateY = getGateY(zone)
    context.fillStyle = detectingRef.current ? 'rgba(255, 93, 93, 0.12)' : 'rgba(255, 93, 93, 0.06)'
    context.strokeStyle = detectingRef.current ? 'rgba(255, 93, 93, 0.96)' : 'rgba(255, 93, 93, 0.46)'
    context.lineWidth = detectingRef.current ? 4 : 2
    context.setLineDash(detectingRef.current ? [] : [10, 8])
    context.fillRect(zone.left, zone.top, zone.width, zone.height)
    context.strokeRect(zone.left, zone.top, zone.width, zone.height)
    context.setLineDash([])

    context.beginPath()
    context.moveTo(zone.left, gateY)
    context.lineTo(zone.right, gateY)
    context.strokeStyle = 'rgba(255, 234, 234, 0.92)'
    context.lineWidth = 2
    context.stroke()

    const statusLabel = detectingRef.current ? 'Leitura ativa' : 'Zona de leitura'
    context.font = '700 18px Plus Jakarta Sans, sans-serif'
    const statusWidth = context.measureText(statusLabel).width + 24
    const statusX = zone.left + (zone.width - statusWidth) / 2
    const statusY = Math.max(8, zone.top - 38)
    context.fillStyle = detectingRef.current ? 'rgba(255, 93, 93, 0.96)' : 'rgba(120, 31, 31, 0.88)'
    context.fillRect(statusX, statusY, statusWidth, 30)
    context.fillStyle = '#fff3f3'
    context.fillText(statusLabel, statusX + 12, statusY + 6)

    context.lineWidth = 4
    context.font = '600 18px Plus Jakarta Sans, sans-serif'
    context.textBaseline = 'top'

    detections.forEach((detection) => {
      const [x, y, width, height] = detection.bbox || [0, 0, 0, 0]
      context.strokeStyle = detection.counted ? '#ffb066' : '#6ff9c5'
      context.fillStyle = 'rgba(9, 18, 31, 0.78)'
      context.beginPath()
      context.rect(x, y, width, height)
      context.stroke()

      const serialBadge = detection.countedAnyTime ? ` · #${detection.trackId}` : ''
      const label = `${detection.class} ${Math.round(Number(detection.score || 0) * 100)}%${serialBadge}`
      const textWidth = context.measureText(label).width + 18
      const textY = y > 32 ? y - 32 : y + 8

      context.fillRect(x, textY, textWidth, 26)
      context.fillStyle = '#e8fff6'
      context.fillText(label, x + 9, textY + 5)
    })
  }

  function stopDetectionLoop() {
    detectingRef.current = false
    setIsDetecting(false)
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (overlayRef.current && videoRef.current?.videoWidth) {
      drawDetections([], { zone: buildDetectionZone(overlayRef.current.width, overlayRef.current.height) })
    }
  }

  function stopCameraStream() {
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) video.srcObject = null
    clearOverlay()
    tracksRef.current = new Map()
    resetMotionHistory()
    setCameraStatus('Camera desligada')
  }

  async function disconnectChannel() {
    if (!channelRef.current) return
    try {
      await sendBroadcast('status', {
        message: 'Celular saiu da sessao.',
        tone: 'neutral',
        at: new Date().toISOString(),
      })
      await supabase.removeChannel(channelRef.current)
    } catch (error) {
      console.warn('Falha ao desconectar canal de teste:', error)
    } finally {
      channelRef.current = null
      connectedCodeRef.current = ''
      setIsConnected(false)
    }
  }

  async function connectToChannel(requestedCode = pairCode) {
    const safeCode = normalizePairCode(requestedCode)
    if (!safeCode) {
      setErrorMessage('Informe o codigo gerado na rota /teste.')
      return
    }

    setErrorMessage('')
    setPairCode(safeCode)
    await resetSerialCounter({ announce: false })
    await disconnectChannel()

    const channel = supabase
      .channel(getTestCameraChannelName(safeCode), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'host-ready' }, () => {
        setChannelStatus('Desktop pronto para receber a camera.')
      })

    channelRef.current = channel
    connectedCodeRef.current = safeCode
    setChannelStatus('Conectando ao desktop...')

    channel.subscribe(async (status) => {
      const label = CHANNEL_STATUS_LABEL[status] || `Estado do canal: ${status}`
      setChannelStatus(label)

      if (status === 'SUBSCRIBED') {
        setIsConnected(true)
        await sendBroadcast(
          'device',
          {
            pairCode: safeCode,
            deviceName: buildDeviceName(),
            screenLabel: `${window.screen.width} x ${window.screen.height}`,
            secureContext: window.isSecureContext,
            at: new Date().toISOString(),
          },
          channel
        )
        await sendBroadcast(
          'status',
          {
            message: 'Celular conectado. Libere a camera para iniciar o teste.',
            tone: 'success',
            at: new Date().toISOString(),
          },
          channel
        )
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setIsConnected(false)
      }
    })
  }

  async function startCamera() {
    if (!window.isSecureContext) {
      setErrorMessage('A camera so funciona em HTTPS ou localhost.')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Este navegador nao oferece acesso a camera.')
      return
    }

    try {
      setErrorMessage('')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: CAMERA_WIDTH_IDEAL },
          height: { ideal: CAMERA_HEIGHT_IDEAL },
          frameRate: { ideal: 30, max: 30 },
        },
      })

      streamRef.current = stream

      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      syncOverlaySize()
      drawDetections([], { zone: buildDetectionZone(video.videoWidth, video.videoHeight) })
      setCameraStatus('Camera ativa')
      await sendBroadcast('status', {
        message: 'Camera ativa no celular.',
        tone: 'success',
        cameraActive: true,
        at: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Falha ao iniciar camera:', error)
      setErrorMessage('Nao foi possivel abrir a camera. Verifique a permissao do navegador.')
      setCameraStatus('Falha ao abrir camera')
    }
  }

  function buildMotionDetections(video) {
    const canvas = motionCanvasRef.current
    if (!canvas || !video?.videoWidth || !video?.videoHeight) {
      return { zone: buildDetectionZone(0, 0), detections: [] }
    }

    const zone = buildDetectionZone(video.videoWidth, video.videoHeight)
    canvas.width = MOTION_SAMPLE_SIZE
    canvas.height = MOTION_SAMPLE_SIZE

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return { zone, detections: [] }

    context.drawImage(
      video,
      zone.left,
      zone.top,
      zone.width,
      zone.height,
      0,
      0,
      MOTION_SAMPLE_SIZE,
      MOTION_SAMPLE_SIZE
    )

    const image = context.getImageData(0, 0, MOTION_SAMPLE_SIZE, MOTION_SAMPLE_SIZE)
    const gray = new Uint8Array(MOTION_SAMPLE_SIZE * MOTION_SAMPLE_SIZE)
    for (let pixelIndex = 0; pixelIndex < gray.length; pixelIndex += 1) {
      const offset = pixelIndex * 4
      gray[pixelIndex] = Math.round(
        image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114
      )
    }

    const previousGray = previousMotionFrameRef.current
    previousMotionFrameRef.current = gray
    if (!previousGray) return { zone, detections: [] }

    const binary = new Uint8Array(gray.length)
    let changedPixels = 0
    let changedMinX = MOTION_SAMPLE_SIZE
    let changedMaxX = -1
    let changedMinY = MOTION_SAMPLE_SIZE
    let changedMaxY = -1
    for (let index = 0; index < gray.length; index += 1) {
      const diff = Math.abs(gray[index] - previousGray[index])
      const changed = diff >= MOTION_DIFF_THRESHOLD ? 1 : 0
      binary[index] = changed
      changedPixels += changed
      if (changed) {
        const pixelX = index % MOTION_SAMPLE_SIZE
        const pixelY = Math.floor(index / MOTION_SAMPLE_SIZE)
        if (pixelX < changedMinX) changedMinX = pixelX
        if (pixelX > changedMaxX) changedMaxX = pixelX
        if (pixelY < changedMinY) changedMinY = pixelY
        if (pixelY > changedMaxY) changedMaxY = pixelY
      }
    }

    const changedRatio = changedPixels / binary.length
    const changedSpreadX = changedMaxX >= changedMinX ? (changedMaxX - changedMinX + 1) / MOTION_SAMPLE_SIZE : 0
    const changedSpreadY = changedMaxY >= changedMinY ? (changedMaxY - changedMinY + 1) / MOTION_SAMPLE_SIZE : 0
    if (
      changedRatio > MOTION_SHAKE_CHANGED_RATIO &&
      (changedSpreadX > MOTION_SHAKE_SPREAD_RATIO || changedSpreadY > MOTION_SHAKE_SPREAD_RATIO)
    ) {
      previousMotionFrameRef.current = gray
      return { zone, detections: [], cameraShake: true, changedRatio }
    }

    const visited = new Uint8Array(gray.length)
    const detections = []
    const scaleX = zone.width / MOTION_SAMPLE_SIZE
    const scaleY = zone.height / MOTION_SAMPLE_SIZE

    for (let y = 0; y < MOTION_SAMPLE_SIZE; y += 1) {
      for (let x = 0; x < MOTION_SAMPLE_SIZE; x += 1) {
        const startIndex = y * MOTION_SAMPLE_SIZE + x
        if (!binary[startIndex] || visited[startIndex]) continue

        const queue = [startIndex]
        visited[startIndex] = 1
        let area = 0
        let minX = x
        let maxX = x
        let minY = y
        let maxY = y
        const columnStats = new Map()

        while (queue.length) {
          const currentIndex = queue.pop()
          const currentX = currentIndex % MOTION_SAMPLE_SIZE
          const currentY = Math.floor(currentIndex / MOTION_SAMPLE_SIZE)
          area += 1
          if (currentX < minX) minX = currentX
          if (currentX > maxX) maxX = currentX
          if (currentY < minY) minY = currentY
          if (currentY > maxY) maxY = currentY

          const existingColumn = columnStats.get(currentX) || {
            count: 0,
            minY: currentY,
            maxY: currentY,
          }
          existingColumn.count += 1
          if (currentY < existingColumn.minY) existingColumn.minY = currentY
          if (currentY > existingColumn.maxY) existingColumn.maxY = currentY
          columnStats.set(currentX, existingColumn)

          const neighbors = [
            currentIndex - 1,
            currentIndex + 1,
            currentIndex - MOTION_SAMPLE_SIZE,
            currentIndex + MOTION_SAMPLE_SIZE,
          ]

          neighbors.forEach((neighborIndex) => {
            if (neighborIndex < 0 || neighborIndex >= binary.length) return
            const neighborX = neighborIndex % MOTION_SAMPLE_SIZE
            if (Math.abs(neighborX - currentX) > 1) return
            if (!binary[neighborIndex] || visited[neighborIndex]) return
            visited[neighborIndex] = 1
            queue.push(neighborIndex)
          })
        }

        const width = maxX - minX + 1
        const height = maxY - minY + 1
        const areaRatio = area / binary.length
        if (area < MOTION_MIN_BLOB_AREA || width < 4 || height < 6) continue
        if (areaRatio > MOTION_MAX_BLOB_RATIO) continue
        if (height < width * 0.7) continue

        const columnGroups = []
        let activeGroup = null
        let gapCount = 0
        for (let column = minX; column <= maxX; column += 1) {
          const stats = columnStats.get(column)
          const isStrongColumn = Boolean(stats && stats.count >= MOTION_MIN_COLUMN_PIXELS)

          if (isStrongColumn) {
            if (!activeGroup) {
              activeGroup = {
                minX: column,
                maxX: column,
                minY: stats.minY,
                maxY: stats.maxY,
                columns: 1,
              }
            } else {
              activeGroup.maxX = column
              if (stats.minY < activeGroup.minY) activeGroup.minY = stats.minY
              if (stats.maxY > activeGroup.maxY) activeGroup.maxY = stats.maxY
              activeGroup.columns += 1
            }
            gapCount = 0
          } else if (activeGroup) {
            gapCount += 1
            if (gapCount > 1) {
              columnGroups.push(activeGroup)
              activeGroup = null
              gapCount = 0
            }
          }
        }
        if (activeGroup) columnGroups.push(activeGroup)

        const validGroups = columnGroups.filter((group) => {
          const groupWidth = group.maxX - group.minX + 1
          const groupHeight = group.maxY - group.minY + 1
          return groupWidth >= 3 && groupHeight >= 5
        })

        const groupsToUse = validGroups.length ? validGroups : [{ minX, maxX, minY, maxY }]

        groupsToUse.forEach((group) => {
          const groupWidth = group.maxX - group.minX + 1
          const groupHeight = group.maxY - group.minY + 1
          detections.push({
            class: 'peca',
            score: 0.99,
            bbox: [
              Math.round(zone.left + group.minX * scaleX),
              Math.round(zone.top + group.minY * scaleY),
              Math.round(groupWidth * scaleX),
              Math.round(groupHeight * scaleY),
            ],
          })
        })
      }
    }

    return { zone, detections, cameraShake: false, changedRatio }
  }

  function buildPreviewFrame() {
    const video = videoRef.current
    const canvas = workCanvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return ''

    const targetWidth = 260
    const targetHeight = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * targetWidth))
    canvas.width = targetWidth
    canvas.height = targetHeight

    const context = canvas.getContext('2d')
    if (!context) return ''

    context.drawImage(video, 0, 0, targetWidth, targetHeight)
    return canvas.toDataURL('image/jpeg', 0.62)
  }

  async function processMotionFrame(now) {
    const video = videoRef.current
    if (!video || video.readyState < 2) return

    const motionState = buildMotionDetections(video)
    if (motionState.cameraShake) {
      drawDetections([], motionState)
      setLastCount(0)
      setDetectedClasses({})
      setModelStatus('Camera instavel: mantenha o celular fixo')

      if (now - lastShakeWarningRef.current > 1000) {
        lastShakeWarningRef.current = now
        void sendBroadcast('status', {
          message: 'Movimento excessivo da camera detectado. Fixe melhor o celular.',
          tone: 'warning',
          at: new Date().toISOString(),
        })
      }

      lastTickRef.current = now
      return
    }

    setModelStatus('Leitura rapida por queda ativa')
    const trackingState = updateSerialTracker(motionState.detections, video.videoWidth, video.videoHeight)
    drawDetections(trackingState.detections, trackingState)

    const classesSummary = trackingState.detections.length
      ? { peca: trackingState.detections.length }
      : {}

    setDetectedClasses(classesSummary)
    setLastCount(trackingState.detections.length)
    setSerialCount(trackingState.serialCount)
    setLastDetectionAt(new Date().toISOString())

    if (lastTickRef.current) {
      const rate = 1000 / Math.max(1, now - lastTickRef.current)
      setAnalysisRate(rate.toFixed(1))
    }
    lastTickRef.current = now

    const payload = {
      at: new Date().toISOString(),
      count: trackingState.detections.length,
      serialCount: trackingState.serialCount,
      countMode: 'serie',
      engine: 'movimento',
      targetClass: 'queda rapida',
      minScore: 0,
      detections: trackingState.detections.slice(0, 12).map((item) => ({
        className: item.class,
        score: 0.99,
        bbox: Array.isArray(item.bbox) ? item.bbox.map((value) => Math.round(value)) : [],
        trackId: item.trackId,
        counted: Boolean(item.counted),
      })),
      classes: classesSummary,
    }

    if (trackingState.countedNow.length) {
      void sendBroadcast('status', {
        message: `Peca contabilizada na queda. Total seriado: ${trackingState.serialCount}.`,
        tone: 'success',
        at: payload.at,
      })
    }

    if (now - lastPreviewRef.current > PREVIEW_INTERVAL_MS) {
      const preview = buildPreviewFrame()
      if (preview) {
        payload.preview = preview
        void sendBroadcast('preview', { image: preview, at: payload.at })
      }
      lastPreviewRef.current = now
    }

    void sendBroadcast('detection', payload)
  }

  async function startDetection() {
    try {
      setErrorMessage('')

      if (!channelRef.current) {
        await connectToChannel()
      }

      if (!streamRef.current) {
        await startCamera()
      }

      tracksRef.current = new Map()
      resetMotionHistory()

      detectingRef.current = true
      setIsDetecting(true)
      setModelStatus('Leitura rapida por queda ativa')

      await sendBroadcast('status', {
        message: 'Modo rapido em execucao no celular.',
        tone: 'success',
        at: new Date().toISOString(),
      })

      const loop = async (now) => {
        if (!detectingRef.current) return
        if (processingRef.current || now - lastTickRef.current < MOTION_INTERVAL_MS) {
          rafRef.current = window.requestAnimationFrame(loop)
          return
        }

        processingRef.current = true
        try {
          await processMotionFrame(now)
        } catch (error) {
          console.error('Falha ao processar frame:', error)
          setErrorMessage('A analise falhou neste frame. Ajuste a iluminacao e tente novamente.')
          void sendBroadcast('status', {
            message: 'Erro ao processar frame da camera.',
            tone: 'warning',
            at: new Date().toISOString(),
          })
          stopDetectionLoop()
        } finally {
          processingRef.current = false
          if (detectingRef.current) {
            rafRef.current = window.requestAnimationFrame(loop)
          }
        }
      }

      rafRef.current = window.requestAnimationFrame(loop)
    } catch (error) {
      console.error('Falha ao iniciar deteccao:', error)
      setErrorMessage('Nao foi possivel iniciar a IA. Recarregue a pagina e tente outra vez.')
      stopDetectionLoop()
    }
  }

  async function pauseDetection() {
    stopDetectionLoop()
    setModelStatus('Leitura pausada')
    await sendBroadcast('status', {
      message: 'Leitura pausada no celular.',
      tone: 'neutral',
      at: new Date().toISOString(),
    })
  }

  return (
    <div className="teste-mobile-shell">
      <div className="teste-mobile-header">
        <span className="teste-eyebrow">/site camera</span>
        <h1>Camera remota para o laboratorio /teste</h1>
        <p>
          Conecte este celular ao desktop, fixe a camera e use a zona central para contar a queda
          das pecas em serie. Boa iluminacao e celular firme fazem diferenca direta aqui.
        </p>
      </div>

      <section className="teste-mobile-card">
        <p className="teste-muted teste-mode-note">
          O sistema agora usa apenas leitura rapida por movimento. Ele conta cruzamentos reais na
          linha dentro do quadrado e descarta quadros com tremida excessiva da camera.
        </p>

        <label className="teste-field">
          <span>Codigo da sessao</span>
          <input
            value={pairCode}
            onChange={(event) => setPairCode(normalizePairCode(event.target.value))}
            placeholder="Ex.: A7K9Q2"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
          />
        </label>

        <div className="teste-mobile-actions two-up">
          <button className="teste-btn teste-btn-primary" onClick={() => connectToChannel()}>
            {isConnected ? 'Reconectar sessao' : 'Conectar ao desktop'}
          </button>
          <a className="teste-btn teste-btn-ghost" href="/site">
            Voltar ao site
          </a>
        </div>

        <div className="teste-mobile-status-grid">
          <div>
            <span className="teste-label">Canal</span>
            <strong>{channelStatus}</strong>
          </div>
          <div>
            <span className="teste-label">Camera</span>
            <strong>{cameraStatus}</strong>
          </div>
          <div>
            <span className="teste-label">Leitura</span>
            <strong>{modelStatus}</strong>
          </div>
        </div>

        {!window.isSecureContext ? (
          <div className="teste-warning-banner">
            A camera do navegador exige HTTPS ou localhost. Em ambiente publico, abra esta pagina
            sempre por link seguro.
          </div>
        ) : null}

        {errorMessage ? <div className="teste-warning-banner is-error">{errorMessage}</div> : null}
      </section>

      <section className="teste-mobile-stage-card">
        <div className="teste-mobile-stage">
          <video ref={videoRef} className="teste-mobile-video" playsInline muted autoPlay />
          <canvas ref={overlayRef} className="teste-mobile-overlay" />
          {!streamRef.current ? (
            <div className="teste-mobile-empty">
              <strong>Camera ainda desligada</strong>
              <span>Use o botao abaixo para liberar a camera do celular.</span>
            </div>
          ) : null}
        </div>
        <canvas ref={workCanvasRef} className="teste-hidden-canvas" />
        <canvas ref={motionCanvasRef} className="teste-hidden-canvas" />
      </section>

      <section className="teste-mobile-card">
        <div className="teste-mobile-actions">
          <button className="teste-btn teste-btn-secondary" onClick={startCamera}>
            Ativar camera
          </button>
          <button className="teste-btn teste-btn-primary" onClick={startDetection}>
            Iniciar leitura
          </button>
          <button className="teste-btn teste-btn-ghost" onClick={pauseDetection}>
            Pausar leitura
          </button>
          <button className="teste-btn teste-btn-ghost" onClick={() => resetSerialCounter()}>
            Zerar acumulado
          </button>
          <button
            className="teste-btn teste-btn-ghost"
            onClick={async () => {
              stopDetectionLoop()
              stopCameraStream()
              await sendBroadcast('status', {
                message: 'Camera desligada no celular.',
                tone: 'neutral',
                cameraActive: false,
                at: new Date().toISOString(),
              })
            }}
          >
            Desligar camera
          </button>
        </div>

        <div className="teste-mobile-stats">
          <article>
            <span className="teste-label">Contagem seriada</span>
            <strong>{serialCount}</strong>
          </article>
          <article>
            <span className="teste-label">Contagem atual</span>
            <strong>{lastCount}</strong>
          </article>
          <article>
            <span className="teste-label">Ultima leitura</span>
            <strong>{formatClock(lastDetectionAt)}</strong>
          </article>
          <article>
            <span className="teste-label">Taxa de analise</span>
            <strong>{analysisRate} fps</strong>
          </article>
          <article>
            <span className="teste-label">Estado</span>
            <strong>{isDetecting ? 'Rodando' : 'Parado'}</strong>
          </article>
        </div>
      </section>

      <section className="teste-mobile-card">
        <div className="teste-band-hint">
          A janela vermelha na parte superior e a zona valida de leitura. O sistema so detecta e soma objetos
          quando o centro da peca entra nesse espaco. A linha clara dentro da janela e o gatilho
          de contagem seriada. Se a camera balancar, o quadro e ignorado para evitar contagem falsa.
        </div>

        <p className="teste-muted">
          Para reduzir falso positivo, mantenha o celular fixo, deixe apenas a area de queda dentro
          do quadrado e evite sombras atravessando a linha de contagem.
        </p>

        {Object.keys(detectedClasses).length ? (
          <div className="teste-chip-wrap">
            {Object.entries(detectedClasses).map(([className, total]) => (
              <span className="teste-chip" key={className}>
                {className} <strong>{total}</strong>
              </span>
            ))}
          </div>
        ) : (
          <p className="teste-muted">Nenhuma classe detectada no momento.</p>
        )}
      </section>
    </div>
  )
}