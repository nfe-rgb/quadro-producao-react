const PRODUCT_IMAGE_BY_CODE = {
  // Exemplo:
  // '50123': '/imagens-produtos/50123.jpg',
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const PRODUCT_IMAGE_STORAGE_KEY = 'product-image-by-code-v1'

const normalizeCode = (value) => String(value ?? '').trim()

const canUseLocalStorage = () => typeof window !== 'undefined' && !!window.localStorage

const readDynamicImageMap = () => {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(PRODUCT_IMAGE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writeDynamicImageMap = (map) => {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.setItem(PRODUCT_IMAGE_STORAGE_KEY, JSON.stringify(map || {}))
  } catch {
    // ignora erros de armazenamento local
  }
}

export function getProductImageOverride(itemCode) {
  const code = normalizeCode(itemCode)
  if (!code) return ''
  const map = readDynamicImageMap()
  return normalizeCode(map[code])
}

export function setProductImageOverride(itemCode, imageUrl) {
  const code = normalizeCode(itemCode)
  if (!code) return
  const map = readDynamicImageMap()
  const normalizedUrl = normalizeCode(imageUrl)
  if (normalizedUrl) {
    map[code] = normalizedUrl
  } else {
    delete map[code]
  }
  writeDynamicImageMap(map)
}

export function getProductImageCandidates(itemCode) {
  const code = normalizeCode(itemCode)
  if (!code) return []

  const dynamicMapped = getProductImageOverride(code)
  const mapped = normalizeCode(PRODUCT_IMAGE_BY_CODE[code])
  const fallbackByConvention = IMAGE_EXTENSIONS.map((ext) => `/imagens-produtos/${code}.${ext}`)

  return [dynamicMapped, mapped, ...fallbackByConvention].filter(Boolean)
}

export { PRODUCT_IMAGE_BY_CODE }