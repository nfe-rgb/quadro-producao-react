import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateInputsForQueue } from './estimatedInputs.js'

test('consolida todos os códigos das O.P.s cobertas e soma o mesmo insumo', () => {
  const orders = [
    {
      code: '2157',
      orderQty: 100,
      orderInputTotals: [
        { itemCode: '100001', qtyPerPiece: 0.5 },
        { itemCode: '100056', qtyPerPiece: 0.1 },
      ],
    },
    {
      code: '2158',
      orderQty: 200,
      orderInputTotals: [
        { itemCode: '100056', qtyPerPiece: 0.2 },
        { itemCode: '100110', qtyPerPiece: 0.03 },
      ],
    },
    {
      code: '2159',
      orderQty: 100,
      orderInputTotals: [{ itemCode: '100999', qtyPerPiece: 1 }],
    },
  ]

  const allocatedOrders = [
    { order: orders[0], pieces: 100 },
    { order: orders[1], pieces: 150 },
  ]
  const expectedCodes = new Set(
    allocatedOrders.flatMap(({ order }) => order.orderInputTotals
      .filter((input) => input.qtyPerPiece > 0)
      .map((input) => input.itemCode)),
  )
  const consolidated = estimateInputsForQueue(orders, 250)
  const consolidatedCodes = new Set(Object.keys(consolidated))

  assert.deepEqual(consolidatedCodes, expectedCodes)
  assert.equal(consolidated['100001'], 50)
  assert.equal(consolidated['100056'], 40)
  assert.equal(consolidated['100110'], 4.5)
  assert.equal(consolidated['100999'], undefined)
})

test('soma estruturas repetidas pelo mesmo código e ignora consumo não positivo', () => {
  const consolidated = estimateInputsForQueue([
    {
      orderQty: 10,
      orderInputTotals: [
        { itemCode: '100056', qtyPerPiece: 0.1 },
        { itemCode: '100056', qtyPerPiece: 0.2 },
        { itemCode: '100110', qtyPerPiece: 0 },
      ],
    },
  ], 10)

  assert.deepEqual(consolidated, { '100056': 3 })
})
