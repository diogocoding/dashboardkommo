# Hub Comercial — Dashboard BI & Auditoria de Leads 🦾💼

> Painel de Business Intelligence e auditoria comercial desenvolvido para o escritório **Robson Menezes Advogados** (Direito Empresarial & Bancário), com integração nativa ao Kommo CRM.

---

## 📌 Visão Geral

O sistema consome dados nativos do **Kommo CRM** e reconstrói o histórico cronológico de interações dos leads, transformando registros estáticos em métricas dinâmicas e reativas de eficiência comercial para a equipe de SDR.

---

## 🖼️ Screenshots

<img width="1920" height="1080" alt="Image" src="https://github.com/user-attachments/assets/622bf31f-b482-488a-b8ba-02be6f78f2f6" />


---

## 🚀 Diferenciais vs. Relatórios Nativos do CRM

| Recurso | CRM Nativo | Hub Comercial |
|---|---|---|
| Visualização de dados | Fotografia do status atual | Análise cronológica retrospectiva |
| Deduplicação de leads | Manual | Automática via campo `PHONE` |
| Fuso horário | UTC padrão | Brasília/Recife (`-03:00`) |
| KPIs de BI | Exportação de planilha | Cálculo automatizado em tempo real |
| Exportação | Planilha manual | CSV com um clique diretamente do painel |
| Qualidade de dados | Invisível | Alertas automáticos de leads incompletos |
| Atualização | Manual (F5) | Auto-refresh a cada 5 minutos |
| Acesso | Sem controle | Protegido via Cloudflare Access |

---

## 📊 Indicadores e Painéis

### Metas com Barra de Progresso (topo)
Indicadores visuais de avanço em relação às metas mensais:
- **Meta de Agendados:** progresso em relação a 40 reuniões/mês — barra muda de vermelho → amarelo → verde conforme o avanço.
- **Contratos Fechados:** progresso em relação a 5 contratos/mês — mesma lógica de cores.

### Indicador de Última Atualização
Selo no cabeçalho mostrando o horário da última sincronização com o CRM, com ponto verde pulsante indicando que o auto-refresh está ativo.

### KPIs Principais
- **Reuniões Realizadas:** leads que saíram de "Marcação de Reunião" para uma coluna de sucesso no período.
- **Total de Agendados:** todos os leads que entraram na etapa de Marcação no período, subdivididos em novos e reagendamentos.
- **Taxa de Aproveitamento:** percentual de reuniões agendadas que resultaram em avanço no funil.
- **Absenteísmo (No-Show):** percentual de reuniões cujo lead migrou direto para a coluna No-Show.
- **Leads Reengajados:** leads resgatados de colunas de perda (Frio / Sem Interesse) que retornaram para Marcação.

### Painéis de Análise Avançada
- **Gráfico de Barras do Funil:** distribuição visual horizontal de todos os leads por etapa, com tempo médio de permanência em dias ao lado de cada barra.
- **Conversão SDR → Contrato:** taxa percentual direta entre total de agendados e contratos fechados no período, com barra de progresso.
- **Top 5 Tags da Base:** ranking das tags mais frequentes na base de leads, com barras proporcionais.
- **Conversão entre Etapas:** painel listando os pares de transição mais frequentes do período (ex: Qualificação → Marcação de Reunião: 66%), com código de cor por taxa (verde ≥ 50%, amarelo ≥ 25%, vermelho < 25%).
- **Leads Frios Ativos:** lista de leads em etapas ativas que estão há mais de 7 dias sem movimentação — priorizados para ação imediata. Exportável via CSV completo (sem limite de 20 registros).
- **Alerta de Qualidade de Dados:** contador de leads sem nome ou sem telefone na base, para higienização proativa.

### Tabela de Leads do Período
Todos os leads movimentados no intervalo selecionado, com:
- Busca em tempo real por nome, telefone ou etapa
- Badge colorido de etapa para leitura rápida
- Destaque visual (vermelho) em leads com dados incompletos
- **Exportação CSV** direto pelo navegador, sem nenhuma chamada extra ao servidor

---

## 🛠️ Arquitetura

```
├── client/
│   ├── index.html   # Interface — Tailwind CSS + Tabler Icons
│   └── app.js       # Lógica de renderização reativa
└── server/
    ├── server.js    # API Node.js + Express — motor analítico
    └── package.json
```

**Backend:** Hospedado no Render. Consome, pagina e processa todos os dados via Kommo API v4. Nenhum dado sensível é exposto ao cliente.

**Frontend:** Hospedado no Cloudflare Workers (Static Assets). HTML5 puro + JS ES6+ + Tailwind CDN. Sem frameworks, sem build step, sem dependências de frontend.

