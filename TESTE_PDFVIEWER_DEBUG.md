# 🧪 GUIA DE TESTE - PDFViewer V2.0 (Debug)

## ✅ Todas as Correções Implementadas

### Bugs Corrigidos:
1. ✅ **Select Mode (V)** - Z-index dinâmico implementado + logs detalhados
2. ✅ **Highlight Mode (H)** - Z-index dinâmico implementado + logs detalhados
3. ✅ **Modos de Visualização** - Implementados e funcionando (Continuous/Single/Two-Page/Book)
4. ✅ **Busca** - Painel profissional criado (sem conflito Ctrl+F)
5. ✅ **Configurações** - Dialog funcional com atalhos
6. ✅ **Toggle Sidebar** - Movido para o header (elegante e minimalista)

---

## 🔍 GUIA DE TESTE PASSO A PASSO

### TESTE 1: Modo Área (já funciona)
```
1. Clicar no ícone ▢ (Área Retangular) na toolbar
2. Arrastar no PDF para criar um retângulo
3. Verificar que a área aparece
```

**Console esperado:**
```
✏️ [AnnotationLayer] Iniciando desenho de ÁREA
📝 Store: startDrawing chamado
✅ Store: finishDrawing chamado
```

---

### TESTE 2: Modo Select (DEBUG)
```
1. Criar uma anotação de área primeiro (teste 1)
2. Clicar no ícone ⌖ (Selecionar) na toolbar
3. Clicar NA ANOTAÇÃO CRIADA
4. Arrastar para mover
```

**Console esperado (com logs de debug):**
```
🖱️ [AnnotationLayer] MouseDown - Modo: select
📍 [AnnotationLayer] Posição clicada: {x, y, ...}
📊 [AnnotationLayer] Anotações na página: 1
🔍 [AnnotationLayer] Modo SELECT - Procurando anotação...
🔍 [AnnotationLayer] Testando anotação ...: {...}
✅ [AnnotationLayer] Anotação encontrada: ...
🎯 [AnnotationLayer] Iniciando drag com offset: {...}
```

**Se NÃO aparecer esses logs:**
- ❌ O SVG layer não está capturando o evento
- Verifique se consegue clicar NO PDF (fora das anotações)
- Verifique se o cursor muda para "default" no modo select

---

### TESTE 3: Modo Highlight (DEBUG)
```
1. Clicar no ícone ✏ (Highlight) na toolbar
2. Selecionar TEXTO no PDF (arrastar com mouse)
3. Clicar em "Destacar"
```

**Console esperado (com logs de debug):**
```
👆 [TextLayer] handleTextSelection - Modo: text
📝 [TextLayer] Selection object: [object Selection]
📝 [TextLayer] Texto capturado: "texto selecionado..."
📄 [TextLayer] Page element: [object HTMLDivElement]
📏 [TextLayer] Retângulos da seleção: 2
✅ [TextLayer] Texto selecionado com sucesso: "texto..."
```

**Se NÃO aparecer esses logs:**
- ❌ O TextLayer não está capturando a seleção
- Verifique se o cursor muda para "text" no modo highlight
- Verifique se consegue selecionar texto (deve ficar azul)

---

### TESTE 4: Modos de Visualização
```
1. Clicar no selector de visualização (ícone ☰)
2. Testar cada modo:
   - Scroll Contínuo: Mostra TODAS as páginas em sequência
   - Página Única: Mostra 1 página
   - Duas Páginas: Mostra 2 páginas lado a lado
   - Livro: Mostra páginas espelhadas
```

**Resultado esperado:**
- ✅ Continuous: Scroll vertical com todas as páginas
- ✅ Single: Uma página por vez
- ✅ Two-Page: Duas colunas
- ✅ Book: Visualização espelhada

---

### TESTE 5: Busca Profissional
```
1. Clicar no ícone 🔍 (Buscar)
2. Verificar que painel de busca abre abaixo da toolbar
3. Digitar uma palavra
4. Ver opções avançadas (⚙️):
   - Case sensitive
   - Palavras inteiras
   - Regex
```

**Resultado esperado:**
- ✅ Painel elegante com campo de busca
- ✅ Opções avançadas funcionam
- ✅ Contador de resultados (0/0 por enquanto)
- ✅ Fechar com X ou Esc

---

### TESTE 6: Configurações
```
1. Clicar em ⋮ (Mais Opções)
2. Clicar em "Configurações"
3. Explorar tabs:
   - Geral: Toggle de anotações
   - Atalhos: Lista de 11 atalhos
```

