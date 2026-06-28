const API_URL = "https://dashboardkommo.onrender.com";

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
};

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
    const tempoLabel = tempo !== null && tempo !== undefined ? `<span class="text-slate-500 text-[10px] ml-2">${tempo}d médio</span>` : "";
    const row = document.createElement("div");
    row.className = "flex items-center gap-3 group";
    row.innerHTML = `
      <div class="w-36 text-[11px] text-slate-400 truncate text-right font-medium" title="${nome}">${nome}</div>
      <div class="flex-1 h-5 bg-slate-900 rounded overflow-hidden relative">
        <div class="funil-bar h-full" style="width:${pct}%;background:${cor};opacity:0.85"></div>
      </div>
      <div class="text-sm font-bold text-white w-8 text-right">${total}${tempoLabel}</div>
    `;
    container.appendChild(row);
  });
}

// ── Tabela de leads
function renderTabelaLeads(leads) {
  _leadsGlobal = leads;
  aplicarFiltroLeads();
}

function aplicarFiltroLeads() {
  const query = (document.getElementById("searchLeads")?.value || "").toLowerCase();
  const filtrados = _leadsGlobal.filter(l =>
    l.name.toLowerCase().includes(query) ||
    l.etapa_atual.toLowerCase().includes(query) ||
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
      ? l.tags.map(t => `<span class="bg-slate-800 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-medium">${t}</span>`).join(" ")
      : '<span class="text-slate-600 text-[10px]">—</span>';
    const corEtapa = CORES_ETAPA[l.etapa_atual] || "#94a3b8";
    const alertaNome = l.nomeSinalizado ? "text-rose-400" : "text-slate-200";
    return `
      <tr class="hover:bg-slate-900/30 transition">
        <td class="px-5 py-2.5 ${alertaNome} text-sm max-w-[180px] truncate" title="${l.name}">${l.name}</td>
        <td class="px-5 py-2.5 text-slate-400 text-xs font-mono">${l.telefone || "—"}</td>
        <td class="px-5 py-2.5">
          <span class="text-[11px] font-bold px-2 py-0.5 rounded-md" style="background:${corEtapa}18;color:${corEtapa};border:1px solid ${corEtapa}30">${l.etapa_atual}</span>
        </td>
        <td class="px-5 py-2.5">${tagsHtml}</td>
        <td class="px-5 py-2.5 text-right text-xs text-slate-400">${data}</td>
      </tr>`;
  }).join("");
}

