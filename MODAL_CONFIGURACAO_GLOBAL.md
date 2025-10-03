# 🎛️ Modal de Configuração Global de IA

## ✅ **Novo Modal Implementado**

### **AIGlobalConfigModal** - Configurações Avançadas
**Localização**: Abre ao clicar no botão "Config" na `BatchAssessmentBar`
**Arquivo**: `src/components/assessment/AIGlobalConfigModal.tsx`

## 🎯 **Funcionalidades do Modal**

### **3 Abas Principais:**

#### **1. Aba "Processamento"** ⚡
- **Modo Paralelo**: Ativar/desativar processamento simultâneo
- **Concorrência**: Controlar número de requisições simultâneas (1-5)
- **Delay entre Lotes**: Configurar tempo de espera (500ms-2s)
- **Estimativa de Performance**: Visualizar ganho de velocidade

#### **2. Aba "Configurações IA"** 🧠
- **Modelo**: GPT-4o Mini (otimizado)
- **Temperatura**: 0.0 (máxima consistência)
- **Tokens Máximos**: 500-4000 (custo vs. detalhamento)
- **Busca Vetorial**: Forçar RAG para maior precisão
- **Prompts Globais**: Sistema e template de usuário

#### **3. Aba "Prompts por Questão"** 📝
- **Seletor de Questão**: Lista todas as questões do instrumento
- **Configuração Individual**: Prompts específicos por questão
- **Salvamento Individual**: Persistir configurações por questão
- **Fallback Global**: Usar prompts globais como padrão

## 🎨 **Interface Visual**

### **Modal Principal**
```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️ Configurações Globais de IA                             │
│                                                             │
│ [⚡ Processamento] [🧠 Configurações IA] [📝 Prompts]     │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Conteúdo da aba selecionada                            │ │
│ │                                                         │ │
│ │ • Configurações específicas da aba                     │ │
│ │ • Controles interativos                                │ │
│ │ • Informações contextuais                              │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [💾 Salvar Configurações] [🔄 Resetar]                    │
└─────────────────────────────────────────────────────────────┘
```

### **Aba Processamento**
```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ Processamento Paralelo                    [ON/OFF]       │
│                                                             │
│ 🕐 Concorrência: 3 requisições simultâneas                 │
│ [1]────●────[5]                                            │
│                                                             │
│ ⏱️ Delay entre Lotes: 1000ms                               │
│ [500ms]────●────[2000ms]                                   │
│                                                             │
│ 📊 Estimativa de Performance                               │
│ • Modo: Paralelo                                           │
│ • Performance: ~3x mais rápido                             │
│ • Questões pendentes: 15                                   │
└─────────────────────────────────────────────────────────────┘
```

### **Aba Configurações IA**
```
┌─────────────────────────────────────────────────────────────┐
│ 🧠 Modelo de IA: GPT-4o Mini [Otimizado]                   │
│                                                             │
│ 🌡️ Temperatura: 0.0 [Máxima Consistência]                 │
│                                                             │
│ ⚡ Tokens Máximos: 2,000 (~$0.0003)                       │
│ [500]────●────[4000]                                       │
│                                                             │
│ 🔍 Forçar Busca Vetorial (RAG)              [ON/OFF]       │
│                                                             │
│ 📝 Prompts Globais                                         │
│ • Prompt do Sistema: [textarea]                            │
│ • Template do Usuário: [textarea]                          │
└─────────────────────────────────────────────────────────────┘
```

### **Aba Prompts por Questão**
```
┌─────────────────────────────────────────────────────────────┐
│ 📝 Selecionar Questão para Configurar                      │
│                                                             │
│ [Q1.1] Questão sobre participantes...                      │
│ [Q1.2] Questão sobre métodos...                            │
│ [Q2.1] Questão sobre resultados...                         │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ Configuração da Questão: Q1.1              [💾 Salvar]     │
│                                                             │
│ 📝 Prompt do Sistema: [textarea]                           │
│ 📝 Template do Usuário: [textarea]                         │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 **Como Usar**

### **Acessar o Modal**
1. Vá para a página de avaliação
2. Localize a barra "Avaliação Inteligente"
3. Clique no botão "⚙️ Config"
4. O modal abrirá com 3 abas

### **Configurar Processamento**
1. Aba "⚡ Processamento"
2. Ative/desative o modo paralelo
3. Ajuste concorrência (1-5)
4. Configure delay entre lotes
5. Veja estimativa de performance

### **Configurar IA**
1. Aba "🧠 Configurações IA"
2. Ajuste tokens máximos
3. Ative/desative busca vetorial
4. Edite prompts globais
5. Use variáveis disponíveis

### **Configurar Prompts por Questão**
1. Aba "📝 Prompts por Questão"
2. Selecione uma questão
3. Edite prompts específicos
4. Clique "Salvar Questão"
5. Repita para outras questões

### **Salvar Configurações**
1. Clique "💾 Salvar Configurações"
2. Configurações são salvas no localStorage
3. Modal fecha automaticamente
4. Configurações aplicadas imediatamente

## 🔧 **Configurações Disponíveis**

### **Processamento**
- **Modo Paralelo**: true/false
- **Concorrência**: 1-5 requisições simultâneas
- **Delay entre Lotes**: 500ms-2000ms

### **IA**
- **Modelo**: GPT-4o Mini (fixo)
- **Temperatura**: 0.0 (fixo)
- **Tokens Máximos**: 500-4000
- **Busca Vetorial**: true/false

### **Prompts**
- **Sistema**: Prompt global ou por questão
- **Usuário**: Template global ou por questão
- **Variáveis**: {{question}}, {{levels}}, {{review_title}}, etc.

## 💾 **Persistência**

### **Configurações Globais**
- Salvas no `localStorage` como `ai-global-config`
- Aplicadas a todas as avaliações
- Persistem entre sessões

### **Configurações por Questão**
- Salvas na tabela `ai_assessment_prompts`
- Específicas por `assessment_item_id`
- Sobrescrevem configurações globais

## 🎯 **Benefícios**

### **Flexibilidade**
- ✅ Configurações globais para consistência
- ✅ Configurações específicas por questão
- ✅ Fallback inteligente (global → específico)

### **Performance**
- ✅ Processamento paralelo configurável
- ✅ Rate limiting inteligente
- ✅ Estimativas de performance em tempo real

### **Usabilidade**
- ✅ Interface intuitiva com abas
- ✅ Configurações persistentes
- ✅ Feedback visual imediato

### **Manutenibilidade**
- ✅ Código modular e bem estruturado
- ✅ Separação clara de responsabilidades
- ✅ Fácil extensão de funcionalidades

## 🚀 **Status da Implementação**

- ✅ **Modal criado**: AIGlobalConfigModal.tsx
- ✅ **Integração completa**: BatchAssessmentBar atualizado
- ✅ **3 abas funcionais**: Processamento, IA, Prompts
- ✅ **Persistência**: localStorage + banco de dados
- ✅ **Build bem-sucedido**: Sem erros de compilação
- ✅ **UX otimizada**: Interface intuitiva e responsiva

## 🎉 **Pronto para Uso!**

O modal de configuração global está **completo e funcional**. Para acessar:

1. **Localização**: Botão "⚙️ Config" na barra de avaliação
2. **Funcionalidade**: 3 abas com configurações completas
3. **Persistência**: Configurações salvas automaticamente
4. **Aplicação**: Configurações aplicadas imediatamente

A implementação mantém o **código limpo, modular e de fácil manutenção**, exatamente como solicitado! 🎯
