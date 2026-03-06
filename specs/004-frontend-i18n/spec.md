# Feature Specification: Aplicação em Inglês e Código Limpo (Frontend i18n)

**Feature Branch**: `004-frontend-i18n`  
**Created**: 2026-03-04  
**Status**: Draft  
**Input**: User description: "mapeie todos os arquivos de front end para fazer uma tradução do sistema para ingles" — *
*revisto**: entrega = app só em inglês e código limpo.

## Overview

O sistema hoje exibe textos em português na interface. A **entrega** desta feature é: (1) **aplicação frontend exibida
somente em inglês** para o usuário, e (2) **código limpo** — sem strings de UI hardcoded em português, com textos de
interface externalizados e estrutura mantível.

**Escopo**: Apenas frontend. O entregável não é apenas um mapa de tradução, e sim o **app funcionando em inglês** e o *
*código-base preparado** (strings centralizadas, sem mistura de idiomas no código, sem cópia duplicada de texto na UI).

**Resultado final (Definition of Done desta feature)**:

- **Tradução inteira**: Todo o texto de UI hoje em português é traduzido para inglês; todas as áreas (páginas, extração,
  avaliação, artigos, projeto, usuário, navegação, layout, padrões, ui, shared, contextos) são cobertas.
- **Apenas inglês mantido**: Ao final não permanece português na interface nem no repositório de copy; o repositório
  `frontend/lib/copy/` contém somente textos em inglês; não há arquivo ou camada de tradução em português. O código é
  refatorado para consumir apenas esse módulo — literais em português são removidos e substituídos por chaves/copy em
  inglês.

## Clarifications

### Session 2026-03-04

- Q: Formato e manutenção do mapa (documento estático mantido à mão, ou gerado por script)? → A: Entrega = mapa com
  todas as páginas concluídas; documento estático (ex.: Markdown) mantido manualmente. *(Nota: escopo posteriormente
  alterado para entrega = app em inglês + código limpo.)*
- Q: Como identificar origens de texto fora do frontend (API/backend) no mapa? → A: Seção "Origens externas" no mapa com
  as fontes conhecidas e descrição breve; descoberta manual.
- Q: Componentes em components/ui sem texto fixo — incluir no mapa? → A: Incluir apenas os que tiverem texto fixo no
  próprio arquivo (placeholder, aria-label, etc.); os demais ficam de fora.
- Q: Quem atualiza o mapa quando surgir nova página/componente e com que critério? → A: Definir apenas o critério de
  inclusão (nova rota/componente com texto → entrada no mapa); responsável e quando atualizar ficam para processo ou
  planejamento.
- Q: Strings de acessibilidade (aria-label, title) devem ser tratadas de forma explícita no mapa? → A: Sim: incluir "
  acessibilidade (aria-label, title)" como tipo de string no mapa quando aplicável.
- **Revisão de escopo**: Entrega passou a ser o app somente em inglês e o código limpo (strings externalizadas, sem
  português hardcoded na UI). Na entrega atual, mensagens de erro da API são mapeadas no frontend para inglês; documento
  de "Origens externas" é opcional.

## Assumptions

- O idioma atual da interface é português; o idioma de entrega é **inglês** como único idioma exibido ao usuário (não
  multi-idioma na primeira entrega). Ao final desta feature **apenas inglês é mantido** — não há preservação de versão
  em português na UI nem no repositório de copy.
- "Código limpo" significa: nenhuma string de UI em português (ou outro idioma) hardcoded nos componentes; textos de
  interface vêm de um único mecanismo (ex.: chaves de tradução ou módulo de copy) em inglês; sem duplicação
  desnecessária de strings; estrutura que permita manutenção e futura i18n se necessário.
- Textos dinâmicos (nomes de projetos, usuários, dados do banco) não são traduzidos; apenas textos fixos da interface (
  labels, botões, mensagens, placeholders, acessibilidade).
- Origens de texto fora do frontend (API, auth) podem ser documentadas para escopo futuro; a entrega pode considerar
  apenas o que o frontend controla, salvo decisão explícita de incluir tratamento de mensagens de erro da API em inglês.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aplicação exibida inteiramente em inglês (Priority: P1)

Como usuário final, ao usar a aplicação em qualquer fluxo (login, dashboard, projeto, extração, avaliação,
configurações), vejo todos os textos da interface em inglês: títulos, botões, labels, placeholders, mensagens de erro e
de sucesso, e textos de acessibilidade.

