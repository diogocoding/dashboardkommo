# Hub Comercial — Dashboard BI & Auditoria de Leads 🦾💼

> Painel de Business Intelligence e auditoria comercial desenvolvido para o escritório **Robson Menezes Advogados** (Direito Empresarial & Bancário), com integração nativa ao Kommo CRM.

---

## 📌 Visão Geral

O sistema consome dados nativos do **Kommo CRM** e reconstrói o histórico cronológico de interações dos leads, transformando registros estáticos em métricas dinâmicas e reativas de eficiência comercial para a equipe de SDR.

---

## 🚀 Diferenciais vs. Relatórios Nativos do CRM

| Recurso | CRM Nativo | Hub Comercial |
|---|---|---|
| Visualização de dados | Fotografia do status atual | Análise cronológica retrospectiva |
| Deduplicação de leads | Manual | Automática via campo `PHONE` |
| Fuso horário | UTC padrão | Brasília/Recife (`-03:00`) |
| KPIs de BI | Exportação de planilha | Cálculo automatizado em tempo real |

### Detalhamento dos Diferenciais

**1. Análise Cronológica Retrospectiva**
Enquanto o CRM tradicional exibe apenas o status atual do lead, o sistema varre a linha do tempo de modificações e calcula taxas de conversão retroativas com base no período selecionado.

**2. Deduplicação de Leads em Tempo Real**
O algoritmo analisa o campo `PHONE` de forma automatizada. Registros duplicados são limpos na memória e leads sem identificação nominal recebem tratamento visual (`⚠ Sem Nome`), blindando a integridade das métricas.

**3. Precisão de Fuso Horário**
Conversão nativa de Timestamps Unix para o fuso horário local (`-03:00`), garantindo auditorias sem furos em relação ao dia útil trabalhado.

**4. Cálculo Automatizado de BI**
Entrega indicadores complexos de performance (Aproveitamento, No-Show e Reengajamento) instantaneamente, eliminando a dependência de exportações de planilhas.

---

## 🛠️ Arquitetura

O projeto utiliza modelo de **arquitetura desacoplada Client-Server**:

```
├── backend/      # API Server — Node.js + Express + Axios
└── frontend/     # Dashboard UI — HTML5 + JS (ES6+) + Tailwind CSS + Tabler Icons
```

- **Backend:** Responsável pelo consumo, paginação e tratamento analítico dos dados via Kommo API v4.
- **Frontend:** Interface responsiva com atualização reativa dos indicadores conforme o período selecionado.

---

## 📊 Regras de Negócio e Engenharia das Métricas

O motor do sistema realiza consultas ao endpoint `/events` do Kommo v4, filtrando pelo gatilho `lead_status_changed`. Os eventos de cada lead são ordenados de forma crescente para avaliar o comportamento da esteira.

### Mapeamento de Etapas (IDs Estáveis)

```javascript
const ETAPAS_IDS = {
  "97353759":  "MARCAÇÃO DE REUNIÃO",
  "103294216": "protocolo farmer",
  "105105968": "protocolo farmer - ADIMPLENTE",
  "103294220": "CLIENTE QUENTE",
  "103294224": "CONTRATO FECHADO",
  "103294212": "LEADS QUALIFICADOS",
  "103294208": "QUALIFICAÇÃO",
  "107297324": "NO SHOW",
  "104878776": "CLIENTE SEM INTERESSE",
  "105108420": "CLIENTE FRIO"
};
```

### Lógica de Cálculo dos Indicadores

**Agendamentos Totais**
Computa cada transição onde o status de destino (`paraOndeFoi`) intercepta o ID de Marcação de Reunião (`97353759`).

**Novos vs. Reagendamentos**
- **Reagendamento:** o lead já possui histórico prévio na etapa de Marcação de Reunião, ou o status de origem (`deOndeSaiu`) pertence a um ID de perda (`107297324`, `105108420`, `104878776`).
- **Novo:** todos os demais casos.

**Taxa de Aproveitamento**
Mede a eficiência das reuniões que avançaram da Marcação para a esteira de sucesso (Farmer, Quente ou Fechado).

$$\text{Aproveitamento} = \left( \frac{\text{Total de Reuniões Realizadas}}{\text{Total de Agendados no Período}} \right) \times 100$$

**Absenteísmo (No-Show)**
Captura a quebra de fluxo onde o lead sai da Marcação de Reunião e vai diretamente para o status de No-Show (`107297324`).

$$\text{Taxa de No-Show} = \left( \frac{\text{Total de No-Shows no Período}}{\text{Total de Agendados no Período}} \right) \times 100$$

**Leads Reengajados**
Identifica leads arquivados nas colunas de perda (Cliente Frio / Sem Interesse) que foram recuperados e retornaram para uma nova Marcação de Reunião dentro do calendário selecionado.

**Contratos Fechados Dinâmicos**
Rastreia o volume real de assinaturas monitorando os eventos de entrada no ID `103294224` dentro do período selecionado, tornando o indicador do topo do painel reativo às datas.

---

## ⚙️ Configuração e Execução

### Pré-requisitos

- Node.js `>= 18.x`
- Credenciais de acesso ao Kommo CRM (token de API)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/hub-comercial.git
cd hub-comercial

# Instale as dependências do backend
cd backend
npm install
```

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do backend:

```env
KOMMO_TOKEN=seu_token_aqui
KOMMO_SUBDOMAIN=seu_subdominio
PORT=3000
```

### Execução

```bash
# Inicie o servidor backend
npm start

# Acesse o dashboard no navegador
# http://localhost:3000
```

---

## 🔐 Segurança

- O token da API do Kommo **nunca** deve ser exposto no frontend.
- Todas as requisições à API do CRM são intermediadas pelo servidor backend.
- Recomenda-se restringir o acesso ao painel por IP ou autenticação básica em ambiente de produção.

---

## 📄 Licença

Uso interno — Robson Menezes Advogados. Todos os direitos reservados.
