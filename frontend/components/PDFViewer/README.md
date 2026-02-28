# PDFViewer - Visualizador de PDF Profissional

**Versão 2.0 - Refatoração Completa**

Sistema modular e robusto de visualização de PDFs com anotações, inspirado no Mozilla PDF.js Viewer.

---

## 📋 Arquitetura

### Estrutura de Diretórios

```
PDFViewer/
├── core/                    # Núcleo do visualizador
│   ├── PDFViewerCore.tsx   # Container principal
│   ├── PDFCanvas.tsx        # Renderização das páginas
│   ├── PDFTextLayer.tsx     # Camada de texto selecionável
│   └── PDFAnnotationLayer.tsx  # Camada de anotações
│
├── toolbar/                 # Barra de ferramentas modular
│   ├── MainToolbar.tsx      # Container da toolbar
│   ├── NavigationTools.tsx  # Navegação de páginas
│   ├── ZoomTools.tsx        # Controles de zoom
│   ├── ViewModeTools.tsx    # Modos de visualização
│   ├── AnnotationTools.tsx  # Ferramentas de anotação
│   ├── SearchTool.tsx       # Busca no documento
│   └── MoreTools.tsx        # Menu adicional
│
├── sidebar/                 # Sidebar unificada
│   ├── SidebarContainer.tsx # Container com tabs
│   ├── ThumbnailsPanel.tsx  # Miniaturas das páginas
│   ├── OutlinePanel.tsx     # Sumário do PDF
│   ├── AttachmentsPanel.tsx # Anexos
│   ├── AnnotationsPanel.tsx # Lista de anotações
│   └── BookmarksPanel.tsx   # Marcadores
│
├── utils/                   # Utilitários
│   ├── performanceOptimizations.ts  # Otimizações
│   └── keyboardShortcuts.ts  # Gerenciador de atalhos
│
├── index.tsx               # Componente principal (export)
├── PDFToolbar.tsx          # Wrapper (compatibilidade)
├── Sidebar.tsx             # Wrapper (compatibilidade)
└── README.md              # Esta documentação
```

---

## 🎯 Componentes Principais

### PDFViewerCore

Container principal que orquestra:
- Carregamento do PDF
- Gerenciamento de estado
- Coordenação de camadas
- Atalhos de teclado globais

**Uso:**
```tsx
import { PDFViewer } from '@/components/PDFViewer';

<PDFViewer articleId="uuid-do-artigo" projectId="uuid-do-projeto" />
```

### PDFCanvas

Renderiza as páginas do PDF com react-pdf e coordena as camadas de texto e anotações.

**Responsabilidades:**
- Renderização do canvas PDF
- Cálculo de dimensões
- Coordenação de overlays
- Suporte a rotação e zoom

### PDFTextLayer

Camada interativa para seleção de texto e criação de highlights.

**Features:**
- Captura de seleção de texto
- Botões de ação (Destacar, Comentar)
- Conversão de coordenadas
- Integração com sistema de anotações

### PDFAnnotationLayer

Camada SVG para renderizar e manipular anotações.

**Features:**
- Renderização de highlights e áreas
- Drag & drop de anotações
- Resize com handles
- Comentários threaded
- Undo/Redo

---

## 🔧 Toolbar Modular

### MainToolbar

Container que organiza todas as ferramentas em grupos lógicos.

**Grupos:**
1. **Navegação** - Prev/Next/Page Input
2. **Zoom** - In/Out/Presets
3. **Modos** - Single/Two-Page/Book/Presentation
4. **Anotações** - Select/Highlight/Area/Note
5. **Busca** - Find in document
6. **Mais** - Download/Print/Export/Settings

### NavigationTools

Navegação entre páginas com input validado.

**Features:**
- Input de página com validação
- Botões Previous/Next
- Exibição do total
- Atalhos (PageUp/PageDown)

### ZoomTools

Controles de zoom com presets.

**Presets:**
- Fit Width
- Fit Page
- Actual Size
- 50%, 75%, 100%, 125%, 150%, 200%

**Atalhos:**
- Ctrl +: Zoom In
- Ctrl -: Zoom Out
- Ctrl 0: Reset

### ViewModeTools

Alternância entre modos de visualização.

**Modos:**
- Single Page (uma página)
- Two Pages (duas páginas lado a lado)
- Book View (visualização de livro)
- Presentation (tela cheia)

### AnnotationTools

Ferramentas de anotação com color picker.

**Ferramentas:**
- Select (V) - Selecionar e mover
- Highlight (H) - Destacar texto
- Area (R) - Desenhar área retangular
- Note (N) - Nota adesiva (futuro)

