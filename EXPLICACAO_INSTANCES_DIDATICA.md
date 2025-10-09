# 📚 EXPLICAÇÃO DIDÁTICA: extraction_instances

**Analogia**: Imagine um formulário de pesquisa sobre **"Livros Favoritos"**

---

## 🎓 **ENTENDENDO COM ANALOGIA**

### **Sem Instances (Simples)**

Formulário fixo:
```
Nome: [_______]
Idade: [_______]
Livro Favorito: [_______]
Autor: [_______]
```

✅ Funciona se cada pessoa tem apenas 1 livro favorito

---

### **Com Instances (Flexível)**

Formulário onde cada pessoa pode ter **MÚLTIPLOS** livros favoritos:

```
Nome: [_______]
Idade: [_______]

📚 Livros Favoritos:  ← Esta é uma "seção múltipla"
  
  ┌─ Livro #1 "Harry Potter"
  │  Título: [Harry Potter]
  │  Autor: [J.K. Rowling]
  │  Ano: [1997]
  └─
  
  ┌─ Livro #2 "1984"
  │  Título: [1984]
  │  Autor: [George Orwell]
  │  Ano: [1949]
  └─
  
  ┌─ Livro #3 "Senhor dos Anéis"
  │  Título: [Senhor dos Anéis]
  │  Autor: [Tolkien]
  │  Ano: [1954]
  └─
  
  [+ Adicionar outro livro]
```

**Cada "Livro"** = 1 **Instance**

---

## 🔬 **NO CONTEXTO DE EXTRAÇÃO DE DADOS**

### **Cenário Real: Revisão Sistemática de Modelos Preditivos**

Você está revisando um artigo que compara **3 modelos de IA**:

```
Artigo: "Comparing ML Models for Diabetes Prediction"

O artigo descreve:
├─ Model 1: Random Forest
│   • Algorithm: Random Forest
│   • C-statistic: 0.82
│   • Sample: 1000 patients
│   • Variables: 15
│
├─ Model 2: Logistic Regression
│   • Algorithm: Logistic Regression
│   • C-statistic: 0.76
│   • Sample: 1000 patients
│   • Variables: 8
│
└─ Model 3: Neural Network
    • Algorithm: Deep Learning
    • C-statistic: 0.85
    • Sample: 800 patients
    • Variables: 20
```

**Como extrair esses dados?**

---

## 📊 **ESTRUTURA DE DADOS**

### **Entity Type (Tipo de Seção)**:
```sql
extraction_entity_types:
  name: "index_models"
  label: "Index Models" (Modelos Preditivos)
  cardinality: "many"  ← PERMITE MÚLTIPLOS!
```

### **Fields (Campos da Seção)**:
```sql
extraction_fields:
  - field: "algorithm_type" (Tipo de Algoritmo)
  - field: "c_statistic" (C-statistic)
  - field: "sample_size" (Tamanho da Amostra)
  - field: "num_variables" (Número de Variáveis)
```

### **Instances (Para ESTE Artigo)**:
```sql
extraction_instances:

Instance #1:
  id: uuid-1
  article_id: "article-abc"
  entity_type_id: "index_models"
  label: "Random Forest Model"  ← Nome que o user dá
  is_template: false
  
Instance #2:
  id: uuid-2
  article_id: "article-abc"
  entity_type_id: "index_models"
  label: "Logistic Regression"
  is_template: false
  
Instance #3:
  id: uuid-3
  article_id: "article-abc"
  entity_type_id: "index_models"
  label: "Neural Network"
  is_template: false
```

### **Extracted Values (Valores Concretos)**:
```sql
extracted_values:

Para Instance #1 (Random Forest):
  - instance_id: uuid-1, field: "algorithm", value: "Random Forest"
  - instance_id: uuid-1, field: "c_statistic", value: 0.82
  - instance_id: uuid-1, field: "sample_size", value: 1000
  - instance_id: uuid-1, field: "num_variables", value: 15

Para Instance #2 (Logistic):
  - instance_id: uuid-2, field: "algorithm", value: "Logistic Regression"
  - instance_id: uuid-2, field: "c_statistic", value: 0.76
  - instance_id: uuid-2, field: "sample_size", value: 1000
  - instance_id: uuid-2, field: "num_variables", value: 8

Para Instance #3 (Neural):
  - instance_id: uuid-3, field: "algorithm", value: "Deep Learning"
  - instance_id: uuid-3, field: "c_statistic", value: 0.85
  - instance_id: uuid-3, field: "sample_size", value: 800
  - instance_id: uuid-3, field: "num_variables", value: 20
```

---

## 🎯 **POR QUE PRECISA DE INSTANCES?**

### **Sem Instances (IMPOSSÍVEL para cardinality=many)**:
```
❌ Como armazenar 3 modelos?
❌ Criar 3 cópias da tabela de fields?
❌ Como saber qual c-statistic é de qual modelo?
❌ Valores ficam misturados!
```

### **Com Instances (SOLUÇÃO ELEGANTE)**:
```
✅ Cada modelo = 1 instance
✅ Valores vinculados à instance correta via instance_id
✅ extracted_values.instance_id diz "qual modelo"
✅ Pode ter 1, 3, 10 ou 100 modelos!
```

