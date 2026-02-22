# Feature Specification: Sincronização da Interface na "Avaliação com IA" (Assessment)

**Feature Branch**: `003-fix-assessment-sync`  
**Created**: 2026-02-19  
**Status**: Draft  
**Input**: User description: "Melhoria de UX e Correção de Bug: Sincronização da Interface na Avaliação com IA (Assessment)"

## Clarifications

### Session 2026-02-19

- Q: Quando a IA retorna uma sugestão, o radio button deve ser auto-selecionado imediatamente ou apenas ao aceitar? → A: Suggestion card primeiro, seleção do radio button apenas ao aceitar (Option A — espelha o fluxo da Extração: sugestão aparece como card com confiança + botões aceitar/rejeitar; radio button só muda quando o usuário clica "Aceitar").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seleção automática da variável após avaliação com IA (Priority: P1)

O usuário está avaliando a qualidade de um artigo e clica no botão "Avaliar com IA" para um item específico do instrumento de avaliação. Após o backend processar e retornar a sugestão da IA (ex: "no information", "yes", "no"), o frontend deve exibir a sugestão como um card com badge de confiança e botões de aceitar/rejeitar (mesmo padrão da Extração). Ao clicar em "Aceitar", o radio button correspondente é automaticamente selecionado e a resposta é persistida.

Atualmente, o backend retorna sucesso com a sugestão, mas o frontend não reage a esse retorno — nenhum card de sugestão aparece e o campo permanece vazio, forçando o usuário a localizar e selecionar manualmente o valor sugerido.

**Why this priority**: Este é o bug principal reportado. Sem essa correção, toda avaliação com IA exige intervenção manual, anulando o propósito da funcionalidade automatizada.

**Independent Test**: Pode ser testado clicando "Avaliar com IA" em qualquer item de assessment e verificando que o card de sugestão aparece com badge de confiança e botões aceitar/rejeitar. Ao clicar "Aceitar", o radio button correspondente é selecionado.

**Acceptance Scenarios**:

1. **Given** o usuário está na tela de Assessment com um item sem resposta, **When** clica em "Avaliar com IA" e o backend retorna sucesso com sugestão "no information", **Then** um card de sugestão aparece com o nível sugerido, badge de confiança e botões aceitar/rejeitar. Ao clicar "Aceitar", o radio button "no information" é selecionado e a resposta é persistida.
2. **Given** o usuário está na tela de Assessment com um item que já possui uma resposta manual "yes", **When** clica em "Avaliar com IA" e o backend retorna sugestão "no", **Then** o card de sugestão aparece com o novo nível. Ao clicar "Aceitar", o radio button "no" é selecionado, substituindo a seleção anterior.
3. **Given** o usuário clica em "Avaliar com IA" e o backend retorna erro, **When** a requisição falha, **Then** o estado do item não é alterado e o usuário vê uma mensagem de erro clara.
4. **Given** um card de sugestão da IA está visível, **When** o usuário clica "Rejeitar", **Then** o card de sugestão é removido e o radio button permanece no estado anterior (sem alteração).

---

### User Story 2 - Exibição de metadados da IA no Assessment (Priority: P2)

Após a avaliação com IA ser concluída, o usuário deve ver os metadados da sugestão — grau de confiança (porcentagem), tokens usados e feedback/justificativa — no mesmo padrão visual já existente na tela de Extração.

Atualmente, os metadados podem não estar visíveis ou exibidos de forma inconsistente comparado à Extração.

**Why this priority**: Metadados de confiança e justificativa são essenciais para o usuário decidir se aceita ou rejeita a sugestão da IA. Sem eles, o usuário não tem embasamento para confiar na sugestão automática.

**Independent Test**: Pode ser testado acionando a avaliação com IA em um item e verificando que badge de confiança, tokens usados e popover de justificativa aparecem corretamente.

**Acceptance Scenarios**:

1. **Given** a IA avaliou um item com 80% de confiança, **When** a resposta é exibida, **Then** o badge de confiança mostra "80%" ao lado da sugestão.
2. **Given** a IA avaliou um item, **When** o usuário clica no badge de confiança, **Then** um popover exibe a justificativa (reasoning) e evidências da IA.
3. **Given** a IA avaliou um item usando 40.766 tokens, **When** a avaliação é concluída, **Then** uma notificação (toast) exibe a quantidade de tokens usados.

---

### User Story 3 - Experiência de loading e feedback visual consistente (Priority: P2)

Durante o processamento da avaliação com IA, o usuário deve ver o mesmo padrão de feedback visual da Extração: botão desabilitado com spinner, indicação clara de que a IA está processando, e transição suave para o resultado.

**Why this priority**: Uma experiência de loading inconsistente entre Assessment e Extração gera confusão e sensação de que o sistema está quebrado.

**Independent Test**: Pode ser testado clicando "Avaliar com IA" e observando que o botão mostra spinner, fica desabilitado durante o processamento, e retorna ao estado normal após conclusão.

**Acceptance Scenarios**:

1. **Given** o usuário clica em "Avaliar com IA", **When** a requisição está em andamento, **Then** o botão de IA fica desabilitado e exibe um spinner de carregamento.
2. **Given** a requisição de IA está em andamento, **When** o processamento é concluído com sucesso, **Then** o spinner desaparece, o botão volta ao estado normal, e a sugestão aparece com metadados.
3. **Given** a requisição de IA está em andamento para um item específico, **When** o usuário navega para outro domínio/seção, **Then** o estado de loading é preservado e visível ao retornar ao item.

