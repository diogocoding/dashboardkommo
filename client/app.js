const API_URL = "https://dashboardkommo.onrender.com";

// Autenticação agora é feita pelo Cloudflare Access, antes da página carregar.
// Não há mais gate de senha no código do cliente.

const inputStart = document.getElementById("startDate");
const inputEnd = document.getElementById("endDate");

const hoje = new Date();
const ano = hoje.getFullYear();
const mes = String(hoje.getMonth() + 1).padStart(2, "0");
const dia = String(hoje.getDate()).padStart(2, "0");

if (inputStart) inputStart.value = `${ano}-${mes}-01`;
if (inputEnd) inputEnd.value = `${ano}-${mes}-${dia}`;

// ── Referência global dos leads para busca e export
let _leadsGlobal = [];
let _leadsFriosGlobal = [];

// ── Cores por etapa para o gráfico
const CORES_ETAPA = {
  "CONTRATO FECHADO": "#10b981",
  "MARCAÇÃO DE REUNIÃO": "#60a5fa",
  "CLIENTE QUENTE": "#f59e0b",
  "protocolo farmer": "#a78bfa",
  "protocolo farmer - ADIPLENTE": "#c4b5fd",
  "LEADS QUALIFICADOS": "#38bdf8",
  "QUALIFICAÇÃO": "#94a3b8",
  "NO SHOW": "#f87171",
  "CLIENTE SEM INTERESSE": "#64748b",
  "CLIENTE FRIO": "#334155",
  "ETAPA DE ENTRADA": "#475569",
  "CONTATO INICIAL": "#52525b",
  "CONTATO INICIADO": "#0ea5e9",
  "INTERESSADOS": "#fbbf24",
  "INVÁLIDOS": "#7f1d1d",
  "DESQUALIFICADOS": "#9f1239",
};

// ── Gauge circular de Aproveitamento
const GAUGE_CIRCUNFERENCIA = 2 * Math.PI * 42; // r=42

// ── Barra de progresso com cor dinâmica
function setProgressBar(barId, valor, meta) {
  const el = document.getElementById(barId);
  if (!el) return;
  const pct = Math.min(Math.round((valor / meta) * 100), 100);
  el.style.width = pct + "%";
  if (pct >= 100) el.classList.add("bg-emerald-400"), el.classList.remove("bg-amber-500", "bg-rose-500");
  else if (pct >= 60) el.classList.add("bg-amber-500"), el.classList.remove("bg-emerald-400", "bg-rose-500");
  else el.classList.add("bg-rose-500"), el.classList.remove("bg-emerald-400", "bg-amber-500");
}

// ── Gráfico de barras horizontal do funil
function renderGraficoFunil(breakdownFunil, tempoMedioPorEtapa) {
  const container = document.getElementById("graficoFunil");
  if (!container) return;
  const entradas = Object.entries(breakdownFunil).filter(([, v]) => v > 0);
  if (!entradas.length) { container.innerHTML = '<p class="text-xs text-slate-500">Sem dados.</p>'; return; }
  const maximo = Math.max(...entradas.map(([, v]) => v), 1);
  entradas.sort((a, b) => b[1] - a[1]);
  container.innerHTML = "";
  entradas.forEach(([nome, total]) => {
    const pct = Math.round((total / maximo) * 100);
    const cor = CORES_ETAPA[nome] || "#64748b";
    const tempo = tempoMedioPorEtapa?.[nome];
    const tempoLabel = tempo !== null && tempo !== undefined ? `<span class="text-inkfaint font-mono text-[10px] ml-2">${tempo}d médio</span>` : "";
    const row = document.createElement("div");
    row.className = "flex items-center gap-3 group";
    row.innerHTML = `
      <div class="w-40 text-[10px] font-mono uppercase tracking-wide text-inkdim truncate text-right" title="${nome}">${nome}</div>
      <div class="flex-1 h-4 bg-surface2 relative">
        <div class="funil-bar h-full" style="width:${pct}%;background:${cor};opacity:0.9"></div>
      </div>
      <div class="text-sm font-serif font-bold text-ink w-10 text-right tabular">${total}${tempoLabel}</div>
    `;
    container.appendChild(row);
  });
}

// ── Ordem canônica do funil (jornada do lead) — usada pelo gráfico de linha do período.
// Definida aqui porque o ETAPAS_IDS completo só existe no server.js.
const ORDEM_FUNIL = [
  "ETAPA DE ENTRADA",
  "CONTATO INICIAL",
  "CONTATO INICIADO",
  "INTERESSADOS",
  "MARCAÇÃO DE REUNIÃO",
  "QUALIFICAÇÃO",
  "LEADS QUALIFICADOS",
  "protocolo farmer",
  "protocolo farmer - ADIPLENTE",
  "CLIENTE QUENTE",
  "CONTRATO FECHADO",
  "NO SHOW",
  "CLIENTE SEM INTERESSE",
  "CLIENTE FRIO",
  "INVÁLIDOS",
  "DESQUALIFICADOS",
];