**Why this priority**: É o resultado visível da tradução; sem isso a feature não está entregue.

**Independent Test**: Navegar por todas as páginas e fluxos principais; inspecionar elementos com texto; confirmar
ausência de português na UI.

**Acceptance Scenarios**:

1. **Given** a aplicação em execução, **When** o usuário navega por páginas (Dashboard, ProjectView, Auth, UserSettings,
   AddArticle, EditArticle, ExtractionFullScreen, AssessmentFullScreen, etc.), **Then** todo texto fixo exibido está em
   inglês.
2. **Given** formulários, botões, tabelas e mensagens (sucesso/erro), **When** o usuário interage com a interface, *
   *Then** labels, placeholders, tooltips e aria-labels estão em inglês.
3. **Given** a página 404 ou estados vazios/erro, **When** o usuário os encontra, **Then** as mensagens exibidas estão
   em inglês.

---

### User Story 2 - Código sem strings de UI hardcoded (Priority: P1)

Como desenvolvedor, ao abrir o código frontend, não encontro strings de interface (labels, mensagens, placeholders)
escritas diretamente nos componentes; todas vêm de um mecanismo centralizado (chaves/copy em inglês), facilitando
manutenção e consistência.

**Why this priority**: Código limpo é condição para a entrega; evita regressão e mistura de idiomas.

**Independent Test**: Busca por strings em português em arquivos TSX/TS de UI; verificação de que não há texto literal
de UI fora do mecanismo de tradução/copy.

**Acceptance Scenarios**:

1. **Given** os arquivos de páginas e componentes (ex.: extraction, assessment, articles, project, user, navigation,
   layout, patterns), **When** se busca por strings típicas de UI em português no código, **Then** não há ocorrências de
   texto de interface hardcoded; textos vêm de chaves ou módulo de copy.
2. **Given** componentes que exibem mensagens de erro ou sucesso, **When** o código é inspecionado, **Then** as
   mensagens são referenciadas por chave ou constante em inglês, não literais em português no JSX/TS.
3. **Given** placeholders, aria-labels e títulos de página, **When** o código é revisado, **Then** estão
   externalizados (ex.: arquivo de traduções ou constantes) em inglês.

---

### User Story 3 - Estrutura mantível e sem duplicação (Priority: P2)

Como desenvolvedor, o código de textos da UI está organizado de forma que (1) haja um único lugar (ou conjunto de
arquivos) onde o copy em inglês é definido, e (2) não exista duplicação desnecessária da mesma string em vários
arquivos.

**Why this priority**: Garante que "código limpo" seja sustentável após a entrega.

**Independent Test**: Verificar que não há duplicação de strings idênticas em múltiplos componentes e que novo texto de
UI é adicionado no lugar centralizado.

**Acceptance Scenarios**:

1. **Given** o mecanismo escolhido para textos (ex.: objeto de chaves, módulo de copy, ou lib de i18n), **When** um
   revisor verifica a base de código, **Then** não há duas definições distintas para o mesmo texto visível ao usuário em
   locais diferentes.
2. **Given** um novo label ou mensagem a exibir, **When** o desenvolvedor segue o padrão do projeto, **Then** ele
   adiciona o texto no repositório centralizado (em inglês) e usa a referência no componente.

---

### Edge Cases

- **Strings vindas do backend**: Mensagens de erro ou texto da API exibidos na UI podem ser tratados nesta feature (ex.:
  mapeamento de códigos de erro para mensagens em inglês no frontend) ou documentados como "Origens externas" para fase
  posterior. Nesta feature adota-se o mapeamento no frontend (ver plan/research); documentar "Origens externas" para
  tradução futura fica opcional.
- **Textos dinâmicos**: Nomes de projetos, usuários e dados vindos do banco não são traduzidos; apenas textos fixos da
  interface.
- **Conteúdo já em inglês**: Arquivos que já tinham texto em inglês devem passar a usar o mesmo mecanismo centralizado (
  código limpo), sem manter literais espalhados.
- **Acessibilidade**: aria-label, title e equivalentes devem estar em inglês e externalizados como os demais textos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A aplicação frontend MUST exibir toda a interface (títulos, botões, labels, placeholders, mensagens,
  tooltips, textos de acessibilidade) em **inglês** para o usuário.
- **FR-002**: O código frontend MUST estar livre de strings de UI hardcoded em português (ou outro idioma) nos
  componentes; textos de interface MUST vir de um mecanismo centralizado em inglês.