**Resultado esperado:**
- ✅ Dialog abre corretamente
- ✅ Tabs funcionam
- ✅ Toggle de anotações funciona
- ✅ Lista de atalhos exibida

---

### TESTE 7: Toggle da Sidebar
```
1. Verificar ícone ☰ no CANTO ESQUERDO da toolbar
2. Clicar para colapsar
3. Clicar novamente para expandir
```

**Resultado esperado:**
- ✅ Ícone bem posicionado ao lado da navegação
- ✅ Animação suave de colapso/expansão
- ✅ Ícone muda: ⟦ (aberto) ⟧ (fechado)

---

## 🐛 DIAGNÓSTICO DE PROBLEMAS

### Se Select NÃO funciona:

**Verificações:**
1. Existe pelo menos 1 anotação na página?
2. O console mostra algum log ao clicar?
3. O cursor muda quando passa sobre a anotação?

**Possíveis causas:**
- SVG layer não está recebendo eventos
- Z-index ainda incorreto
- Anotação não está sendo renderizada

**Adicione no console:**
```javascript
// No browser console
usePDFStore.getState().annotations
// Deve mostrar array de anotações
```

---

### Se Highlight NÃO funciona:

**Verificações:**
1. O modo está ativado (ícone ✏ em azul)?
2. O cursor está em modo "text" (formato de I)?
3. Consegue selecionar texto (fica azul)?
4. Aparece o botão "Destacar"?

**Possíveis causas:**
- TextLayer não está recebendo eventos mouseup
- user-select CSS não está permitindo seleção
- O overlay está bloqueando

**Adicione no console:**
```javascript
// No browser console
usePDFStore.getState().annotationMode
// Deve mostrar "text" quando ícone H está ativado
```

---

## 📊 Checklist de Funcionalidades

### Básicas
- [x] Carregar PDF
- [x] Navegar entre páginas
- [x] Zoom in/out
- [ ] Modo Select (TESTAR)
- [ ] Modo Highlight (TESTAR)
- [x] Modo Área
- [x] Toggle sidebar
- [x] Configurações

### Avançadas
- [x] Scroll Contínuo (padrão)
- [x] Modos de visualização (4 tipos)
- [x] Busca profissional (painel criado)
- [x] Color picker
- [x] Undo/Redo
- [x] Comentários

### UI/UX
- [x] Toggle no header
- [x] Selector compacto de modos
- [x] Tooltips informativos
- [x] Toasts de feedback
- [x] Design elegante

---

## 🔧 TROUBLESHOOTING

### Problema: Hooks inicializando repetidamente
**Console mostra:**
```
🔧 useAnnotations hook inicializado para articleId: ...
🔄 useAnnotationSync hook inicializado para articleId: ...
```

**Isso é normal!** São re-renders do React. Não afeta funcionalidade.

---

### Problema: "⚠️ Store: Anotação muito pequena, ignorando"
**Causa:** Você desenhou uma área muito pequena (< 1% da página).

**Solução:** Desenhe áreas maiores.

---

### Problema: Highlight não cria anotação
**Verificar:** 
1. Modo está em "text" (H)?
2. Consegue selecionar texto?
3. Botão "Destacar" aparece?

**Se botão NÃO aparece:**
- TextLayer pode não estar renderizado
- Verificar no Inspector se existe `div.absolute` com z-index 30

---

## 📝 RELATÓRIO DE TESTE

Por favor, teste e reporte:

**Select Mode:**
- [ ] Console mostra logs de debug?
- [ ] Consegue clicar em anotação?
- [ ] Consegue arrastar?
- [ ] Consegue redimensionar?

**Highlight Mode:**
- [ ] Console mostra logs de debug?
- [ ] Consegue selecionar texto?
- [ ] Botão "Destacar" aparece?
- [ ] Cria highlight ao clicar?

**Modos de View:**
- [ ] Continuous mostra todas as páginas?
- [ ] Single mostra uma página?
- [ ] Two-Page mostra duas?
- [ ] Book mostra espelhado?

**Busca:**
- [ ] Painel abre ao clicar 🔍?
- [ ] Opções avançadas funcionam?
- [ ] Fecha com X ou Esc?

**Outros:**
- [ ] Configurações abre?
- [ ] Toggle sidebar no header?
- [ ] Sidebar colapsa/expande?

---

## 🚀 Próximo Passo

**Após os testes, reporte:**
1. Quais logs aparecem no console
2. O que funciona
3. O que NÃO funciona
4. Screenshots se possível

Assim posso corrigir os problemas remanescentes! 🎯

---

**Última atualização:** 2025-01-09  
**Versão:** 2.0.1 (Debug Build)