// ── Categoria de cada etapa (para colorir o gráfico de linha por natureza do resultado)
// neutra   = ainda em triagem/contato inicial, sem sinal de avanço ou perda
// positiva = sinaliza avanço no funil rumo ao fechamento
// sucesso  = desfecho final positivo (contrato fechado)
// negativa = desfecho de perda (ativo ou terminal)
const CATEGORIA_ETAPA = {
  "ETAPA DE ENTRADA": "neutra",
  "CONTATO INICIAL": "neutra",
  "CONTATO INICIADO": "neutra",
  "INTERESSADOS": "positiva",
  "MARCAÇÃO DE REUNIÃO": "positiva",
  "QUALIFICAÇÃO": "positiva",
  "LEADS QUALIFICADOS": "positiva",
  "protocolo farmer": "positiva",
  "protocolo farmer - ADIPLENTE": "positiva",
  "CLIENTE QUENTE": "positiva",
  "CONTRATO FECHADO": "sucesso",
  "NO SHOW": "negativa",
  "CLIENTE SEM INTERESSE": "negativa",
  "CLIENTE FRIO": "negativa",
  "INVÁLIDOS": "negativa",
  "DESQUALIFICADOS": "negativa",
};
const CORES_CATEGORIA = {
  neutra: "#8d8f9b",
  positiva: "#b6923f",
  sucesso: "#4ade80",
  negativa: "#f87171",
};
function corCategoria(nomeEtapa) {
  return CORES_CATEGORIA[CATEGORIA_ETAPA[nomeEtapa] || "neutra"];
}

