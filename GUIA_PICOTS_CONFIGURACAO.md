# Guia de Uso: Configuração PICOTS com Critérios de Inclusão/Exclusão

## Visão Geral

O sistema agora suporta um framework PICOTS completo e estruturado, especialmente projetado para revisões sistemáticas de modelos preditivos. Cada componente do PICOTS pode ter:

- **Info**: Explicação sobre o que deve ser preenchido
- **Descrição**: Conteúdo principal do componente
- **Critérios de Inclusão**: Lista de critérios que determinam o que entra
- **Critérios de Exclusão**: Lista de critérios que determinam o que fica de fora

## Estrutura de Dados no Banco

```typescript
picots_config_ai_review: {
  // População (P)
  population: {
    info: string,           // Orientações sobre preenchimento
    description: string,    // Descrição da população
    inclusion: string[],    // Critérios de inclusão
    exclusion: string[]     // Critérios de exclusão
  },
  
  // Índice/Intervenção (I)
  index_models: {
    info: string,
    description: string,
    inclusion: string[],
    exclusion: string[]
  },
  
  // Comparador (C)
  comparator_models: {
    info: string,
    description: string,
    inclusion: string[],
    exclusion: string[]
  },
  
  // Desfechos (O)
  outcomes: {
    info: string,
    description: string,
    inclusion: string[],
    exclusion: string[]
  },
  
  // Tempo (T)
  timing: {
    prediction_moment: {
      info: string,
      description: string,
      inclusion: string[],
      exclusion: string[]
    },
    prediction_horizon: {
      info: string,
      description: string,
      inclusion: string[],
      exclusion: string[]
    }
  },
  
  // Setting (S)
  setting_and_intended_use: {
    info: string,
    description: string,
    inclusion: string[],
    exclusion: string[]
  }
}
```

## Exemplo Completo: Revisão de Modelos Preditivos para Diabetes

### População (P)

**Info:**
```
Defina as características demográficas e clínicas da população alvo. 
Considere idade, condições de saúde, setting de cuidado e estágio da doença.
```

**Descrição:**
```
Adultos com diagnóstico confirmado de diabetes tipo 2, em acompanhamento 
ambulatorial ou hospitalar, com dados completos de seguimento clínico.
```

**Critérios de Inclusão:**
- Idade ≥ 18 anos
- Diagnóstico de diabetes tipo 2 confirmado pelos critérios ADA
- Seguimento clínico mínimo de 6 meses
- Disponibilidade de dados clínicos e laboratoriais básicos

**Critérios de Exclusão:**
- Diabetes tipo 1 ou outras formas específicas de diabetes
- Gestantes ou lactantes
- Pacientes em cuidados paliativos
- Transplantados de pâncreas

---

### Modelos Índice (I)

**Info:**
```
Especifique os tipos de modelos preditivos, algoritmos ou ferramentas 
diagnósticas que serão incluídos. Considere a técnica estatística, 
tipo de algoritmo e complexidade do modelo.
```

**Descrição:**
```
Modelos preditivos desenvolvidos para estimar risco de complicações 
microvasculares em pacientes com diabetes tipo 2, incluindo modelos 
estatísticos, machine learning e deep learning.
```

**Critérios de Inclusão:**
- Modelos preditivos multivariados
- Validação em coorte independente
- Performance reportada com métricas padrão (AUC, sensibilidade, especificidade)
- Variáveis preditoras claramente descritas

**Critérios de Exclusão:**
- Modelos univariados simples
- Modelos sem validação externa
- Ferramentas diagnósticas não preditivas
- Modelos proprietários sem descrição da metodologia

---

### Comparadores (C)

**Info:**
```
Defina quais modelos de referência, escores clínicos tradicionais ou 
padrões-ouro serão aceitos como comparadores.
```

**Descrição:**
```
Modelos preditivos de referência estabelecidos na literatura, escores 
de risco clínicos validados, ou julgamento clínico não estruturado.
```

**Critérios de Inclusão:**
- Escores de risco publicados e validados
- Modelos preditivos de referência na literatura
- Cuidado usual ou julgamento clínico estruturado
- Comparação head-to-head com métricas equivalentes

**Critérios de Exclusão:**
- Comparadores não validados
- Ferramentas diagnósticas de outra natureza
- Comparações indiretas sem ajuste adequado

---

### Desfechos (O)

**Info:**
```
Liste os desfechos de interesse, incluindo métricas de performance do 
modelo (acurácia, discriminação, calibração) e desfechos clínicos 
relevantes quando disponíveis.
```

**Descrição:**
```
Performance preditiva dos modelos avaliada por discriminação (AUC-ROC), 
calibração (gráficos de calibração, Brier score) e utilidade clínica 
(curvas de decisão). Desfechos clínicos incluem incidência de 
complicações microvasculares (retinopatia, nefropatia, neuropatia).
```

**Critérios de Inclusão:**
- AUC-ROC ≥ 0.60
- Métricas de calibração reportadas
- Sensibilidade e especificidade em pelo menos um ponto de corte
- Incidência de eventos clínicos durante o seguimento

**Critérios de Exclusão:**
- Apenas acurácia global sem outras métricas
- Desfechos substitutos não validados
- Performance reportada apenas em conjunto de treinamento
- Follow-up < 1 ano para desfechos clínicos

---

### Tempo - Momento da Predição (T)

**Info:**
```
Especifique em que momento do curso da doença ou cuidado a predição 
é realizada. Considere o contexto clínico e o objetivo da predição.
```