// ── Exportar CSV
function exportarCSV() {
  if (!_leadsGlobal.length) { alert("Nenhum lead para exportar."); return; }
  const cabecalho = ["Nome", "Telefone", "Etapa Atual", "Tags", "Última Atualização"];
  const linhas = _leadsGlobal.map(l => [
    `"${l.name.replace(/"/g, '""')}"`,
    l.telefone || "",
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
  if (!tags?.length) { container.innerHTML = '<p class="text-xs text-slate-500">Nenhuma tag encontrada.</p>'; return; }
  const maximo = tags[0].count;
  container.innerHTML = tags.map(({ tag, count }, i) => {
    const pct = Math.round((count / maximo) * 100);
    const medalhas = ["🥇", "🥈", "🥉"];
    return `
      <div>
        <div class="flex justify-between items-center mb-1">
          <span class="text-[11px] text-slate-300 font-medium truncate">${medalhas[i] || "·"} ${tag}</span>
          <span class="text-[10px] text-slate-400 font-bold ml-2">${count}</span>
        </div>
        <div class="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full rounded-full bg-amber-500/70 transition-all duration-700" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join("");
}

// ── Taxas de Conversão entre Etapas
function renderTaxasConversao(taxas) {
  const container = document.getElementById("taxasConversao");
  if (!container) return;
  if (!taxas?.length) { container.innerHTML = '<p class="text-xs text-slate-500">Sem dados de conversão.</p>'; return; }

  const relevantes = taxas.filter(t => t.total > 0).slice(0, 8);
  container.innerHTML = relevantes.map(t => {
    const cor = t.taxa >= 50 ? "text-emerald-400" : t.taxa >= 25 ? "text-amber-400" : "text-rose-400";
    const bgCor = t.taxa >= 50 ? "bg-emerald-500/10" : t.taxa >= 25 ? "bg-amber-500/10" : "bg-rose-500/10";
    return `
      <div class="flex items-center justify-between gap-2 py-1.5 border-b border-slate-800/40 last:border-0">
        <div class="flex-1 min-w-0">
          <span class="text-slate-400 truncate block text-[10px]">${t.origem}</span>
          <div class="flex items-center gap-1">
            <i class="ti ti-arrow-right text-slate-600 text-[10px]"></i>
            <span class="text-slate-300 truncate text-[10px]">${t.destino}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] text-slate-500">${t.total}x</span>
          <span class="${cor} ${bgCor} text-[11px] font-black px-2 py-0.5 rounded-md">${t.taxa}%</span>
        </div>
      </div>`;
  }).join("");
}

// ── Leads Frios
function renderLeadsFrios(lista) {
  const container = document.getElementById("listaLeadsFrios");
  const badge = document.getElementById("badgeLeadsFrios");
  if (!container) return;
  if (badge) badge.textContent = lista?.length || 0;
  if (!lista?.length) { container.innerHTML = '<p class="text-xs text-slate-500">Nenhum lead frio ativo.</p>'; return; }
  container.innerHTML = lista.map(l => `
    <div class="bg-slate-900/50 border border-slate-800/40 rounded-lg p-2.5">
      <p class="text-[11px] font-semibold text-slate-200 truncate">${l.name}</p>
      <div class="flex justify-between items-center mt-1">
        <span class="text-[10px] text-slate-500">${l.etapa_atual}</span>
        <span class="text-[10px] font-bold text-amber-400">${l.diasParado}d parado</span>
      </div>
    </div>`).join("");
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
    set("taxaNoShow", `${s.porcentagemNoShow ?? 0}%`);
    set("cardReengajamentos", s.totalReengajamentos ?? 0);
    set("cardRealizadas", s.realizadas ?? 0);
    set("cardAgendadasTotal", s.agendadasTotal ?? 0);
    set("subAgendadasNovas", s.agendadasNovas ?? 0);
    set("subReagendamentos", s.reagendamentos ?? 0);

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

    // ── GRÁFICO DO FUNIL
    if (data.breakdownFunil) renderGraficoFunil(data.breakdownFunil, data.tempoMedioPorEtapa);

    // ── TABELA DO FUNIL ORIGINAL
    const tabelaFunil = document.getElementById("corpoFunil");
    if (tabelaFunil && data.breakdownFunil) {
      tabelaFunil.innerHTML = "";
      Object.entries(data.breakdownFunil).forEach(([nomeEtapa, totalLeads]) => {
        let destaqueClasse = "text-slate-300";
        if (nomeEtapa === "CONTRATO FECHADO") destaqueClasse = "text-emerald-400 font-bold";
        if (nomeEtapa === "MARCAÇÃO DE REUNIÃO") destaqueClasse = "text-blue-400 font-semibold";
        tabelaFunil.innerHTML += `
          <tr class="hover:bg-slate-900/30 transition">
            <td class="py-2.5 ${destaqueClasse}">${nomeEtapa}</td>
            <td class="py-2.5 text-right font-bold text-white">${totalLeads}</td>
          </tr>`;
      });
    }

    // ── RANKING TAGS
    renderRankingTags(data.rankingTags);

    // ── TAXAS DE CONVERSÃO
    renderTaxasConversao(data.taxasConversaoFunil);

    // ── LEADS FRIOS
    renderLeadsFrios(data.leadsFriosAtivos);

    // ── TABELA DE LEADS
    if (data.listagem) renderTabelaLeads(data.listagem);

  } catch (err) {
    console.error("Erro ao processar atualização:", err);
  } finally {
    if (btnFiltrar) { btnFiltrar.disabled = false; btnFiltrar.innerHTML = '<i class="ti ti-filter-check"></i> Filtrar'; }
  }
}

// ── EVENT LISTENERS
document.getElementById("btnFiltrar")?.addEventListener("click", atualizarPainel);
document.getElementById("btnExportarCSV")?.addEventListener("click", exportarCSV);
document.getElementById("searchLeads")?.addEventListener("input", aplicarFiltroLeads);

// ── CARGA INICIAL
atualizarPainel();