// ── Distribuição dos leads movimentados no período, por etapa atual (linha, muda com o filtro)
function renderDistribuicaoPeriodo(leads) {
  const container = document.getElementById("graficoFunilPeriodo");
  if (!container) return;
  if (!leads?.length) { container.innerHTML = '<p class="text-xs text-inkdim">Nenhum lead movimentado no período selecionado.</p>'; return; }

  const contagem = {};
  leads.forEach(l => { contagem[l.etapaNoPeriodo || l.etapa_atual] = (contagem[l.etapaNoPeriodo || l.etapa_atual] || 0) + 1; });

  // Eixo X segue a ordem real do funil (jornada do lead), não o volume —
  // é isso que dá a um gráfico de linha um formato que significa algo.
  // Qualquer etapa que apareça nos dados mas não esteja mapeada acima
  // entra no fim, em vez de quebrar o gráfico.
  const nomesConhecidos = new Set(ORDEM_FUNIL);
  const extras = Object.keys(contagem).filter(n => !nomesConhecidos.has(n));
  const pontos = [...ORDEM_FUNIL, ...extras]
    .map(nome => ({ nome, total: contagem[nome] || 0 }))
    .filter(p => p.total > 0 || p.nome === "CONTRATO FECHADO");

  if (!pontos.length) { container.innerHTML = '<p class="text-xs text-inkdim">Sem dados suficientes no período.</p>'; return; }

  const W = 900, H = 260, ML = 60, MR = 16, MT = 26, MB = 96;
  const areaW = W - ML - MR, areaH = H - MT - MB;
  const maximo = Math.max(...pontos.map(p => p.total), 1);
  const passoX = pontos.length > 1 ? areaW / (pontos.length - 1) : 0;

  const coords = pontos.map((p, i) => ({
    ...p,
    x: ML + (pontos.length > 1 ? i * passoX : areaW / 2),
    y: MT + areaH - (p.total / maximo) * areaH,
    cor: corCategoria(p.nome),
  }));

  const base = MT + areaH;

  // Um segmento de reta por par de pontos, colorido pela categoria da etapa
  // de destino — assim dá para ver visualmente onde o fluxo "vira" positivo,
  // neutro ou de perda, em vez de uma única cor para o funil inteiro.
  const segmentos = coords.slice(1).map((c, i) => {
    const anterior = coords[i];
    return `<line x1="${anterior.x.toFixed(1)}" y1="${anterior.y.toFixed(1)}" x2="${c.x.toFixed(1)}" y2="${c.y.toFixed(1)}" stroke="${c.cor}" stroke-width="2"/>`;
  }).join("");

  const marcadores = coords.map(c => `
    <text x="${c.x.toFixed(1)}" y="${(c.y - 12).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="600" fill="#e9e7de">${c.total}</text>
    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="#0a0b10" stroke="${c.cor}" stroke-width="2.5"/>
    <g transform="translate(${c.x.toFixed(1)},${(base + 10).toFixed(1)}) rotate(-55)">
      <title>${c.nome}</title>
      <text text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing="0.02em" fill="${c.cor}">${c.nome}</text>
    </g>
  `).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" preserveAspectRatio="xMidYMid meet">
      <line x1="${ML}" y1="${base}" x2="${W - MR}" y2="${base}" stroke="#1c1e29" stroke-width="1"/>
      ${segmentos}
      ${marcadores}
    </svg>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] font-mono text-inkdim">
      <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${CORES_CATEGORIA.neutra}"></span>Triagem inicial</span>
      <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${CORES_CATEGORIA.positiva}"></span>Avanço no funil</span>
      <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${CORES_CATEGORIA.sucesso}"></span>Contrato fechado</span>
      <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${CORES_CATEGORIA.negativa}"></span>Perda</span>
    </div>
  `;
}

// ── Tabela de leads
function renderTabelaLeads(leads) {
  _leadsGlobal = leads;
  renderDistribuicaoPeriodo(leads);
  aplicarFiltroLeads();
}

function aplicarFiltroLeads() {
  const query = (document.getElementById("searchLeads")?.value || "").toLowerCase();
  const filtrados = _leadsGlobal.filter(l =>
    l.name.toLowerCase().includes(query) ||
    l.etapa_atual.toLowerCase().includes(query) ||
    (l.etapaNoPeriodo || "").toLowerCase().includes(query) ||
    l.telefone.includes(query)
  );
  const tbody = document.getElementById("corpoTabelaLeads");
  if (!tbody) return;
  const badge = document.getElementById("badgeTotalLeads");
  if (badge) badge.textContent = filtrados.length;

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-slate-500 text-xs">Nenhum lead encontrado para o período.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(l => {
    const data = l.updated_at ? new Date(l.updated_at * 1000).toLocaleDateString("pt-BR") : "—";
    const tagsHtml = l.tags?.length
      ? l.tags.map(t => `<span class="bg-surface2 text-inkdim text-[10px] px-1.5 py-0.5 font-mono">${t}</span>`).join(" ")
      : '<span class="text-inkfaint text-[10px]">—</span>';
    const etapaExibida = l.etapaNoPeriodo || l.etapa_atual;
    const corEtapa = CORES_ETAPA[etapaExibida] || "#94a3b8";
    const alertaNome = l.nomeSinalizado ? "text-rose-400" : "text-ink";
    const avancouDepois = l.etapaNoPeriodo && l.etapaNoPeriodo !== l.etapa_atual;
    return `
      <tr class="hover:bg-surface2/60 transition">
        <td class="px-5 py-2.5 ${alertaNome} text-sm max-w-[180px] truncate" title="${l.name}">${l.name}</td>
        <td class="px-5 py-2.5 text-inkdim text-xs font-mono">${l.telefone || "—"}</td>
        <td class="px-5 py-2.5">
          <span class="text-[11px] font-bold px-2 py-0.5" style="background:${corEtapa}18;color:${corEtapa};border:1px solid ${corEtapa}30">${etapaExibida}</span>
          ${avancouDepois ? `<div class="text-[9px] text-inkfaint mt-0.5">hoje em: ${l.etapa_atual}</div>` : ""}
        </td>
        <td class="px-5 py-2.5">${tagsHtml}</td>
        <td class="px-5 py-2.5 text-right text-xs text-inkdim font-mono">${data}</td>
      </tr>`;
  }).join("");
}

// ── Exportar CSV
function exportarCSV() {
  if (!_leadsGlobal.length) { alert("Nenhum lead para exportar."); return; }
  const cabecalho = ["Nome", "Telefone", "Etapa no Período", "Etapa Atual (hoje)", "Tags", "Última Atualização"];
  const linhas = _leadsGlobal.map(l => [
    `"${l.name.replace(/"/g, '""')}"`,
    l.telefone || "",
    `"${l.etapaNoPeriodo || l.etapa_atual}"`,
    `"${l.etapa_atual}"`,
    `"${(l.tags || []).join(", ")}"`,
    l.updated_at ? new Date(l.updated_at * 1000).toLocaleDateString("pt-BR") : ""
  ].join(","));
  const csv = [cabecalho.join(","), ...linhas].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `leads_${inputStart?.value}_${inputEnd?.value}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Ranking de Tags
function renderRankingTags(tags) {
  const container = document.getElementById("rankingTags");
  if (!container) return;
  if (!tags?.length) { container.innerHTML = '<p class="text-xs text-inkdim">Nenhuma tag encontrada.</p>'; return; }
  const maximo = tags[0].count;
  container.innerHTML = tags.map(({ tag, count }, i) => {
    const pct = Math.round((count / maximo) * 100);
    return `
      <div>
        <div class="flex justify-between items-baseline mb-1">
          <span class="text-[11px] text-ink font-medium truncate"><span class="text-inkfaint font-mono">${String(i+1).padStart(2,"0")}</span> ${tag}</span>
          <span class="text-[10px] text-inkdim font-mono font-bold ml-2">${count}</span>
        </div>
        <div class="h-px bg-line">
          <div class="h-px bg-gold transition-all duration-700" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join("");
}