**Descrição:**
```
Momento da predição realizado no diagnóstico de diabetes tipo 2 ou 
durante o acompanhamento de rotina, com dados clínicos e laboratoriais 
disponíveis naquele ponto temporal.
```

**Critérios de Inclusão:**
- Predição ao diagnóstico de diabetes
- Predição durante consultas de seguimento (qualquer tempo)
- Dados coletados prospectivamente ou de forma estruturada
- Ponto temporal claramente definido

**Critérios de Exclusão:**
- Momento da predição não especificado
- Dados retrospectivos com viés de seleção significativo
- Predições realizadas após o desfecho já ter ocorrido

---

### Tempo - Horizonte de Predição (T)

**Info:**
```
Defina o período futuro que está sendo predito. Considere a relevância 
clínica do horizonte temporal para a tomada de decisão.
```

**Descrição:**
```
Horizonte de predição entre 1 e 10 anos para desenvolvimento de 
complicações microvasculares do diabetes.
```

**Critérios de Inclusão:**
- Horizonte de predição de 1 a 10 anos
- Horizonte claramente especificado no estudo
- Follow-up suficiente para observar o desfecho
- Censura adequadamente tratada na análise

**Critérios de Exclusão:**
- Horizonte < 6 meses (muito curto para complicações crônicas)
- Horizonte não especificado
- Follow-up médio < 50% do horizonte declarado
- Perda de seguimento > 30%

---

### Contexto e Uso Pretendido (S)

**Info:**
```
Descreva onde e como o modelo será usado na prática clínica. 
Considere o setting de cuidado, recursos disponíveis e objetivo 
da aplicação do modelo.
```

**Descrição:**
```
Modelos aplicáveis em atenção primária ou especializada, usando 
variáveis disponíveis na prática clínica de rotina, para auxiliar 
na estratificação de risco e intensificação de monitoramento.
```

**Critérios de Inclusão:**
- Atenção primária ou especializada
- Variáveis disponíveis na rotina clínica
- Implementação viável com recursos existentes
- Objetivo claro de uso (triagem, monitoramento, decisão terapêutica)

**Critérios de Exclusão:**
- Apenas contextos de pesquisa acadêmica
- Variáveis não disponíveis na prática real
- Necessidade de equipamentos ou exames não disponíveis
- Setting altamente especializado sem generalização

## Como Usar na Interface

### Passo 1: Acesse Configurações
1. Entre no seu projeto
2. Clique na aba "Configurações" na sidebar
3. Selecione "Detalhes da Revisão"

### Passo 2: Preencha PICOTS
1. Role até a seção "Configuração PICOTS"
2. Clique em cada item do accordion (População, Índice, etc)
3. Para cada item:
   - Preencha o campo **"Informação sobre o campo"** (área cinza com ícone ℹ️)
   - Descreva o componente no campo principal
   - Adicione critérios de **Inclusão** (badges verdes)
   - Adicione critérios de **Exclusão** (badges vermelhos)

### Passo 3: Salve as Alterações
1. Clique em "Salvar Alterações" no topo da página
2. Aguarde a confirmação de sucesso

## Dicas de Preenchimento

### ✅ Boas Práticas

1. **Campo Info**
   - Use para orientar outros revisores sobre o que preencher
   - Inclua exemplos quando possível
   - Seja específico sobre o contexto da revisão

2. **Descrição**
   - Seja descritivo mas conciso
   - Use linguagem técnica apropriada
   - Referencie diretrizes quando aplicável

3. **Critérios de Inclusão**
   - Use frases afirmativas
   - Seja específico e mensurável quando possível
   - Liste em ordem de importância

4. **Critérios de Exclusão**
   - Use frases negativas claras
   - Evite redundância com inclusão
   - Inclua justificativa quando não óbvio

### ❌ Evite

- Critérios vagos ou ambíguos
- Sobreposição entre inclusão e exclusão
- Listas muito longas (agrupe conceitos semelhantes)
- Linguagem informal ou não técnica

## Exportação e Relatórios

Os critérios PICOTS configurados serão usados para:

1. **Avaliação de Artigos**
   - Triagem automática com IA baseada nos critérios
   - Checklist para revisores humanos
   - Registro de justificativas de inclusão/exclusão

2. **Relatórios**
   - Geração automática de tabelas PICOTS
   - Exportação para protocolos (PROSPERO, OSF)
   - Documentação para publicações

3. **Reprodutibilidade**
   - Registro completo dos critérios
   - Versionamento de alterações
   - Transparência metodológica

## Benefícios

### Para a Equipe
- ✅ Alinhamento claro sobre critérios
- ✅ Redução de ambiguidade
- ✅ Treinamento de novos revisores facilitado
- ✅ Documentação automatizada

### Para a Revisão
- ✅ Maior rigor metodológico
- ✅ Transparência e reprodutibilidade
- ✅ Conformidade com diretrizes (PRISMA, Cochrane)
- ✅ Menor viés de seleção

### Para IA
- ✅ Instruções estruturadas para avaliação
- ✅ Critérios claros para treinamento
- ✅ Justificativas fundamentadas
- ✅ Auditoria de decisões

## Suporte

Para dúvidas sobre preenchimento do PICOTS:
- Consulte diretrizes PROBAST (para modelos preditivos)
- Veja exemplos em revisões sistemáticas publicadas
- Use templates da Cochrane quando aplicável