**Features:**
- Color Picker integrado
- Undo/Redo
- Contador de anotações
- Toggle de visibilidade

---

## 📂 Sidebar Unificada

### SidebarContainer

Container com tabs para navegação entre painéis.

**Tabs:**
1. Miniaturas (thumbnails)
2. Sumário (outline)
3. Anexos (attachments)
4. Anotações (annotations)
5. Marcadores (bookmarks)

### ThumbnailsPanel

Miniaturas das páginas com indicadores visuais.

**Features:**
- Navegação rápida
- Indicador de página atual
- Contador de anotações por página
- Scroll automático
- Lazy loading (futuro)

### AnnotationsPanel

Lista filtrada e ordenada de anotações.

**Features:**
- Busca em anotações
- Filtros por tipo (all/highlight/area/note)
- Ordenação (página/data/tipo)
- Navegação para anotação
- Ações rápidas (editar/deletar)

---

## ⚡ Performance

### Otimizações Implementadas

1. **Memoização**
   - React.memo em componentes pesados
   - useMemo/useCallback estratégicos

2. **Debounce/Throttle**
   - Sincronização de anotações (1s debounce)
   - Eventos de mouse (RAF throttle)

3. **Lazy Loading**
   - Thumbnails sob demanda
   - Componentes code-split (futuro)

4. **Memory Management**
   - Cleanup de event listeners
   - Unload de páginas distantes (futuro)

### Utils de Performance

```typescript
import { debounce, throttle } from './utils/performanceOptimizations';

// Debounce - espera parar de chamar
const debouncedSave = debounce(saveAnnotation, 1000);

// Throttle - limita frequência
const throttledUpdate = throttle(updatePosition, 16); // ~60fps
```

---

## ⌨️ Atalhos de Teclado

### Navegação
- `PageDown` - Próxima página
- `PageUp` - Página anterior
- `Home` - Primeira página
- `End` - Última página

### Zoom
- `Ctrl/Cmd +` - Aumentar zoom
- `Ctrl/Cmd -` - Reduzir zoom
- `Ctrl/Cmd 0` - Resetar zoom

### Ferramentas
- `V` - Selecionar
- `H` - Highlight
- `R` - Área retangular
- `Ctrl/Cmd F` - Buscar

### Edição
- `Ctrl/Cmd Z` - Desfazer
- `Ctrl/Cmd Shift Z` - Refazer
- `Delete` - Deletar selecionado
- `Escape` - Cancelar ação

### Visualização
- `Ctrl/Cmd B` - Toggle sidebar
- `F11` - Modo apresentação
- `Ctrl/Cmd P` - Imprimir

---

## 🎨 Sistema de Anotações

### Tipos Suportados

1. **Highlight** - Destaque de texto
2. **Area** - Área retangular
3. **Note** - Nota adesiva (futuro)
4. **Ink** - Desenho livre (futuro)

### Workflow de Anotação

```typescript
// 1. Selecionar ferramenta
setAnnotationMode('highlight');

// 2. Interagir no PDF
// - Highlight: selecionar texto
// - Area: arrastar retângulo

// 3. Anotação criada automaticamente
// 4. Sincronização com Supabase (1s debounce)
```

### Persistência

As anotações são salvas automaticamente em:
- `article_highlights` - Para highlights de texto
- `article_boxes` - Para áreas retangulares
- `article_annotations` - Para comentários

**Sync automático:**
- Debounce de 1 segundo
- Upsert on conflict
- RLS policies aplicadas

---

## 🔄 Estado Global (Zustand)

### Structure

```typescript
interface PDFState {
  // Document
  url: string | null;
  articleId: string | null;
  numPages: number;
  
  // View
  currentPage: number;
  scale: number;
  rotation: number;
  
  // Annotations
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  isDrawing/isDragging/isResizing: boolean;
  
  // UI
  showAnnotations: boolean;
  annotationMode: 'select' | 'area' | 'text' | 'note';
  ui: {
    viewMode: 'single' | 'two-page' | 'book' | 'presentation';
    presentationMode: boolean;
  };
  
  // Style
  currentColor: string;
  currentOpacity: number;
  
  // History
  history: Annotation[][];
  historyIndex: number;
}
```

### Actions

**Document:**
- `setUrl()`, `setNumPages()`, `setArticleId()`

**Navigation:**
- `nextPage()`, `prevPage()`, `goToPage()`

**Zoom:**
- `zoomIn()`, `zoomOut()`, `setScale()`, `resetZoom()`

