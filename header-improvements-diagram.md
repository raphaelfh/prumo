# Melhorias do Header de Extração - Diagrama

## Layout Anterior vs Novo

### ANTES (Layout Original)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [← Voltar] | [Breadcrumb: Projeto > Artigo] | [Progresso: 0% (0/30)] | [Salvo 14:23] | [Finalizar] │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Ocultar PDF] | [CHARMS (Importado)] | [Extração/Comparação] | [Finalizar Extração] │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### DEPOIS (Layout Melhorado)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [← Voltar] | [Breadcrumb: Projeto > Artigo] | [Ocultar PDF] [←] [→] | [Progresso: 0% (0/30)] [Salvo 14:23] | [Finalizar] │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Seções do Header Reorganizado

### 1. Navegação (Esquerda)
- **Botão Voltar**: Navegação para o projeto
- **Breadcrumb**: Projeto > Artigo (clicável)

### 2. Seção de Edição (Centro-Esquerda)
- **Ocultar PDF**: Toggle para mostrar/ocultar PDF
- **Navegação entre Artigos**: 
  - Setas ← → para navegar entre artigos
  - Botões desabilitados quando não há artigo anterior/próximo
  - Navegação fluida sem perder o contexto

### 3. Seção de Status (Centro-Direita)
- **Progresso**: Badge minimalista com percentual e contador
- **Auto-save**: Status de salvamento com horário HH:mm

### 4. Ação Principal (Direita)
- **Finalizar**: Botão de ação principal, mais elegante

## Funcionalidades Implementadas

### ✅ Navegação entre Artigos
- **Setas de navegação**: ← → ao lado do botão "Ocultar PDF"
- **Lógica inteligente**: Botões desabilitados quando não há artigos adjacentes
- **Navegação fluida**: Mantém o contexto de extração ao navegar

### ✅ Layout Reorganizado
- **Seção de Edição**: PDF toggle + navegação entre artigos
- **Seção de Status**: Progresso + auto-save agrupados
- **Mais minimalista**: Remoção do badge "CHARMS (Importado)"

### ✅ Melhorias de UX
- **Navegação intuitiva**: Setas familiares para anterior/próximo
- **Agrupamento lógico**: Funcionalidades relacionadas agrupadas
- **Menos ruído visual**: Layout mais limpo e organizado

## Benefícios Alcançados

1. **Navegação mais eficiente**: Usuário pode navegar entre artigos sem voltar à lista
2. **Layout mais organizado**: Seções lógicas e funcionais bem definidas
3. **Menos cliques**: Acesso direto ao próximo/anterior artigo
4. **Contexto preservado**: Mantém o estado de extração ao navegar
5. **Design mais limpo**: Remoção de elementos desnecessários

## Implementação Técnica

### Props Adicionadas ao ExtractionHeader
```typescript
// Navegação entre artigos
articles: Article[];
currentArticleId: string;
onNavigateToArticle: (articleId: string) => void;
```

### Lógica de Navegação
- Busca automática da lista de artigos do projeto
- Cálculo da posição atual e artigos adjacentes
- Navegação via React Router mantendo o contexto

### Estados dos Botões
- **Anterior**: Desabilitado quando `currentIndex === 0`
- **Próximo**: Desabilitado quando `currentIndex === articles.length - 1`