---

### Edge Cases

- O que acontece quando a IA retorna uma sugestão com um nível que não existe nas opções do item? O sistema deve ignorar a seleção automática e exibir a sugestão como informação apenas, sem selecionar nenhum radio button.
- O que acontece se o usuário edita manualmente a resposta enquanto a IA está processando? A resposta manual do usuário deve ter prioridade — a sugestão da IA é exibida como sugestão, mas não sobrescreve automaticamente uma edição feita durante o processamento.
- O que acontece se múltiplas avaliações com IA são disparadas simultaneamente para itens diferentes? Cada item deve gerenciar seu próprio estado de loading e atualização independentemente.
- O que acontece quando a conexão com o backend é perdida durante o processamento? Uma mensagem de erro clara deve ser exibida e o estado do item deve permanecer inalterado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE exibir um card de sugestão da IA (com nível sugerido, badge de confiança e botões aceitar/rejeitar) ao receber uma resposta de sucesso do backend. Ao clicar "Aceitar", o radio button correspondente é selecionado e a resposta é persistida no banco.
- **FR-002**: O sistema DEVE exibir o grau de confiança da sugestão da IA como badge percentual ao lado do item avaliado, seguindo o mesmo padrão visual da tela de Extração.
- **FR-003**: O sistema DEVE exibir um popover com justificativa (reasoning) e evidências ao clicar no badge de confiança, seguindo o mesmo padrão visual da tela de Extração.
- **FR-004**: O sistema DEVE exibir uma notificação (toast) após conclusão da avaliação com IA, incluindo o resultado da sugestão e quantidade de tokens usados.
- **FR-005**: O sistema DEVE desabilitar o botão de "Avaliar com IA" e exibir spinner de carregamento durante o processamento da requisição, seguindo o mesmo padrão visual da tela de Extração.
- **FR-006**: O sistema DEVE preservar a resposta manual do usuário se este editar a resposta enquanto a IA estiver processando — a sugestão da IA deve aparecer como sugestão, sem sobrescrever automaticamente a edição manual feita durante o processamento. Implementação: capturar o valor de `selected_level` do item no momento em que o usuário dispara a avaliação com IA (snapshot pré-trigger). Ao receber a resposta da IA, comparar o valor atual com o snapshot. Se o valor mudou (usuário editou durante o processamento), exibir o card de sugestão normalmente mas não chamar `updateResponse` automaticamente. Se o usuário explicitamente clicar em "Aceitar", FR-001 se aplica integralmente e o radio button é atualizado.
- **FR-007**: O sistema DEVE permitir ao usuário aceitar ou rejeitar a sugestão da IA após ela ser exibida, com botões de ação claros (aceitar/rejeitar), seguindo o padrão da Extração.
- **FR-008**: O sistema DEVE gerenciar estados de loading independentemente por item, permitindo que múltiplas avaliações com IA ocorram em paralelo sem interferência mútua.

### Key Entities

- **Assessment Item**: Um item individual dentro de um instrumento de avaliação de qualidade (ex: um critério do ROBINS-I ou RoB 2). Possui opções de nível (levels) como "yes", "probably yes", "no information", "probably no", "no".
- **AI Suggestion (Assessment)**: A sugestão gerada pela IA para um item de assessment, contendo: nível sugerido, grau de confiança (0-100%), justificativa (reasoning), evidências, e metadados de uso (tokens).
- **Assessment Response**: A resposta do usuário para um item de assessment — o nível selecionado (manual ou via IA). Pode ser atualizada ao aceitar uma sugestão da IA.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após a IA concluir a avaliação de um item, o card de sugestão com nível sugerido e confiança aparece em menos de 1 segundo. Ao aceitar, o radio button é selecionado instantaneamente.
- **SC-002**: 100% das avaliações com IA bem-sucedidas exibem metadados de confiança (badge percentual) e permitem acesso à justificativa via popover.
- **SC-003**: A experiência visual de loading e feedback no Assessment é visualmente idêntica à da Extração — mesmos componentes de spinner, toast e badge de confiança.
- **SC-004**: O usuário consegue completar o fluxo "clicar Avaliar com IA → ver loading → ver card de sugestão → aceitar → radio button selecionado" de forma fluida, espelhando a experiência da Extração.

## Assumptions

- O backend já retorna corretamente os dados necessários (sugestão, confiança, tokens, justificativa) no payload de resposta da avaliação com IA. O problema é exclusivamente no frontend.
- Os componentes de UI para exibição de metadados da IA (badge de confiança, popover de detalhes, toast de tokens) já existem na Extração e podem ser reutilizados ou adaptados para o Assessment.
- O modelo de dados de `ai_suggestions` no banco já suporta sugestões para assessment (mesma tabela usada pela Extração).
- O fluxo de aceitação/rejeição de sugestões da IA (accept/reject) segue o mesmo padrão já implementado na Extração, usando o `AISuggestionService`.

## Scope Boundaries

### In Scope
- Correção do bug de sincronização de estado no frontend do Assessment
- Reutilização/adaptação dos componentes de metadados da IA da Extração
- Padronização do feedback visual (loading, toast, badges) entre Assessment e Extração

### Out of Scope
- Alterações no backend ou na lógica de IA
- Avaliação em lote ("avaliar todos os itens com IA" de uma vez) — isso é feature futura
- Mudanças no instrumento de avaliação ou nos níveis disponíveis
- Alterações na lógica de cálculo de confiança da IA