**Annotations:**
- `addAnnotation()`, `updateAnnotation()`, `deleteAnnotation()`
- `selectAnnotation()`, `clearAnnotations()`, `setAnnotations()`

**Drawing:**
- `startDrawing()`, `updateDrawing()`, `finishDrawing()`, `cancelDrawing()`

**Dragging:**
- `startDragging()`, `updateDragging()`, `finishDragging()`, `cancelDragging()`

**Resizing:**
- `startResizing()`, `updateResizing()`, `finishResizing()`, `cancelResizing()`

**History:**
- `undo()`, `redo()`, `canUndo()`, `canRedo()`

**UI:**
- `toggleAnnotations()`, `setAnnotationMode()`, `toggleSidebar()`
- `setViewMode()`, `setPresentationMode()`

---

## 🧪 Testes

### Checklist de Funcionalidades

- [x] Carregar PDF do Supabase Storage
- [x] Navegação entre páginas
- [x] Zoom in/out e presets
- [x] Criar highlight de texto
- [x] Criar área retangular
- [x] Mover anotações (drag)
- [x] Redimensionar anotações (resize)
- [x] Deletar anotações
- [x] Undo/Redo
- [x] Comentários em anotações
- [x] Sidebar com thumbnails
- [x] Sidebar com lista de anotações
- [x] Filtros na lista de anotações
- [x] Sincronização automática com banco
- [x] Atalhos de teclado básicos
- [ ] Busca no documento (futuro)
- [ ] Modo apresentação (futuro)
- [ ] Impressão (futuro)
- [ ] Exportação de anotações (futuro)

### Como Testar

1. **Carregar PDF:**
   ```bash
   # Navegar para um artigo com PDF
   # O viewer deve carregar automaticamente
   ```

2. **Criar Anotações:**
   - Clicar no ícone de Highlight (H)
   - Selecionar texto no PDF
   - Clicar em "Destacar"
   - Verificar que apareceu na sidebar

3. **Manipular Anotações:**
   - Clicar no ícone de Select (V)
   - Clicar em uma anotação
   - Arrastar para mover
   - Usar handles para redimensionar

4. **Testar Persistência:**
   - Criar algumas anotações
   - Recarregar a página
   - Verificar que as anotações foram mantidas

---

## 🚀 Próximas Melhorias

### Curto Prazo

1. **Thumbnails Reais**
   - Renderizar canvas reais das páginas
   - Cache de thumbnails

2. **Busca no Documento**
   - Find panel completo
   - Highlight de resultados
   - Navegação entre resultados

3. **Notas Adesivas**
   - Implementar tipo 'note'
   - Ícones customizáveis
   - Posicionamento livre

### Médio Prazo

4. **Modo Apresentação**
   - Fullscreen com controles
   - Cursor laser
   - Timer de apresentação

5. **Impressão**
   - Print preview
   - Opções de configuração
   - Incluir/excluir anotações

6. **Exportação**
   - JSON (backup)
   - XFDF (padrão)
   - PDF com anotações (pdf-lib)

### Longo Prazo

7. **Ink Tool**
   - Desenho livre
   - Caneta/marca-texto
   - Smooth drawing

8. **Virtualização**
   - React-window para PDFs grandes
   - Lazy loading inteligente
   - Memory management

9. **Colaboração**
   - Anotações em tempo real
   - Cursores de usuários
   - Comentários colaborativos

---

## 📚 Referências

- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [Mozilla PDF.js Viewer](https://mozilla.github.io/pdf.js/web/viewer.html)
- [react-pdf](https://github.com/wojtekmaj/react-pdf)
- [Zustand](https://github.com/pmndrs/zustand)
- [Supabase](https://supabase.com/docs)

---

## 👥 Contribuindo

Para contribuir com melhorias:

1. Mantenha a estrutura modular
2. Siga os padrões de código existentes
3. Adicione tipos TypeScript
4. Documente funções complexas
5. Teste antes de commit

---

## 📝 Changelog

### v2.0.0 (2025-01-09)
- ✨ Refatoração completa da arquitetura
- ✨ Toolbar modular com múltiplas ferramentas
- ✨ Sidebar unificada com 5 painéis
- ✨ Sistema de anotações robusto
- ✨ Undo/Redo funcional
- ✨ Otimizações de performance
- ✨ Gerenciador de atalhos
- 📚 Documentação completa

### v1.0.0 (2024-10-02)
- 🎉 Primeira versão funcional
- ✨ Highlights e boxes básicos
- ✨ Comentários em anotações
- ✨ Sincronização com Supabase

---

**Desenvolvido com ❤️ para o Review Hub**