- **FR-003**: MUST existir um único repositório (ou conjunto de arquivos) para os textos de UI em inglês, usado de forma
  consistente em páginas e componentes; sem duplicação desnecessária da mesma string.
- **FR-004**: Todas as páginas (rotas) e todas as áreas de funcionalidade listadas na Referência de áreas (extraction,
  assessment, articles, project, user, navigation, layout, patterns, ui com texto fixo, shared, contextos) MUST estar
  cobertas — checklist de cobertura: em cada área o usuário vê apenas inglês e o código não contém UI em português.
- **FR-005**: Textos de acessibilidade (aria-label, title em ícones/botões) MUST estar em inglês e externalizados como
  os demais textos de interface.
- **FR-006**: Mensagens de erro ou sucesso exibidas na UI MUST estar em inglês; se vierem do backend, o frontend MUST
  exibir versão em inglês (mapeamento ou fallback), ou documentar escopo futuro para "Origens externas".

### Key Entities

- **Repositório de textos (copy/translations)**: Conjunto de chaves ou entradas que definem os textos da UI em inglês;
  consumido pelos componentes.
- **Componente frontend**: Não contém literais de UI em português; usa referência ao repositório de textos para todo
  texto visível (incluindo acessibilidade).
- **Origens externas** (opcional nesta entrega): Fontes de texto fora do frontend (API, auth) documentadas para tradução
  futura, se não tratadas nesta feature. *Terminologia: contextos (spec) = contexts (código).*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das páginas (rotas) exibem texto de interface em inglês; nenhuma string em português visível ao
  usuário nas telas cobertas.
- **SC-002**: Zero ocorrências de strings de UI em português hardcoded em arquivos TSX/TS de componentes e páginas (
  verificável por busca/revisão).
- **SC-003**: Todo texto fixo de UI (labels, botões, placeholders, mensagens, acessibilidade) é obtido do repositório
  centralizado em inglês; não há duplicação da mesma string em múltiplos arquivos de componente.
- **SC-004**: Um revisor consegue, em até 2 horas, percorrer uma amostra de 20% das telas e confirmar que estão em
  inglês e que o código correspondente não contém literais de UI em português. (Verificação pode ser ad hoc ou via
  runbook em quickstart.)
- **SC-005**: A aplicação está utilizável de ponta a ponta em inglês (fluxos principais: auth, dashboard, projeto,
  artigos, extração, avaliação, configurações de projeto e usuário).

## Referência de áreas a cobrir (frontend)

Para garantir cobertura completa (app em inglês + código limpo), as seguintes áreas devem estar tratadas:

| Área      | Caminho típico                      | O que garantir                                                                 |
|-----------|-------------------------------------|--------------------------------------------------------------------------------|
| Páginas   | `frontend/pages/*.tsx`              | Todo texto em inglês; sem literais de UI em português                          |
| Extração  | `frontend/components/extraction/**` | Labels, cabeçalhos, formulários, diálogos, AI em inglês                        |
| Avaliação | `frontend/components/assessment/**` | Tabelas, cabeçalhos, configuração, AI em inglês                                |
| Artigos   | `frontend/components/articles/**`   | Formulários, listas, importação (RIS, Zotero) em inglês                        |
| Projeto   | `frontend/components/project/**`    | Configurações, PICOTS, membros, revisão em inglês                              |
| Usuário   | `frontend/components/user/**`       | Perfil, segurança, integrações, API keys em inglês                             |
| Navegação | `frontend/components/navigation/**` | Topbar, busca, notificações, menu de perfil em inglês                          |
| Layout    | `frontend/components/layout/**`     | Sidebar, mobile sidebar, app layout em inglês                                  |
| Padrões   | `frontend/components/patterns/**`   | PageHeader, ErrorState, EmptyState, DetailSheet em inglês                      |
| UI        | `frontend/components/ui/**`         | Componentes com texto fixo: placeholder, aria-label em inglês e externalizados |
| Shared    | `frontend/components/shared/**`     | Comparação, AI suggestions em inglês                                           |
| Contextos | `frontend/contexts/*.tsx`           | Mensagens de erro ou texto de UI em inglês e externalizados                    |

O plano de implementação deve detalhar como externalizar os textos e preencher o repositório em inglês para cada área, e
como garantir que o código fique limpo (sem literais de UI em português).