// ── Taxas de Conversão entre Etapas
function renderTaxasConversao(taxas) {
  const container = document.getElementById("taxasConversao");
  if (!container) return;
  if (!taxas?.length) { container.innerHTML = '<p class="text-xs text-inkdim">Sem dados de conversão.</p>'; return; }

  const relevantes = taxas.filter(t => t.total > 0).slice(0, 8);
  container.innerHTML = relevantes.map(t => {
    const cor = t.taxa >= 50 ? "text-emerald-400" : t.taxa >= 25 ? "text-gold" : "text-rose-400";
    return `
      <div class="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0">
        <div class="flex-1 min-w-0">
          <span class="text-inkdim truncate block text-[10px] font-mono">${t.origem}</span>
          <div class="flex items-center gap-1">
            <i class="ti ti-arrow-right text-inkfaint text-[10px]"></i>
            <span class="text-ink truncate text-[10px]">${t.destino}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] text-inkfaint font-mono">${t.total}x</span>
          <span class="${cor} text-[11px] font-serif font-bold">${t.taxa}%</span>
        </div>
      </div>`;
  }).join("");
}

// ── Conversão AMPLA entre etapas-chave (não-adjacente, ex.: Contato Iniciado → Leads Qualificados)
function renderFunilAmplo(funilAmplo) {
  const container = document.getElementById("graficoFunilAmplo");
  if (!container) return;
  if (!funilAmplo?.length) { container.innerHTML = '<p class="text-xs text-inkdim">Sem dados suficientes no período.</p>'; return; }

  container.innerHTML = funilAmplo.map(f => {
    const cor = f.taxa >= 50 ? "text-emerald-400" : f.taxa >= 25 ? "text-gold" : "text-rose-400";
    const barCor = f.taxa >= 50 ? "#3fae82" : f.taxa >= 25 ? "#b6923f" : "#c1584a";
    return `
      <div class="py-2 border-b border-line last:border-0">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <span class="text-[11px] text-ink font-medium truncate">${f.origem}</span>
            <i class="ti ti-arrow-right text-inkfaint text-[11px] shrink-0"></i>
            <span class="text-[11px] text-ink font-medium truncate">${f.destino}</span>
          </div>
          <span class="${cor} text-[11px] font-serif font-bold shrink-0">${f.taxa}%</span>
        </div>
        <div class="h-px bg-line">
          <div class="h-px transition-all duration-700" style="width:${f.taxa}%;background:${barCor}"></div>
        </div>
        <p class="text-[10px] text-inkfaint font-mono mt-1">${f.chegaram} de ${f.entraram} leads chegaram</p>
      </div>`;
  }).join("");
}

