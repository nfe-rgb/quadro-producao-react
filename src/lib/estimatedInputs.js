export function estimateInputsForQueue(orders, rangePieces) {
  let remainingPieces = Math.max(0, Number(rangePieces) || 0)
  const totalsByCode = new Map()

  for (const order of orders || []) {
    if (remainingPieces <= 0) break

    const orderQty = Math.max(0, Number(order?.orderQty) || 0)
    const allocatedPieces = Math.min(orderQty, remainingPieces)
    remainingPieces -= allocatedPieces
    if (allocatedPieces <= 0) continue

    for (const input of order?.orderInputTotals || []) {
      const inputCode = String(input?.itemCode || '').trim()
      const qtyPerPiece = Number(input?.qtyPerPiece || 0)
      const totalQty = allocatedPieces * qtyPerPiece
      if (!inputCode || !Number.isFinite(totalQty) || totalQty <= 0) continue
      totalsByCode.set(inputCode, (totalsByCode.get(inputCode) || 0) + totalQty)
    }
  }

  return Object.fromEntries(totalsByCode)
}
