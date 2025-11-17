# Copilot Instructions for quadro-producao-react

## Visão Geral
Este projeto é um quadro de produção industrial construído com React + Vite. O foco é a visualização, controle e registro de ordens de produção (O.P.), paradas de máquina, eficiência e fluxo de itens. O backend utiliza Supabase para autenticação e persistência.

## Estrutura Principal
- **src/App.jsx**: Componente raiz, gerencia estado global, autenticação, e orquestra as "abas" principais.
- **src/abas/**: Cada arquivo representa uma aba funcional (Lista, Painel, Registro, NovaOrdem, CadastroItens, Login). Cada aba recebe props do App e manipula dados específicos.
- **src/components/**: Componentes reutilizáveis (Etiqueta, Modal, FilaSortableItem, etc).
- **src/lib/**: Utilitários, constantes globais (ex: MAQUINAS), integração Supabase.
- **src/styles/**: CSS modularizado por contexto (cards, forms, helpers, etc).

## Fluxo de Dados
- O estado das ordens, paradas e usuários é mantido no App e propagado via props.
- Comunicação com Supabase ocorre via `src/lib/supabaseClient.js`.
- Cada aba manipula seu próprio estado local, mas depende do estado global para sincronização.
- Paradas, eventos e eficiência são agrupados e exibidos por máquina (ver `Registro.jsx`).

## Convenções e Padrões
- **MAQUINAS**: Lista de máquinas centralizada em `src/lib/constants.js`.
- **Eventos de O.P.**: Cada ordem pode ter eventos como início, parada, reinício, baixa eficiência, etc. Estes são renderizados em timelines (ver `Registro.jsx`).
- **Estilos**: Preferência por CSS modular, com helpers e grids definidos em `src/styles/helpers.css`.
- **Componentização**: Componentes são "flat" e recebem props explícitos, evitando contextos globais complexos.
- **Validação de CSV**: Cadastro de itens exige cabeçalhos específicos (ver `EXPECTED_HEADERS` em `CadastroItens.jsx`).

## Workflows de Desenvolvimento
- **Build/Dev**: Use `npm run dev` para desenvolvimento local, `npm run build` para produção.
- **Lint**: Execute `npm run lint` para validação de código. ESLint configurado para ignorar variáveis iniciadas por maiúsculas (ex: MAQUINAS).
- **Preview**: `npm run preview` para simular produção.
- **Autenticação/Admin**: Usuários admin são definidos em `ADMIN_EMAILS`.

## Integrações e Dependências
- **Supabase**: Configuração via `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
- **@dnd-kit**: Usado para drag-and-drop na aba Lista.
- **papaparse**: Utilizado para importação de CSV no cadastro de itens.

## Exemplos de Padrões
- Timeline de eventos de O.P. em `Registro.jsx`:
  ```jsx
  events.push({ id: `stop-${st.id}`, type: 'stop', ... })
  // Renderização condicional por tipo
  if (ev.type === 'stop') { /* ... */ }
  ```
- Validação de cabeçalhos CSV:
  ```js
  const EXPECTED_HEADERS = ['code','description','color',...]
  // ...
  validateHeaders(fields)
  ```

## Recomendações para Agentes
- Sempre consulte `src/lib/constants.js` para valores globais.
- Siga os padrões de timeline/eventos para novas funcionalidades relacionadas a O.P.
- Use os estilos e helpers definidos em `src/styles/helpers.css` para consistência visual.
- Para integração com Supabase, utilize apenas o client já configurado.
- Mantenha a componentização "flat" e evite contextos globais complexos.

---

Seções incompletas ou dúvidas? Solicite exemplos ou esclarecimentos sobre fluxos específicos, integrações ou padrões não documentados.