**Controle de Acesso:** Protegido via **Cloudflare Access** (Zero Trust) — autenticação por e-mail com código de uso único, ocorrendo na borda da rede da Cloudflare antes de qualquer asset ser entregue ao navegador. Apenas e-mails cadastrados na política de acesso conseguem visualizar o dashboard.

---

## 🔧 Regras de Negócio e Engenharia das Métricas

### Mapeamento de Etapas (IDs Estáveis)

```javascript
const ETAPAS_IDS = {
  "97353747":  "ETAPA DE ENTRADA",
  "97353751":  "CONTATO INICIAL",
  "104878772": "CONTATO INICIADO",
  "107763012": "INTERESSADOS",
  "97353759":  "MARCAÇÃO DE REUNIÃO",
  "103294216": "protocolo farmer",
  "105105968": "protocolo farmer - ADIPLENTE",
  "103294220": "CLIENTE QUENTE",
  "103294224": "CONTRATO FECHADO",
  "103294212": "LEADS QUALIFICADOS",
  "103294208": "QUALIFICAÇÃO",
  "107297324": "NO SHOW",
  "104878776": "CLIENTE SEM INTERESSE",
  "105108420": "CLIENTE FRIO",
  "107143436": "INVÁLIDOS"
};
```

O servidor mantém também um **mapa reverso** (nome textual → nome canônico) e uma função `resolverNomeEtapa()` que garante resolução correta mesmo quando o Kommo retorna o nome da etapa em vez do ID numérico no payload do evento — evitando que IDs brutos apareçam na interface.

### Etapas com Tratamento Especial

**ETAPA DE ENTRADA** é excluída dos cálculos de "Leads Frios" e "Qualidade de Dados" porque ela se recria automaticamente toda vez que um lead (já existente na base) volta a interagir pelo WhatsApp — gerando ruído estatístico se contabilizada normalmente.

**INVÁLIDOS** aparece normalmente no gráfico do funil (snapshot), mas representa leads descartados/sem aproveitamento comercial.

### Lógica dos Indicadores

**Agendamentos Totais**
Toda transição onde `status_after.id` corresponde a Marcação de Reunião (`97353759`).

**Novos vs. Reagendamentos**
- **Reagendamento:** lead já esteve em Marcação antes, ou veio de coluna de perda (No-Show / Frio / Sem Interesse).
- **Novo:** todos os demais casos.

**Taxa de Aproveitamento**
```
Aproveitamento = (Reuniões Realizadas / Total Agendados) × 100
```

**Absenteísmo (No-Show)**
```
Taxa No-Show = (Total No-Shows / Total Agendados) × 100
```

**Conversão SDR → Contrato**
```
Taxa SDR→Contrato = (Contratos Fechados no período / Total Agendados) × 100
```

**Leads Reengajados**
Leads que vieram de "Cliente Frio" ou "Cliente Sem Interesse" e retornaram para Marcação de Reunião no período.

**Leads Frios Ativos**
Leads em etapas não-terminais com `updated_at` superior a 7 dias — excluindo Contrato Fechado, Cliente Frio, Sem Interesse e Etapa de Entrada.

**Tempo Médio por Etapa**
Média dos dias desde o último `updated_at` de cada lead agrupado por etapa atual.

**Conversão entre Etapas**
Para cada par (origem → destino) de transição ocorrida no período:
```
Taxa = (Transições origem→destino / Total de saídas da origem) × 100
```

---

## ⚙️ Configuração e Execução

### Pré-requisitos
- Node.js `>= 18.x`
- Token de API do Kommo CRM
- Conta Cloudflare (gratuita) para hospedagem do frontend

### Instalação

```bash
git clone https://github.com/diogocoding/dashboardkommo.git
cd dashboardkommo/server
npm install
```

### Variáveis de Ambiente

Crie `.env` dentro de `server/`:

```env
KOMMO_TOKEN=seu_token_aqui
KOMMO_SUBDOMAIN=seu_subdominio
PORT=3001
```

### Execução do Backend (Render)

```bash
cd server
npm start
```

### Deploy do Frontend (Cloudflare Workers)

```bash
cd client
npx wrangler deploy
```

O deploy também ocorre automaticamente a cada push na branch `main` via integração Git da Cloudflare.

---

## 🔐 Segurança

- O token da API do Kommo **nunca** é exposto no frontend — todas as chamadas ao CRM são intermediadas pelo servidor.
- O acesso ao dashboard é restrito via **Cloudflare Access**, com autenticação por e-mail e política de allowlist — apenas usuários autorizados pela equipe conseguem visualizar qualquer conteúdo, incluindo o HTML/JS estático.
- Recomenda-se ativar MFA (multi-factor authentication) na política do Cloudflare Access para uma camada adicional de proteção.

---

## 📄 Licença

Uso interno — Robson Menezes Advogados. Todos os direitos reservados.
