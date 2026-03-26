const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const TESTE_CAMERA_CHANNEL_PREFIX = 'teste-camera'

export function normalizePairCode(value = '') {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

export function createPairCode(length = 6) {
  const safeLength = Math.max(4, Math.min(8, Number(length) || 6))
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : null
  let output = ''

  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(safeLength)
    cryptoApi.getRandomValues(values)
    for (let index = 0; index < safeLength; index += 1) {
      output += PAIR_ALPHABET[values[index] % PAIR_ALPHABET.length]
    }
    return output
  }

  for (let index = 0; index < safeLength; index += 1) {
    output += PAIR_ALPHABET[Math.floor(Math.random() * PAIR_ALPHABET.length)]
  }

  return output
}

export function getTestCameraChannelName(pairCode) {
  const normalized = normalizePairCode(pairCode) || 'SEM-CODIGO'
  return `${TESTE_CAMERA_CHANNEL_PREFIX}:${normalized}`
}

export function buildTestCameraUrl(origin, pairCode) {
  const normalized = normalizePairCode(pairCode)
  if (!origin || !normalized) return ''
  const safeOrigin = String(origin).replace(/\/+$/, '')
  return `${safeOrigin}/site/camera?code=${normalized}`
}

export function formatDetectionClasses(detections = []) {
  const totals = {}

  detections.forEach((detection) => {
    const className = String(detection?.className || detection?.class || 'objeto').trim() || 'objeto'
    totals[className] = (totals[className] || 0) + 1
  })

  return Object.fromEntries(
    Object.entries(totals).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
  )
}