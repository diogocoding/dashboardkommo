// gerenciamento-semana.js
// Fases 8 e 9 do sistema de acompanhamento de tráfego e leads — frontend.
//
// Cole este conteúdo DENTRO do app.js (não como arquivo separado — o
// projeto não usa módulos ES no client, só scripts soltos). Remova
// qualquer `import`/`export` se sobrar algum ao colar.
//
// Depende de containers HTML que ainda precisam existir na página (ver
// bloco HTML no final deste arquivo, como comentário) e do CSS/Tailwind já
// usado no resto do dashboard (cores CORES_ETAPA, classes eyebrow, etc.
// já existem no app.js principal).

// ── ESTADO GLOBAL DESTA FASE ─────────────────────────────────────────────
let _semanaAtualDetalhe = null; // registro completo (análise + decisões + observações + custo) da semana aberta no modal de gerenciamento

// ── MODAL: GERENCIAR SEMANA (custo, decisões, observações, excluir) ─────
async function abrirModalGerenciarSemana(inicio, fim) {
  const modal = document.getElementById("modalGerenciarSemana");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  document.getElementById("tituloModalSemana").textContent = `${inicio} a ${fim}`;
  modal.dataset.inicio = inicio;
  modal.dataset.fim = fim;

  const res = await fetch(`${API_URL}/api/trafego/semana?inicio=${inicio}&fim=${fim}`);
  if (!res.ok) { alert("Não foi possível carregar essa semana."); fecharModalGerenciarSemana(); return; }
  _semanaAtualDetalhe = await res.json();

  renderFormularioCusto();
  renderListaDecisoes();
  renderListaObservacoes();
}

function fecharModalGerenciarSemana() {
  const modal = document.getElementById("modalGerenciarSemana");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  _semanaAtualDetalhe = null;
}
document.getElementById("btnFecharModalSemana")?.addEventListener("click", fecharModalGerenciarSemana);

// ── FORMULÁRIO DE CUSTO — populado com os públicos/anúncios REAIS da semana ──
function renderFormularioCusto() {
  const container = document.getElementById("formularioCusto");
  if (!container || !_semanaAtualDetalhe) return;

  const custoSalvo = _semanaAtualDetalhe.custo || { orcamentoMensal: "", orcamentoDiarioTotal: "", brandingDiario: "", porAnuncio: [] };
  const custoPorChaveSalvo = new Map((custoSalvo.porAnuncio || []).map((c) => [c.grupo || c.anuncio, c.orcamentoDiario]));

  // Nomes REAIS de anúncio+público (conjunto de anúncio) que apareceram
  // nessa semana — cada combinação pode ter orçamento diário diferente,
  // mesmo sendo o mesmo anúncio (ex.: AD 10 em SP vs. AD 10 na região ampla).
  const conjuntosDaSemana = (_semanaAtualDetalhe.analise?.porAnuncioEPublico || []).map((g) => g.grupo);

  container.innerHTML = `
    <div class="grid grid-cols-3 gap-2 mb-3">
      <label class="block">
        <span class="text-inkfaint text-[10px]">Orçamento mensal (R$)</span>
        <input type="number" step="0.01" id="inputOrcamentoMensal" value="${custoSalvo.orcamentoMensal ?? ""}" class="w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">
      </label>
      <label class="block">
        <span class="text-inkfaint text-[10px]">Orçamento diário total (R$)</span>
        <input type="number" step="0.01" id="inputOrcamentoDiarioTotal" value="${custoSalvo.orcamentoDiarioTotal ?? ""}" class="w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">
      </label>
      <label class="block">
        <span class="text-inkfaint text-[10px]">Branding diário (R$)</span>
        <input type="number" step="0.01" id="inputBrandingDiario" value="${custoSalvo.brandingDiario ?? ""}" class="w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">
      </label>
    </div>
    <p class="eyebrow mb-2">Orçamento diário por conjunto de anúncio (anúncio + público)</p>
    ${conjuntosDaSemana.length === 0
      ? '<p class="text-xs text-inkdim">Nenhum conjunto de anúncio identificado nessa semana ainda.</p>'
      : conjuntosDaSemana.map((nome) => `
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[11px] text-ink flex-1 truncate" title="${nome}">${nome}</span>
          <input type="number" step="0.01" data-grupo="${nome}" class="inputCustoAnuncio w-28 bg-surface2 border border-line px-2 py-1 text-xs text-ink"
            value="${custoPorChaveSalvo.get(nome) ?? ""}" placeholder="R$/dia">
        </div>`).join("")
    }
    <button id="btnSalvarCustoSemana" class="mt-3 bg-gold hover:bg-goldbright transition font-bold px-4 py-1.5 text-bg text-xs uppercase tracking-wide">
      Salvar custo desta semana
    </button>
  `;

  document.getElementById("btnSalvarCustoSemana")?.addEventListener("click", salvarCustoDaSemanaAberta);
}