// ── Exportar histórico completo de mudanças de etapa (sem corte de 100, com sinalização de exclusões)
async function exportarHistoricoCompleto() {
  const inicio = inputStart?.value;
  const fim = inputEnd?.value;
  if (!inicio || !fim) { alert("Selecione o período primeiro."); return; }

  const btn = document.getElementById("btnExportarHistorico");
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 animate-spin"></i> Gerando...'; }

  try {
    const res = await fetch(`${API_URL}/api/historico-completo?inicio=${inicio}&fim=${fim}`);
    const data = await res.json();
    if (data.error) { alert("Erro ao gerar histórico: " + data.error); return; }
    if (!data.historico?.length) { alert("Nenhuma movimentação encontrada para o período."); return; }

    const escapar = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cabecalho = ["Lead ID", "Nome", "Telefone", "Data", "Etapa Origem", "Etapa Destino", "Excluído do Cálculo", "Motivo Exclusão"];
    const linhas = data.historico.map(h => [
      h.leadId,
      escapar(h.nome),
      h.telefone,
      escapar(new Date(h.data).toLocaleString("pt-BR")),
      escapar(h.etapaOrigem),
      escapar(h.etapaDestino),
      h.excluidoDoCalculo ? "Sim" : "Não",
      escapar(h.motivoExclusao),
    ].join(","));

    const csv = [cabecalho.join(","), ...linhas].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `historico_completo_${inicio}_${fim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Erro ao exportar histórico completo:", err);
    alert("Erro ao exportar histórico completo.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-history"></i> Histórico Completo'; }
  }
}

// ── Card auxiliar: Para onde vão os leads de cada etapa (todos os destinos)
let _destinosPorEtapaGlobal = {};
let _saidasPorEtapaGlobal = {};

function renderDestinosPorEtapa() {
  const seletor = document.getElementById("seletorEtapaOrigem");
  const container = document.getElementById("destinosPorEtapaContainer");
  if (!seletor || !container) return;

  const origem = seletor.value;
  const lista = _destinosPorEtapaGlobal[origem] || [];

  if (!lista.length) {
    container.innerHTML = '<p class="text-xs text-inkdim">Nenhuma movimentação registrada para esta etapa no período.</p>';
    return;
  }

  const totalSaidas = _saidasPorEtapaGlobal[origem] || lista.reduce((acc, d) => acc + d.total, 0);
  const somaTaxas = lista.reduce((acc, d) => acc + d.taxa, 0);

  container.innerHTML = `
    <p class="text-[10px] text-inkfaint font-mono mb-2">${totalSaidas} saída(s) no período · soma das taxas: ${somaTaxas}%</p>
    ${lista.map(d => {
      const cor = d.taxa >= 50 ? "text-emerald-400" : d.taxa >= 25 ? "text-gold" : "text-rose-400";
      const corEtapa = CORES_ETAPA[d.destino] || "#94a3b8";
      return `
        <div class="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0">
          <div class="flex items-center gap-1.5 flex-1 min-w-0">
            <i class="ti ti-arrow-right text-inkfaint text-[10px]"></i>
            <span class="text-[11px] font-bold px-1.5 py-0.5 truncate" style="background:${corEtapa}18;color:${corEtapa};border:1px solid ${corEtapa}30">${d.destino}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[10px] text-inkfaint font-mono">${d.total}x</span>
            <span class="${cor} text-[11px] font-serif font-bold">${d.taxa}%</span>
          </div>
        </div>`;
    }).join("")}
  `;
}

function popularSeletorEtapaOrigem(destinosPorEtapa, saidasPorEtapa) {
  _destinosPorEtapaGlobal = destinosPorEtapa || {};
  _saidasPorEtapaGlobal = saidasPorEtapa || {};

  const seletor = document.getElementById("seletorEtapaOrigem");
  if (!seletor) return;

  // Ordena etapas de origem pelo total de saídas (mais movimentadas primeiro)
  const origens = Object.keys(_destinosPorEtapaGlobal).sort(
    (a, b) => (_saidasPorEtapaGlobal[b] || 0) - (_saidasPorEtapaGlobal[a] || 0)
  );

  if (!origens.length) {
    seletor.innerHTML = '<option value="">Sem dados</option>';
    renderDestinosPorEtapa();
    return;
  }

  const valorAnterior = seletor.value;
  seletor.innerHTML = origens.map(o => `<option value="${o}">${o}</option>`).join("");
  // Mantém a seleção anterior se ainda existir, senão usa a primeira etapa
  seletor.value = origens.includes(valorAnterior) ? valorAnterior : origens[0];

  renderDestinosPorEtapa();
}

if (document.getElementById("seletorEtapaOrigem")) {
  document.getElementById("seletorEtapaOrigem").addEventListener("change", renderDestinosPorEtapa);
}

// ── Leads Frios
function renderLeadsFrios(lista) {
  _leadsFriosGlobal = lista || [];


  _leadsFriosGlobal = lista || [];
  const container = document.getElementById("listaLeadsFrios");
  const badge = document.getElementById("badgeLeadsFrios");
  if (!container) return;
  if (badge) badge.textContent = _leadsFriosGlobal.length;
  console.log(`[Leads Frios] Total recebido do servidor: ${_leadsFriosGlobal.length}`);
  if (!_leadsFriosGlobal.length) { container.innerHTML = '<p class="text-xs text-inkdim">Nenhum lead frio ativo.</p>'; return; }
  container.innerHTML = _leadsFriosGlobal.slice(0, 20).map(l => `
    <div class="border border-line p-2.5">
      <p class="text-[11px] font-semibold text-ink truncate">${l.name}</p>
      <div class="flex justify-between items-center mt-1">
        <span class="text-[10px] text-inkdim">${l.etapa_atual}</span>
        <span class="text-[10px] font-mono font-bold text-gold">${l.diasParado}d parado</span>
      </div>
    </div>`).join("");
  if (_leadsFriosGlobal.length > 20) {
    container.innerHTML += `<p class="text-[10px] text-inkfaint text-center pt-2">+${_leadsFriosGlobal.length - 20} leads adicionais no CSV</p>`;
  }
}

// ── Exportar CSV de Leads Frios
function exportarLeadsFrios() {
  if (!_leadsFriosGlobal.length) { alert("Nenhum lead frio para exportar. Clique em Filtrar primeiro."); return; }
  console.log(`[Export Frios] Exportando ${_leadsFriosGlobal.length} leads`);
  const cabecalho = ["Nome", "Telefone", "Etapa Atual", "Dias Parado"];
  const linhas = _leadsFriosGlobal.map(l => [
    `"${(l.name || "").replace(/"/g, '""')}"`,
    l.telefone || "",
    `"${l.etapa_atual}"`,
    l.diasParado
  ].join(","));
  const csv = [cabecalho.join(","), ...linhas].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `leads_frios_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Reuniões em Aberto (agendadas no período, ainda sem desfecho)
let _reunioesEmAbertoGlobal = [];
function renderReunioesEmAberto(lista) {
  _reunioesEmAbertoGlobal = lista || [];
  const container = document.getElementById("listaReunioesEmAberto");
  const badge = document.getElementById("badgeReunioesEmAberto");
  if (!container) return;
  if (badge) badge.textContent = _reunioesEmAbertoGlobal.length;
  if (!_reunioesEmAbertoGlobal.length) {
    container.innerHTML = '<p class="text-xs text-inkdim">Nenhuma reunião em aberto — todas as agendadas do período já têm desfecho.</p>';
    return;
  }
  const formatarData = (iso) => {
    try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return "—"; }
  };
  container.innerHTML = _reunioesEmAbertoGlobal.slice(0, 20).map(l => `
    <div class="border border-line p-2.5">
      <p class="text-[11px] font-semibold text-ink truncate">${l.name}</p>
      <div class="flex justify-between items-center mt-1">
        <span class="text-[10px] text-inkdim font-mono">${formatarData(l.dataAgendamento)}</span>
        <span class="text-[10px] font-mono font-bold text-gold">${l.diasDesdeAgendamento}d aguardando</span>
      </div>
    </div>`).join("");
  if (_reunioesEmAbertoGlobal.length > 20) {
    container.innerHTML += `<p class="text-[10px] text-inkfaint text-center pt-2 col-span-full">+${_reunioesEmAbertoGlobal.length - 20} reuniões adicionais</p>`;
  }
}

function exportarReunioesEmAberto() {
  if (!_reunioesEmAbertoGlobal.length) { alert("Nenhuma reunião em aberto para exportar. Clique em Filtrar primeiro."); return; }
  const cabecalho = ["Nome", "Telefone", "Data do Agendamento", "Dias Aguardando"];
  const linhas = _reunioesEmAbertoGlobal.map(l => [
    `"${(l.name || "").replace(/"/g, '""')}"`,
    l.telefone || "",
    new Date(l.dataAgendamento).toLocaleDateString("pt-BR"),
    l.diasDesdeAgendamento
  ].join(","));
  const csv = [cabecalho.join(","), ...linhas].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `reunioes_em_aberto_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── ATUALIZAÇÃO PRINCIPAL DO PAINEL
async function atualizarPainel() {
  const btnFiltrar = document.getElementById("btnFiltrar");
  if (btnFiltrar) { btnFiltrar.disabled = true; btnFiltrar.innerHTML = '<i class="ti ti-loader-2 animate-spin"></i> Carregando...'; }

  try {
    const res = await fetch(`${API_URL}/api/metrics?inicio=${inputStart.value}&fim=${inputEnd.value}`);
    const data = await res.json();

    if (data.error) { console.error("Erro do backend:", data.error); return; }

    const s = data.summary || {};

    // ── KPIs ORIGINAIS
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set("taxaAproveitamento", `${s.porcentagemAproveitamento ?? 0}%`);
    const gauge = document.getElementById("gaugeAproveitamento");
    if (gauge) {
      const pctGauge = Math.max(0, Math.min(100, s.porcentagemAproveitamento ?? 0));
      gauge.setAttribute("stroke-dasharray", `${(pctGauge / 100) * GAUGE_CIRCUNFERENCIA} ${GAUGE_CIRCUNFERENCIA}`);
    }
    set("taxaNoShow", `${s.porcentagemNoShow ?? 0}%`);
    set("cardReengajamentos", s.totalReengajamentos ?? 0);
    set("cardRealizadas", s.realizadas ?? 0);
    set("cardDesfechos", s.desfechosNoPeriodo ?? 0);
    set("cardAgendadasTotal", s.agendadasTotal ?? 0);
    set("subAgendadasNovas", s.agendadasNovas ?? 0);
    set("subReagendamentos", s.reagendamentos ?? 0);

    // ── AVISO: REUNIÕES AINDA SEM DESFECHO NO PERÍODO
    const avisoEl = document.getElementById("avisoEmAberto");
    const avisoTextoEl = document.getElementById("avisoEmAbertoTexto");
    if (avisoEl && avisoTextoEl) {
      const emAberto = s.totalReunioesEmAberto ?? 0;
      if (emAberto > 0) {
        avisoTextoEl.textContent =
          `${emAberto} reunião(ões) agendada(s) no período ainda não tiveram desfecho (nem No Show, nem realizada) — ` +
          `${s.percentualEmAberto ?? 0}% das agendadas. As taxas de Aproveitamento e Absenteísmo acima podem mudar ` +
          `conforme essas reuniões forem concluídas.`;
        avisoEl.classList.remove("hidden");
      } else {
        avisoEl.classList.add("hidden");
      }
    }

    // ── METAS COM BARRAS DE PROGRESSO
    const agendados = s.agendadasTotal ?? 0;
    const contratos = s.contratosFechadosNoPeriodo ?? 0;
    set("metaAgendados", `${agendados} / 40`);
    set("metaContratos", `${contratos} / 5`);
    setProgressBar("barraAgendados", agendados, 40);
    const barraContratos = document.getElementById("barraContratos");
    if (barraContratos) {
      barraContratos.style.width = Math.min(Math.round((contratos / 5) * 100), 100) + "%";
      barraContratos.className = `progress-bar-inner h-full rounded-full ${contratos >= 5 ? "bg-emerald-400" : contratos >= 3 ? "bg-amber-500" : "bg-rose-500"}`;
    }

    // ── NOVOS — MÉDIO
    set("taxaConversaoSDR", `${s.taxaConversaoSDRContrato ?? 0}%`);
    const barraSDR = document.getElementById("barraConversaoSDR");
    if (barraSDR) barraSDR.style.width = Math.min(s.taxaConversaoSDRContrato ?? 0, 100) + "%";
    set("cardLeadsSemDados", s.leadsSemDados ?? 0);
    set("cardLeadsFrios", s.totalLeadsFriosAtivos ?? 0);

    // ── AVISO DISCRETO: eventos de leads removidos/mesclados no Kommo, que
    // não entram em NENHUMA métrica do painel (podem afetar qualquer card,
    // não só Agendados) — explica divergências com o CSV de histórico bruto
    const avisoIgnoradosEl = document.getElementById("avisoEventosIgnorados");
    const avisoIgnoradosTextoEl = document.getElementById("avisoEventosIgnoradosTexto");
    if (avisoIgnoradosEl && avisoIgnoradosTextoEl) {
      const totalIgnorados = s.eventosIgnoradosLeadRemovido ?? 0;
      const agendamentosIgnorados = s.agendamentosIgnoradosLeadRemovido ?? 0;
      if (totalIgnorados > 0) {
        const plural = totalIgnorados > 1 ? "eventos" : "evento";
        avisoIgnoradosTextoEl.textContent = `${totalIgnorados} ${plural} de lead(s) removido(s) do Kommo fora desta contagem`;
        let detalheAgendamentos = "";
        if (agendamentosIgnorados > 0) {
          detalheAgendamentos = ` Desses, ${agendamentosIgnorados} eram entradas em Marcação de Reunião ` +
            `(afetam Total de Agendados e Reagendamentos).`;
        }
        avisoIgnoradosEl.title =
          `${totalIgnorados} evento(s) no período pertencem a leads que não existem mais no Kommo ` +
          `(excluídos ou mesclados após o evento acontecer). Como não há como confirmar a etapa/dados ` +
          `atuais desses leads, eles são descartados de todas as métricas do painel — podem afetar ` +
          `qualquer card (agendamentos, no-show, conversões, etc.).${detalheAgendamentos} O CSV de ` +
          `histórico completo inclui esses eventos normalmente, por isso os totais podem divergir.`;
        avisoIgnoradosEl.classList.remove("hidden");
      } else {
        avisoIgnoradosEl.classList.add("hidden");
      }
    }

    // ── GRÁFICO DO FUNIL
    if (data.breakdownFunil) renderGraficoFunil(data.breakdownFunil, data.tempoMedioPorEtapa);

    // ── RANKING TAGS
    renderRankingTags(data.rankingTags);

    // ── TAXAS DE CONVERSÃO
    renderTaxasConversao(data.taxasConversaoFunil);
    popularSeletorEtapaOrigem(data.destinosPorEtapa, data.saidasPorEtapa);

    // ── CONVERSÃO AMPLA ENTRE ETAPAS-CHAVE (não-adjacente)
    renderFunilAmplo(data.funilAmplo);

    // ── LEADS FRIOS
    renderLeadsFrios(data.leadsFriosAtivos);
    renderReunioesEmAberto(data.leadsReunioesEmAberto);

    // ── TABELA DE LEADS
    if (data.listagem) renderTabelaLeads(data.listagem);

    // ── INDICADOR DE ÚLTIMA ATUALIZAÇÃO
    const elUltima = document.getElementById("ultimaAtualizacao");
    if (elUltima) {
      const agora = new Date();
      elUltima.textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }

  } catch (err) {
    console.error("Erro ao processar atualização:", err);
  } finally {
    if (btnFiltrar) { btnFiltrar.disabled = false; btnFiltrar.innerHTML = '<i class="ti ti-filter-check"></i> Filtrar'; }
  }
}

// ── EVENT LISTENERS
document.getElementById("btnFiltrar")?.addEventListener("click", atualizarPainel);
document.getElementById("btnExportarCSV")?.addEventListener("click", exportarCSV);
document.getElementById("btnExportarFrios")?.addEventListener("click", exportarLeadsFrios);
document.getElementById("btnExportarEmAberto")?.addEventListener("click", exportarReunioesEmAberto);
document.getElementById("btnExportarHistorico")?.addEventListener("click", exportarHistoricoCompleto);
document.getElementById("searchLeads")?.addEventListener("input", aplicarFiltroLeads);

// ── AUTO-REFRESH (a cada 5 minutos, sem interromper o uso manual)
const INTERVALO_AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutos
let _autoRefreshTimer = null;

function iniciarAutoRefresh() {
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
  _autoRefreshTimer = setInterval(() => {
    console.log("[Auto-refresh] Atualizando painel automaticamente...");
    atualizarPainel();
  }, INTERVALO_AUTO_REFRESH_MS);
}

// ── CARGA INICIAL (só roda de fato após autenticação)
function iniciarPainel() {
  atualizarPainel();
  iniciarAutoRefresh();
}

iniciarPainel();

// Pausa o auto-refresh se a aba ficar invisível por muito tempo, e retoma ao voltar
// (evita gastar requisições à toa quando ninguém está vendo, mas garante que volta fresco)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    atualizarPainel();
    iniciarAutoRefresh();
  }
});

// ── FERRAMENTA DE CORREÇÃO: movimentação errada no Kommo ────────────────────
// Uso excepcional/manutenção: quando um lead é movido para a etapa errada
// por engano e depois devolvido, isso deixa "sujeira" no histórico de eventos
// do Kommo (que não pode ser apagado). Aqui listamos os eventos daquele lead
// e permitimos excluir, com 1 clique, o evento errado do cálculo de métricas.
const modalCorrecao = document.getElementById("modalCorrecao");
const btnAbrirCorrecao = document.getElementById("btnAbrirCorrecao");
const btnFecharCorrecao = document.getElementById("btnFecharCorrecao");
const btnBuscarEventosCorrecao = document.getElementById("btnBuscarEventosCorrecao");
const inputLeadIdCorrecao = document.getElementById("inputLeadIdCorrecao");
const resultadoEventosCorrecao = document.getElementById("resultadoEventosCorrecao");

btnAbrirCorrecao?.addEventListener("click", () => {
  modalCorrecao.classList.remove("hidden");
  modalCorrecao.classList.add("flex");
  inputLeadIdCorrecao.value = "";
  resultadoEventosCorrecao.innerHTML = "";
  inputLeadIdCorrecao.focus();
});

function fecharModalCorrecao() {
  modalCorrecao.classList.add("hidden");
  modalCorrecao.classList.remove("flex");
}
btnFecharCorrecao?.addEventListener("click", fecharModalCorrecao);
modalCorrecao?.addEventListener("click", (e) => {
  if (e.target === modalCorrecao) fecharModalCorrecao();
});

async function buscarEventosDoLead() {
  const leadId = inputLeadIdCorrecao.value.trim();
  if (!leadId) return;
  resultadoEventosCorrecao.innerHTML = `<p class="text-inkdim">Buscando...</p>`;
  try {
    const res = await fetch(`${API_URL}/api/eventos-lead/${leadId}`);
    const data = await res.json();
    if (!data.eventos || data.eventos.length === 0) {
      resultadoEventosCorrecao.innerHTML = `<p class="text-inkdim">Nenhum evento de mudança de etapa encontrado para esse lead.</p>`;
      return;
    }
    resultadoEventosCorrecao.innerHTML = data.eventos.map((ev) => `
      <div class="flex items-center justify-between gap-2 border border-line px-3 py-2 ${ev.jaExcluido ? "opacity-50" : ""}">
        <div class="min-w-0">
          <p class="text-ink font-medium truncate">${ev.de} → ${ev.para}</p>
          <p class="text-inkfaint text-[10px] font-mono">${new Date(ev.data).toLocaleString("pt-BR")}</p>
        </div>
        ${ev.jaExcluido
          ? `<span class="text-[10px] text-inkfaint font-bold whitespace-nowrap">Já excluído</span>`
          : `<button data-event-id="${ev.eventId}" class="btnExcluirEvento shrink-0 border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 text-[11px] font-bold px-3 py-1.5 transition">Excluir do cálculo</button>`
        }
      </div>
    `).join("");

    document.querySelectorAll(".btnExcluirEvento").forEach((btn) => {
      btn.addEventListener("click", () => excluirEventoCorrecao(btn.dataset.eventId, leadId));
    });
  } catch (err) {
    resultadoEventosCorrecao.innerHTML = `<p class="text-rose-400">Erro ao buscar eventos. Verifique o ID e tente novamente.</p>`;
  }
}

async function excluirEventoCorrecao(eventId, leadId) {
  if (!confirm("Confirma que essa movimentação foi um engano e deve ser ignorada nas métricas?")) return;
  try {
    const res = await fetch(`${API_URL}/api/excluir-evento`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: String(eventId), motivo: "Corrigido via dashboard (movimentação errada)" }),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      throw new Error(erro.error || `Servidor retornou ${res.status}`);
    }
    await buscarEventosDoLead();
    atualizarPainel(); // recalcula as métricas já sem esse evento
  } catch (err) {
    alert(`Não foi possível excluir o evento: ${err.message}`);
  }
}

btnBuscarEventosCorrecao?.addEventListener("click", buscarEventosDoLead);
inputLeadIdCorrecao?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarEventosDoLead();
});
