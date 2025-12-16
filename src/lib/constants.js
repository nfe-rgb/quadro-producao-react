// src/lib/constants.js
export const ADMIN_EMAILS = ['nfe@savantiplasticos.com.br','suporte@savantiplasticos.com.br','qualidade@savantiplasticos.com.br'];

export const MAQUINAS = ['P1','P2','P3','I1','I2','I3','I4','I5','I6']

export const STATUS = ['AGUARDANDO','PRODUZINDO','BAIXA_EFICIENCIA','PARADA']

export const MOTIVOS_PARADA = [
  'SET UP','MATERIAL FRIO','TROCA DE COR','FIM DE SEMANA','INÍCIO DE MÁQUINA','FALTA DE OPERADOR / PREPARADOR',
  'TRY-OUT / TESTE','QUALIDADE / REGULAGEM','MANUTENÇÃO ELÉTRICA','MANUTENÇÃO MECÂNICA',
  'FALTA DE PEDIDO','FIM OP','FALTA DE ABASTECIMENTO','FALTA DE INSUMOS','FALTA DE ENERGIA ELÉTRICA','FALTA DE PROGRAMAÇÃO',
]
export const REFUGO_MOTIVOS = ['Troca de Cor','Regulagem','Rebarba','Bolha','Contaminação ou Caídas no Chão',
  'Ponto de Injeção Alto ou Deslocado','Sujas de Óleo','Fora de Cor','Parede Fraca','Fundo/Ombro Deformado',
  'Peças falhadas','Peças Furadas','Fiapo','Queimadas','Manchadas',
];
export const TURNOS = [
  { key: '3', label: 'Turno 3' },
  { key: '1', label: 'Turno 1' },
  { key: '2', label: 'Turno 2' },
];