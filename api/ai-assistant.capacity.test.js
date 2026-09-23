import test from 'node:test'
import assert from 'node:assert/strict'

import { getProductionWindowHours, isDetailedCapacityExplanationQuestion, isEndOfDayProjectionQuestion, isEndOfMonthCapacityQuestion, isProjectedRevenueQuestion } from './ai-assistant.js'

test('getProductionWindowHours respeita a janela real do período e os turnos productivos', () => {
  const hours = getProductionWindowHours('2026-09-23T10:39:00-03:00', '2026-09-30T23:59:00-03:00')

  assert.ok(Number.isFinite(hours))
  assert.ok(hours > 120)
  assert.ok(hours < 170)
})

test('getProductionWindowHours limita o domingo ao fim do período quando o intervalo termina às 23:59', () => {
  const hours = getProductionWindowHours('2026-09-27T23:00:00-03:00', '2026-09-27T23:59:00-03:00')

  assert.ok(hours > 0.9 && hours < 1.1)
})

test('reconhece pedido de detalhamento de capacidade em sequencia por O.P.', () => {
  assert.equal(isDetailedCapacityExplanationQuestion('Me explique detalhadamente como chegou a este valor da capacidade de faturamento da P1'), true)
  assert.equal(isDetailedCapacityExplanationQuestion('Qual a capacidade total da P1 em R$?'), false)
})

test('forca a janela ate o fim do mes para capacidade em R$ da maquina', () => {
  assert.equal(isEndOfMonthCapacityQuestion('Qual nossa capacidade de faturamento em R$ ate o fim deste mes na maquina P1?'), true)
  assert.equal(isEndOfMonthCapacityQuestion('Qual a capacidade de faturamento da P1 hoje?'), false)
})

test('roteia faturamento ate o fim do dia para capacidade projetada', () => {
  assert.equal(isProjectedRevenueQuestion('Qual faturamento da maquina P1 ate o fim do dia?'), true)
  assert.equal(isEndOfDayProjectionQuestion('Qual faturamento da maquina P1 ate o fim do dia?'), true)
  assert.equal(isProjectedRevenueQuestion('Qual a projecao de faturamento de hoje?'), true)
  assert.equal(isProjectedRevenueQuestion('Quanto foi produzido em faturamento hoje?'), false)
})
