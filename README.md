
# Hub Comercial — Dashboard BI & Auditoria de Leads 💼

> Painel de Business Intelligence e auditoria comercial desenvolvido para o escritório **Robson Menezes Advogados** (Direito Empresarial & Bancário), com integração nativa ao Kommo CRM.

---

## 📌 Visão Geral

O sistema consome dados nativos do **Kommo CRM** e reconstrói o histórico cronológico de interações dos leads, transformando registros estáticos em métricas dinâmicas e reativas de eficiência comercial para a equipe de SDR.

📄 **Documentação completa da metodologia de cálculo** (parecer técnico com todas as fórmulas, janelas de tempo e salvaguardas): disponível dentro do próprio dashboard em `/documentacao`, ou em [`client/documentacao.html`](./client/documentacao.html) neste repositório.

---

## 🖼️ Screenshots

<img width="1920" height="1080" alt="Image" src="https://i.postimg.cc/YqQnKQq3/1.jpg" />

**Cloudflare Access (Zero Trust) + Leads Frios, Reuniões em Aberto e Tabela de Leads do Período**
Tela de autenticação do Cloudflare Access (código de uso único por e-mail, validado na borda antes de qualquer asset ser entregue) ao lado dos painéis de Leads Frios Ativos, Reuniões em Aberto sem desfecho e da tabela completa de Leads Movimentados no Período, com busca e exportação em CSV.

<img width="1920" height="1080" alt="Image" src="https://i.postimg.cc/X79HS97c/2.jpg" />

**KPIs de Conversão e Análise entre Etapas**
Indicadores de Aproveitamento, Absenteísmo (No-Show) e Leads Reengajados, junto com os painéis de Conversão SDR → Contrato, Conversão entre Etapas (com código de cor por taxa) e "Para Onde Vão os Leads" — visão detalhada de para quais etapas os leads migram a partir de uma etapa de origem selecionada.

<img width="1920" height="1080" alt="KPIs de conversão e análise entre etapas" src="https://i.postimg.cc/vH5qF5Hh/3.jpg" />

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
- **Conversão Ampla (Etapas-Chave):** taxa de conversão entre pares de etapas-chave considerando o total que passou pela etapa de origem e quantos chegaram na de destino — mesmo havendo etapas intermediárias no meio do caminho, diferente da Conversão entre Etapas (que só olha transições diretas).
- **Leads Frios Ativos:** lista de leads em etapas ativas que estão há mais de 7 dias sem movimentação — priorizados para ação imediata. Exportável via CSV completo (sem limite de 20 registros).
- **Alerta de Qualidade de Dados:** contador de leads sem nome ou sem telefone na base, para higienização proativa.

### Reuniões em Aberto
Reuniões agendadas dentro do período filtrado que ainda não tiveram desfecho registrado (nem realização, nem no-show, nem reagendamento) — evita que o painel subestime o volume de reuniões pendentes de consolidação. Cada card mostra a data do agendamento e há quantos dias a reunião aguarda desfecho, com exportação em CSV.

### Tabela de Leads do Período
Todos os leads movimentados no intervalo selecionado, com:
- Busca em tempo real por nome, telefone ou etapa
- Badge colorido de etapa para leitura rápida
- Destaque visual (vermelho) em leads com dados incompletos
- **Exportação CSV** direto pelo navegador, sem nenhuma chamada extra ao servidor

Além da tabela, o backend expõe **`GET /api/historico-completo`** — exportação do histórico completo de transições de etapa no período, com eventos excluídos/corrigidos sinalizados explicitamente (em vez de silenciosamente filtrados), para auditoria externa da metodologia. O CSV exportado inclui três colunas dedicadas a apurar a chegada real dos leads em Contato Inicial (ver seção **🕐 Chegada em Contato Inicial no Export de Histórico** abaixo).

---

## 🛠️ Arquitetura

```
├── client/
│   ├── index.html         # Interface — Tailwind CSS + Tabler Icons
│   ├── app.js             # Lógica de renderização reativa
│   └── documentacao.html  # Parecer técnico: metodologia de cálculo das métricas (servido em /documentacao)
└── server/
    ├── server.js       # API Node.js + Express — motor analítico
    └── package.json
```

> Exclusões e correções de eventos (ver seção **🧹 Correção de Movimentações Erradas**) são persistidas no Upstash Redis, não em arquivo local.

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

## 🧹 Correção de Movimentações Erradas (Exclusão ou Reescrita Controlada de Eventos)

O Kommo não permite apagar ou editar eventos de histórico (`lead_status_changed`). Quando um lead é movido para a etapa errada por engano e devolvido em seguida, isso gera eventos extras que **permanecem para sempre** no histórico do CRM e distorceriam as métricas (ex: um "no-show" fantasma para uma reunião que ainda vai acontecer).

Para resolver isso sem jamais alterar o histórico original no Kommo, o sistema oferece dois mecanismos — mutuamente exclusivos por evento (aplicar um remove o outro, caso exista):