---

## 💡 **ANALOGIA FINAL: Planilha Excel**

Imagine exportar os dados para Excel:

### **Sem Instances (Confuso)**:
```
| Algorithm | C-stat | Sample |
|-----------|--------|--------|
| Random F  | 0.82   | 1000   |  ← De qual modelo?
| Logistic  | 0.76   | 1000   |  ← Não dá pra saber!
| Neural    | 0.85   | 800    |  ← Misturado!
```

### **Com Instances (Claro)**:
```
| Model Name           | Algorithm | C-stat | Sample |
|---------------------|-----------|--------|--------|
| Random Forest Model | Random F  | 0.82   | 1000   | ← Instance #1
| Logistic Regression | Logistic  | 0.76   | 1000   | ← Instance #2
| Neural Network      | Neural    | 0.85   | 800    | ← Instance #3
```

**"Model Name"** = `instance.label`

---

## 🔄 **FLUXO COMPLETO NA INTERFACE**

### **User Extrai Artigo com 3 Modelos**:

```
1. User abre artigo para extração
   
2. Sistema cria instances automaticamente:
   - Se cardinality="one" → 1 instance
   - Se cardinality="many" → 0 instances (user cria)

3. User vê seção "Index Models"
   Expandir ▼
   
4. Ainda vazia, então:
   Click [+ Adicionar Index Models]
   
5. Sistema cria Instance #1:
   - Label: "Index Models 1"
   - User pode editar: "Random Forest Model"
   
6. User preenche campos do Random Forest:
   - Algorithm: Random Forest
   - C-statistic: 0.82
   - etc.
   
7. User adiciona outro modelo:
   Click [+ Adicionar Index Models]
   
8. Sistema cria Instance #2:
   - Label: "Index Models 2"
   - User edita: "Logistic Regression"
   
9. User preenche campos do Logistic
   
10. E assim por diante...

11. No banco:
    extraction_instances: 2 rows (Random Forest + Logistic)
    extracted_values: 8 rows (4 campos × 2 instances)
```

---

## 🎨 **VISUAL NA INTERFACE**

```
▼ Index Models (Múltipla 3)                    12/15 campos

  ┌─────────────────────────────────────────────────┐
  │ #1 Random Forest Model                    [🗑️]  │
  │                                                  │
  │ Algorithm Type: [Random Forest_________]        │
  │ C-statistic: [0.82___]                         │
  │ Sample Size: [1000___] patients                │
  │ Variables: [15___]                             │
  └─────────────────────────────────────────────────┘
  
  ┌─────────────────────────────────────────────────┐
  │ #2 Logistic Regression                    [🗑️]  │
  │                                                  │
  │ Algorithm Type: [Logistic Regression___]       │
  │ C-statistic: [0.76___]                         │
  │ Sample Size: [1000___] patients                │
  │ Variables: [8___]                              │
  └─────────────────────────────────────────────────┘
  
  ┌─────────────────────────────────────────────────┐
  │ #3 Neural Network                         [🗑️]  │
  │                                                  │
  │ Algorithm Type: [Deep Learning_________]       │
  │ C-statistic: [0.85___]                         │
  │ Sample Size: [800___] patients                 │
  │ Variables: [20___]                             │
  └─────────────────────────────────────────────────┘
  
  [+ Adicionar Index Models]  ← Cria Instance #4
```

**Cada Card** = 1 **Instance**

---

## 📊 **COMPARAÇÃO: One vs Many**

### **Cardinality = "one"** (1 instância fixa):
```
▼ Population (Única)

  Inclusion Criteria: [Female, age 30-50...]
  Sample Size: [25___]
  Age: [39___] years
```

**No banco**:
- 1 instance criada automaticamente
- Campos preenchidos direto
- Simples

### **Cardinality = "many"** (N instâncias):
```
▼ Predictors (Múltipla)

  ┌─ #1 Blood Pressure
  │  Type: [Continuous]
  │  Mean: [120___] mmHg
  └─
  
  ┌─ #2 Diabetes Status
  │  Type: [Binary]
  │  Prevalence: [15___] %
  └─
  
  [+ Adicionar Predictors]
```

**No banco**:
- N instances (user cria conforme necessário)
- Cada instance tem seus próprios valores
- Flexível

---

## 🎯 **RESUMO SUPER SIMPLES**

**Instance** = **"Ocorrência"** ou **"Caso"** de uma seção

**Exemplos**:
- Artigo tem 3 modelos → 3 instances de "Index Models"
- Artigo tem 5 datasets → 5 instances de "Datasets"
- Artigo tem 10 preditores → 10 instances de "Predictors"
- Artigo tem 1 população → 1 instance de "Population"

**Sem instances**: Não tem como representar múltiplas ocorrências!

**Com instances**: Flexibilidade total! ✅

---

**Preparado por**: AI Assistant  
**Metodologia**: Analogias + Exemplos visuais + Casos reais

🎓 **ESPERO QUE TENHA FICADO CLARO!**