async function salvarCustoDaSemanaAberta() {
  const modal = document.getElementById("modalGerenciarSemana");
  const inicio = modal.dataset.inicio, fim = modal.dataset.fim;

  const porAnuncio = Array.from(document.querySelectorAll(".inputCustoAnuncio"))
    .filter((el) => el.value !== "")
    .map((el) => ({ grupo: el.dataset.grupo, orcamentoDiario: Number(el.value) }));

  const custo = {
    orcamentoMensal: Number(document.getElementById("inputOrcamentoMensal").value) || null,
    orcamentoDiarioTotal: Number(document.getElementById("inputOrcamentoDiarioTotal").value) || null,
    brandingDiario: Number(document.getElementById("inputBrandingDiario").value) || null,
    porAnuncio,
  };

  const btn = document.getElementById("btnSalvarCustoSemana");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
  try {
    const res = await fetch(`${API_URL}/api/trafego/custo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inicio, fim, custo }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Erro desconhecido.");
    alert("Custo salvo.");
    atualizarAnaliseTrafego(); // recarrega os gráficos já com o custo cruzado
  } catch (err) {
    alert(`Não foi possível salvar o custo: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Salvar custo desta semana"; }
  }
}

// ── DECISÕES ──────────────────────────────────────────────────────────
function renderListaDecisoes() {
  const container = document.getElementById("listaDecisoesModal");
  if (!container || !_semanaAtualDetalhe) return;
  const decisoes = _semanaAtualDetalhe.decisoes || [];
  container.innerHTML = (decisoes.length ? decisoes.map((d) => `
    <div class="flex items-start justify-between gap-2 border border-line p-2" data-decisao-id="${d.id}">
      <div class="min-w-0 flex-1">
        <p class="text-[11px] text-inkfaint font-mono">${new Date(d.criadoEm).toLocaleDateString("pt-BR")}</p>
        <p class="text-xs text-ink"><strong>${d.assunto || ""}:</strong> ${d.decisao || ""}</p>
      </div>
      <div class="flex gap-1 shrink-0">
        <button class="btnEditarDecisao text-inkdim hover:text-gold text-[11px]" data-id="${d.id}"><i class="ti ti-pencil"></i></button>
        <button class="btnExcluirDecisao text-inkdim hover:text-rose-400 text-[11px]" data-id="${d.id}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join("") : '<p class="text-xs text-inkdim">Nenhuma decisão registrada.</p>') + `
    <div class="flex gap-2 mt-2">
      <input id="inputNovoAssunto" placeholder="Assunto" class="w-28 bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">
      <input id="inputNovaDecisao" placeholder="Decisão tomada..." class="flex-1 bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">
      <button id="btnAdicionarDecisao" class="bg-gold hover:bg-goldbright text-bg text-xs font-bold px-3 py-1.5">+</button>
    </div>`;

  document.getElementById("btnAdicionarDecisao")?.addEventListener("click", async () => {
    const assunto = document.getElementById("inputNovoAssunto").value.trim();
    const decisao = document.getElementById("inputNovaDecisao").value.trim();
    if (!decisao) return;
    await chamarApiDecisaoObservacao("POST", "/api/trafego/decisao", { assunto, decisao });
  });
  container.querySelectorAll(".btnExcluirDecisao").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir esta decisão? Essa ação não pode ser desfeita.")) return;
      await chamarApiDecisaoObservacaoExcluir("/api/trafego/decisao", "decisaoId", btn.dataset.id);
    });
  });
  container.querySelectorAll(".btnEditarDecisao").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = _semanaAtualDetalhe.decisoes.find((x) => x.id === btn.dataset.id);
      const novoTexto = prompt("Editar decisão:", d.decisao);
      if (novoTexto === null) return;
      chamarApiDecisaoObservacao("PUT", "/api/trafego/decisao", { decisaoId: d.id, novosDados: { decisao: novoTexto } });
    });
  });
}

// ── OBSERVAÇÕES ───────────────────────────────────────────────────────
function renderListaObservacoes() {
  const container = document.getElementById("listaObservacoesModal");
  if (!container || !_semanaAtualDetalhe) return;
  const observacoes = _semanaAtualDetalhe.observacoes || [];
  container.innerHTML = (observacoes.length ? observacoes.map((o) => `
    <div class="flex items-start justify-between gap-2 border border-line p-2" data-observacao-id="${o.id}">
      <div class="min-w-0 flex-1">
        <p class="text-[11px] text-inkfaint font-mono">${new Date(o.criadoEm).toLocaleDateString("pt-BR")}</p>
        <p class="text-xs text-ink">${o.texto}</p>
      </div>
      <div class="flex gap-1 shrink-0">
        <button class="btnEditarObservacao text-inkdim hover:text-gold text-[11px]" data-id="${o.id}"><i class="ti ti-pencil"></i></button>
        <button class="btnExcluirObservacao text-inkdim hover:text-rose-400 text-[11px]" data-id="${o.id}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join("") : '<p class="text-xs text-inkdim">Nenhuma observação registrada.</p>') + `
    <div class="flex gap-2 mt-2">
      <input id="inputNovaObservacao" placeholder="Nova observação..." class="flex-1 bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">
      <button id="btnAdicionarObservacao" class="bg-gold hover:bg-goldbright text-bg text-xs font-bold px-3 py-1.5">+</button>
    </div>`;

  document.getElementById("btnAdicionarObservacao")?.addEventListener("click", async () => {
    const texto = document.getElementById("inputNovaObservacao").value.trim();
    if (!texto) return;
    await chamarApiDecisaoObservacao("POST", "/api/trafego/observacao", { texto });
  });
  container.querySelectorAll(".btnExcluirObservacao").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir esta observação? Essa ação não pode ser desfeita.")) return;
      await chamarApiDecisaoObservacaoExcluir("/api/trafego/observacao", "observacaoId", btn.dataset.id);
    });
  });
  container.querySelectorAll(".btnEditarObservacao").forEach((btn) => {
    btn.addEventListener("click", () => {
      const o = _semanaAtualDetalhe.observacoes.find((x) => x.id === btn.dataset.id);
      const novoTexto = prompt("Editar observação:", o.texto);
      if (novoTexto === null) return;
      chamarApiDecisaoObservacao("PUT", "/api/trafego/observacao", { observacaoId: o.id, texto: novoTexto });
    });
  });
}

async function chamarApiDecisaoObservacao(metodo, rota, corpoExtra) {
  const modal = document.getElementById("modalGerenciarSemana");
  const inicio = modal.dataset.inicio, fim = modal.dataset.fim;
  try {
    const res = await fetch(`${API_URL}${rota}`, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inicio, fim, ...corpoExtra }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Erro desconhecido.");
    _semanaAtualDetalhe = await res.json();
    renderListaDecisoes();
    renderListaObservacoes();
  } catch (err) {
    alert(`Não foi possível salvar: ${err.message}`);
  }
}

async function chamarApiDecisaoObservacaoExcluir(rota, nomeParametroId, id) {
  const modal = document.getElementById("modalGerenciarSemana");
  const inicio = modal.dataset.inicio, fim = modal.dataset.fim;
  try {
    const res = await fetch(`${API_URL}${rota}?inicio=${inicio}&fim=${fim}&${nomeParametroId}=${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json()).error || "Erro desconhecido.");
    _semanaAtualDetalhe = await res.json();
    renderListaDecisoes();
    renderListaObservacoes();
  } catch (err) {
    alert(`Não foi possível excluir: ${err.message}`);
  }
}

// ── EXCLUIR SEMANA (com confirmação) ─────────────────────────────────────
document.getElementById("btnExcluirSemanaModal")?.addEventListener("click", async () => {
  const modal = document.getElementById("modalGerenciarSemana");
  const inicio = modal.dataset.inicio, fim = modal.dataset.fim;
  if (!confirm(`Tem certeza que quer excluir a semana ${inicio} a ${fim}? Isso apaga a análise, decisões e observações — não pode ser desfeito.`)) return;
  try {
    const res = await fetch(`${API_URL}/api/trafego/semana?inicio=${inicio}&fim=${fim}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Falha ao excluir.");
    fecharModalGerenciarSemana();
    carregarSemanasSalvas();
  } catch (err) {
    alert("Não foi possível excluir a semana.");
  }
});

// ── GRÁFICO DE CUSTO — o que faltava: mostrar o custo calculado de verdade ──
// Busca /api/trafego/analise-com-custo (não o /api/analise-trafego comum),
// que é o único endpoint que já cruza o orçamento salvo com os números do
// Kommo. Sem isso, o custo salvo no formulário nunca aparecia em lugar
// nenhum — só ficava guardado, sem uso visual.
async function atualizarGraficoCusto() {
  const container = document.getElementById("graficoCusto");
  if (!container) return;
  try {
    const res = await fetch(`${API_URL}/api/trafego/analise-com-custo?inicio=${inputStart.value}&fim=${inputEnd.value}`);
    const data = await res.json();
    if (data.error) {
      container.innerHTML = `<p class="text-xs text-inkdim">${data.error === 'Semana não encontrada — salve a análise primeiro.' ? 'Salve esta semana no histórico primeiro (botão "Salvar semana atual") pra poder ver o custo.' : data.error}</p>`;
      return;
    }
    const grupos = (data.porAnuncio || []).filter((g) => g.custoPorLead !== null && g.custoPorLead !== undefined);
    if (!grupos.length) {
      container.innerHTML = '<p class="text-xs text-inkdim">Nenhum custo salvo ainda para este período — abra "Gerenciar" numa semana salva e preenche o orçamento por conjunto de anúncio.</p>';
      return;
    }
    const legenda = [];
    container.innerHTML = grupos.map((g, i) => {
      legenda.push(`<span class="text-[10px] text-inkdim"><strong class="text-gold">${i + 1}</strong> ${g.grupo}</span>`);
      return `
        <div class="border border-line p-3 mb-2">
          <p class="text-[11px] text-ink font-bold mb-1.5"><span class="text-gold">${i + 1}</span> — ${g.totalLeads} leads · ${g.qualificados} qualif.</p>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div><p class="text-[9px] text-inkfaint uppercase">Custo total</p><p class="text-sm font-serif font-bold text-ink">R$ ${g.custoTotal?.toFixed(2) ?? "—"}</p></div>
            <div><p class="text-[9px] text-inkfaint uppercase">Por lead</p><p class="text-sm font-serif font-bold text-goldbright">R$ ${g.custoPorLead?.toFixed(2) ?? "—"}</p></div>
            <div><p class="text-[9px] text-inkfaint uppercase">Por qualificado</p><p class="text-sm font-serif font-bold text-emerald-400">R$ ${g.custoPorQualificado?.toFixed(2) ?? "—"}</p></div>
          </div>
        </div>`;
    }).join("") + `<div class="flex flex-col gap-1 mt-2 pt-2 border-t border-line">${legenda.join("")}</div>`;
  } catch (err) {
    container.innerHTML = '<p class="text-xs text-rose-400">Erro ao carregar custo.</p>';
  }
}

// ── LEGENDA NUMERADA (resolve nomes cortados nos gráficos de barra) ──────
// Em vez de tentar caber o texto inteiro na barra (sempre corta em nomes
// longos), cada barra vira só um número — e uma legenda embaixo lista o
// nome completo de cada número. Mesmo padrão usado no gráfico de custo acima.
function renderGraficoBarraComLegenda(containerId, lista, opcoes = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!lista?.length) { container.innerHTML = '<p class="text-xs text-inkdim">Sem dados.</p>'; return; }

  const campo = opcoes.campo || "totalLeads";
  const maximo = Math.max(...lista.map((g) => g[campo]), 1);
  const cores = ["#b6923f", "#60a5fa", "#4ade80", "#f87171", "#a78bfa", "#fb923c", "#38bdf8"];

  const barras = lista.map((g, i) => {
    const pct = Math.round((g[campo] / maximo) * 100);
    const cor = cores[i % cores.length];
    return `
      <div class="flex items-center gap-3 group cursor-pointer barraGrupoClicavel" data-indice="${i}" data-container="${containerId}">
        <div class="w-6 text-[11px] font-mono font-bold text-right" style="color:${cor}">${i + 1}</div>
        <div class="flex-1 h-4 bg-surface2 relative">
          <div class="funil-bar h-full" style="width:${pct}%;background:${cor};opacity:0.9"></div>
        </div>
        <div class="text-sm font-serif font-bold text-ink w-10 text-right tabular">${g[campo]}</div>
      </div>`;
  }).join("");

  const legenda = lista.map((g, i) => {
    const cor = cores[i % cores.length];
    return `<div class="flex items-start gap-1.5 text-[10px] text-inkdim"><strong style="color:${cor}">${i + 1}</strong><span class="truncate" title="${g.grupo}">${g.grupo}</span></div>`;
  }).join("");

  container.innerHTML = `
    <div class="space-y-2">${barras}</div>
    <div class="grid grid-cols-1 gap-1 mt-3 pt-3 border-t border-line">${legenda}</div>`;

  container.querySelectorAll(".barraGrupoClicavel").forEach((el) => {
    el.addEventListener("click", () => abrirPainelDrillDown(lista[Number(el.dataset.indice)]));
  });
}

// ── GRÁFICO DE ENGAJAMENTO — com eixo Y visível, filtro de quantidade,
// toggle %/quantidade, e clique na bolinha abre "quem são esses leads".
// Ordena por ENGAJAMENTO (percentual da última etapa-marco), não por volume
// — "mais engajado" é sobre profundidade no funil, não sobre quantos leads.
const _engajamentoDataGlobal = {}; // containerId -> grupos já ordenados/limitados, pro clique achar os leads certos

function renderGraficoEngajamento(containerId, listaEngajamento, limiteGrupos, modo = "percentual") {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!listaEngajamento?.length) { container.innerHTML = '<p class="text-xs text-inkdim">Sem dados suficientes.</p>'; return; }

  const listaOrdenada = [...listaEngajamento].sort((a, b) => {
    const ultimoA = a.pontos[a.pontos.length - 1]?.percentual || 0;
    const ultimoB = b.pontos[b.pontos.length - 1]?.percentual || 0;
    return ultimoB - ultimoA;
  });
  const grupos = listaOrdenada.slice(0, limiteGrupos);
  _engajamentoDataGlobal[containerId] = grupos; // guardado pro clique na bolinha usar depois

  const cores = ["#0B2540", "#9C6A1F", "#2E6B44", "#B3462F", "#5B8AA6", "#8a5fb0", "#c14e8a"];
  const etapas = grupos[0].pontos.map((p) => p.etapa);
  const campo = modo === "quantidade" ? "quantidade" : "percentual";

  const W = 620, H = 280, ML = 34, MR = 16, MT = 20, MB = 70;
  const areaW = W - ML - MR, areaH = H - MT - MB;
  const passoX = etapas.length > 1 ? areaW / (etapas.length - 1) : 0;
  const base = MT + areaH;

  // Escala do eixo Y muda conforme o modo: % sempre vai de 0-100, quantidade
  // se ajusta ao maior valor real entre todos os grupos exibidos.
  const maximoY = modo === "quantidade"
    ? Math.max(...grupos.flatMap((g) => g.pontos.map((p) => p.quantidade)), 1)
    : 100;
  const passosMarcaY = modo === "quantidade"
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maximoY * f))
    : [0, 25, 50, 75, 100];

  const marcasY = passosMarcaY.map((valor) => {
    const y = MT + areaH - (valor / maximoY) * areaH;
    return `
      <line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="#1c1e29" stroke-width="1"/>
      <text x="${(ML - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9" fill="#585a66">${valor}${modo === "percentual" ? "%" : ""}</text>`;
  }).join("");

  const linhas = grupos.map((g, gi) => {
    const cor = cores[gi % cores.length];
    const coords = g.pontos.map((p, i) => ({
      x: ML + i * passoX,
      y: MT + areaH - (p[campo] / maximoY) * areaH,
      valor: p[campo],
      grupoIdx: gi,
      etapaIdx: i,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const pontos = coords.map((c) => `
      <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="${cor}" stroke="#0a0b10" stroke-width="1.5"
        class="pontoEngajamentoClicavel" style="cursor:pointer" data-container="${containerId}" data-grupo-idx="${c.grupoIdx}" data-etapa-idx="${c.etapaIdx}"/>
      <text x="${c.x.toFixed(1)}" y="${(c.y - 10).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" font-weight="600" fill="${cor}" style="pointer-events:none">${c.valor}${modo === "percentual" ? "%" : ""}</text>`).join("");
    return { path, pontos, cor, nome: `${g.grupo} (n=${g.totalLeads})` };
  });

  const rotulosX = etapas.map((nome, i) => {
    const x = ML + i * passoX;
    return `<text x="${x.toFixed(1)}" y="${(base + 16).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" fill="#8d8f9b">${nome}</text>`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto">
      ${marcasY}
      ${linhas.map((l) => `<path d="${l.path}" fill="none" stroke="${l.cor}" stroke-width="2"/>${l.pontos}`).join("")}
      ${rotulosX}
    </svg>
    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] font-mono">
      ${linhas.map((l) => `<span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${l.cor}"></span>${l.nome}</span>`).join("")}
    </div>`;

  container.querySelectorAll(".pontoEngajamentoClicavel").forEach((circulo) => {
    circulo.addEventListener("click", () => {
      const grupo = _engajamentoDataGlobal[circulo.dataset.container][Number(circulo.dataset.grupoIdx)];
      const ponto = grupo.pontos[Number(circulo.dataset.etapaIdx)];
      abrirPainelDrillDown({ grupo: `${grupo.grupo} — ${ponto.etapa}`, leads: ponto.leads });
    });
  });
}

// ── ATUALIZA TUDO (chamar dentro de atualizarAnaliseTrafego já existente) ─
async function atualizarGraficosNovos() {
  try {
    const res = await fetch(`${API_URL}/api/analise-trafego?inicio=${inputStart.value}&fim=${inputEnd.value}`);
    const data = await res.json();
    if (data.error) return;
    renderGraficoBarraComLegenda("graficoDistribuicaoPublico", data.porPublico);
    renderGraficoBarraComLegenda("graficoDistribuicaoEstado", data.porEstado);

    const limitePublico = Number(document.getElementById("filtroQtdEngajamentoPublico")?.value) || 5;
    const limiteEstado = Number(document.getElementById("filtroQtdEngajamentoEstado")?.value) || 5;
    const modoPublico = document.getElementById("modoEngajamentoPublico")?.value || "percentual";
    const modoEstado = document.getElementById("modoEngajamentoEstado")?.value || "percentual";
    renderGraficoEngajamento("graficoEngajamentoPublico", data.engajamentoPorPublico, limitePublico, modoPublico);
    renderGraficoEngajamento("graficoEngajamentoEstado", data.engajamentoPorEstado, limiteEstado, modoEstado);

    atualizarGraficoCusto();
  } catch (err) {
    console.error("Erro ao atualizar gráficos novos:", err);
  }
}

document.getElementById("filtroQtdEngajamentoPublico")?.addEventListener("change", atualizarGraficosNovos);
document.getElementById("filtroQtdEngajamentoEstado")?.addEventListener("change", atualizarGraficosNovos);
document.getElementById("modoEngajamentoPublico")?.addEventListener("change", atualizarGraficosNovos);
document.getElementById("modoEngajamentoEstado")?.addEventListener("change", atualizarGraficosNovos);

// ── DRILL-DOWN: "quem são esses leads" ao clicar numa barra/ponto ───────
function abrirPainelDrillDown(grupo) {
  const painel = document.getElementById("painelDrillDown");
  const titulo = document.getElementById("tituloDrillDown");
  const corpo = document.getElementById("corpoDrillDown");
  if (!painel || !titulo || !corpo) return;

  titulo.textContent = grupo.grupo;
  const leads = grupo.leads || [];
  corpo.innerHTML = leads.length
    ? leads.map((l) => `
        <div class="flex items-center justify-between border-b border-line py-1.5 text-xs">
          <span class="text-ink truncate">${l.nome}</span>
          <span class="text-inkdim font-mono">${l.telefone || "—"}</span>
          <span class="text-inkfaint text-[10px]">${l.etapaMaisAvancada || ""}</span>
        </div>`).join("")
    : '<p class="text-xs text-inkdim">Nenhum lead nesse grupo.</p>';

  painel.classList.remove("hidden");
}
document.getElementById("btnFecharDrillDown")?.addEventListener("click", () => {
  document.getElementById("painelDrillDown")?.classList.add("hidden");
});