**1. Exclusão** — ignora o evento por completo no cálculo de métricas:
- **`GET /api/eventos-lead/:id`** — lista todas as transições de etapa de um lead específico, com o `eventId` de cada uma e as flags `jaExcluido` / `jaCorrigido`.
- **`POST /api/excluir-evento`** — marca um `eventId` como ignorado, com motivo.
- **`DELETE /api/excluir-evento/:eventId`** — reverte a exclusão.

**2. Correção** — em vez de descartar o evento, reescreve para qual etapa ele foi (obrigatório), de qual etapa saiu (opcional) e em que data/hora isso ocorreu (opcional — mantém o horário original se omitido). Útil quando a movimentação não deveria ser ignorada, mas sim contabilizada de forma diferente:
- **`GET /api/etapas`** — lista os nomes canônicos de etapa, para popular os seletores de correção no dashboard.
- **`GET /api/correcoes`** — lista as correções ativas.
- **`POST /api/corrigir-evento`** — cria ou atualiza a correção de um evento (`novaEtapaOrigem`, `novaEtapaDestino`, `novaDataHora`, `motivo`).
- **`DELETE /api/corrigir-evento/:eventId`** — reverte a correção, restaurando o valor original do Kommo.

Antes de qualquer cálculo de métrica, o backend aplica as correções e remove os eventos excluídos da base.

**Como usar:** no topo do dashboard, o link discreto **"corrigir movimentação errada"** abre uma janela onde basta informar o ID do lead (visível na URL do card no Kommo), localizar a transição incorreta na lista e escolher entre excluir do cálculo ou corrigir a etapa/horário — com confirmação antes de aplicar. Essa função deve ser usada **exclusivamente** para movimentações indevidas, nunca para omitir desfechos reais de negócio.

> **Persistência:** exclusões e correções são gravadas no **Upstash Redis** (uma chave por tipo, valor em JSON), e não em arquivo local — isso evita a perda das marcações que ocorria em hospedagens com armazenamento efêmero (ex: Render Free, cujo disco é descartado a cada hibernação/redeploy).

---

## 🕐 Chegada em Contato Inicial no Export de Histórico

O Kommo só gera um evento de `lead_status_changed` quando um lead **muda** de etapa — não quando ele "nasce" numa etapa. Como boa parte dos leads da esteira automatizada já é criada diretamente em **Contato Inicial**, esses casos não deixam nenhum evento de entrada no log: só o de saída (para Contato Iniciado, por exemplo) fica registrado. Isso tornava impossível responder, olhando só o histórico bruto, "quando esse lead chegou em Contato Inicial?" para a maioria dos leads.

O endpoint `GET /api/historico-completo` resolve isso adicionando três colunas ao CSV exportado:

| Coluna | Descrição |
|---|---|
| **Data Criação do Lead** | `created_at` do lead, obtido direto da API do Kommo. |
| **Chegada em Contato Inicial** | Timestamp calculado por lead: usa o evento real de entrada em Contato Inicial quando ele existe dentro do período consultado; na ausência dele, usa a Data de Criação do Lead como aproximação. |
| **Chegada Estimada (sem evento de entrada)** | `Sim`/`Não`. `Não` = veio de um evento real de movimentação. `Sim` = veio do fallback (data de criação), por não existir evento de entrada registrado no período. |

**Regra de cálculo:**
```
Chegada em Contato Inicial = Evento real de entrada no período (se existir) OU Data de Criação do Lead
```

> **Nota sobre a janela de datas:** o cálculo só enxerga eventos dentro do intervalo selecionado no export. Um lead que chegou em Contato Inicial *antes* do início do período escolhido terá seu evento de entrada fora de alcance mesmo que ele exista no Kommo, e a coluna cairá no fallback (marcada como estimada). Para minimizar isso, recomenda-se exportar com uma data de início um pouco mais ampla do que o período de interesse real.

---

## ⚙️ Configuração e Execução

### Pré-requisitos
- Node.js `>= 18.x`
- Token de API do Kommo CRM
- Conta Cloudflare (gratuita) para hospedagem do frontend
- Banco Upstash Redis (gratuito) para persistência de exclusões/correções

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
UPSTASH_REDIS_REST_URL=sua_url_upstash_aqui
UPSTASH_REDIS_REST_TOKEN=seu_token_upstash_aqui
```

> As credenciais do Upstash (plano gratuito do [Upstash Redis](https://upstash.com/) via REST API) são usadas apenas para persistir exclusões e correções de eventos — nenhuma outra parte do sistema depende de banco de dados.

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

---

## 👤 Autoria

Projeto idealizado, desenvolvido e mantido por **Diogo Nascimento** (equipe de SDR), nascido de uma necessidade real de auditoria comercial e evoluído módulo a módulo — deduplicação, alertas de confiabilidade, correção de eventos — conforme os impasses foram aparecendo na operação do dia a dia.

- ✉️ [diogocoding@gmail.com](mailto:diogocoding@gmail.com)
- 💻 [github.com/diogocoding](https://github.com/diogocoding)
