const PRODUCT_IMAGE_BY_CODE = {
  // Exemplo:
  // '50123': '/imagens-produtos/50123.jpg',
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

const normalizeCode = (value) => String(value ?? '').trim()

export function getProductImageCandidates(itemCode, explicitImageUrl = '') {
  const code = normalizeCode(itemCode)
  if (!code) return []

  const explicit = normalizeCode(explicitImageUrl)
  const mapped = normalizeCode(PRODUCT_IMAGE_BY_CODE[code])
  const fallbackByConvention = IMAGE_EXTENSIONS.map((ext) => `/imagens-produtos/${code}.${ext}`)

  return [explicit, mapped, ...fallbackByConvention].filter(Boolean)
}

export { PRODUCT_IMAGE_BY_CODE }