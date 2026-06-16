const API_URL = "https://dashboardkommo.onrender.com";

const inputStart = document.getElementById("startDate");
const inputEnd = document.getElementById("endDate");

const hoje = new Date();
const ano = hoje.getFullYear();
const mes = String(hoje.getMonth() + 1).padStart(2, "0");
const dia = String(hoje.getDate()).padStart(2, "0");

if (inputStart) inputStart.value = `${ano}-${mes}-01`;
if (inputEnd) inputEnd.value = `${ano}-${mes}-${dia}`;

async function atualizarPainel() {
  try {
    const res = await fetch(
      `${API_URL}/api/metrics?inicio=${inputStart.value}&fim=${inputEnd.value}`,
    );
    const data = await res.json();

    if (data.error) {
      console.error("Erro do backend:", data.error);
      return;
    }

    // --- ATUALIZAÇÃO DOS NOVOS INDICADORES DE EFICIÊNCIA (BI) ---
    if (document.getElementById("taxaAproveitamento") && data.summary) {
      document.getElementById("taxaAproveitamento").innerText = `${data.summary.porcentagemAproveitamento}%`;
    }
    
    if (document.getElementById("taxaNoShow") && data.summary) {
      document.getElementById("taxaNoShow").innerText = `${data.summary.porcentagemNoShow}%`;
    }
    
    if (document.getElementById("cardReengajamentos") && data.summary) {
      document.getElementById("cardReengajamentos").innerText = data.summary.totalReengajamentos;
    }

    // --- ATUALIZAÇÃO DOS CARDS DE METAS ---
    // 2. CORREÇÃO DINÂMICA: Exibe quantos contratos foram fechados EXATAMENTE no período filtrado
    const elMetaContratos = document.getElementById("metaContratos") || document.getElementById("metaFechados");
    if (elMetaContratos && data.summary) {
      const contratosFechados = data.summary.contratosFechadosNoPeriodo || 0;
      elMetaContratos.innerText = `${contratosFechados} / 5`;
    }

    // --- CARDS PRINCIPAIS ---
    if (document.getElementById("cardRealizadas") && data.summary) {
      document.getElementById("cardRealizadas").innerText = data.summary.realizadas;
    }
    
    if (document.getElementById("cardAgendadasTotal") && data.summary) {
      document.getElementById("cardAgendadasTotal").innerText = data.summary.agendadasTotal;
    }
    
    if (document.getElementById("subAgendadasNovas") && data.summary) {
      document.getElementById("subAgendadasNovas").innerText = data.summary.agendadasNovas;
    }
    
    if (document.getElementById("subReagendamentos") && data.summary) {
      document.getElementById("subReagendamentos").innerText = data.summary.reagendamentos;
    }

    // --- RENDERIZAÇÃO DA TABELA DO FUNIL ---
    const tabelaFunil = document.getElementById("corpoFunil");
    if (tabelaFunil && data.breakdownFunil) {
      tabelaFunil.innerHTML = "";

      Object.entries(data.breakdownFunil).forEach(([nomeEtapa, totalLeads]) => {
        let destaqueClasse = "text-slate-300";
        if (nomeEtapa === "CONTRATO FECHADO")
          destaqueClasse = "text-emerald-400 font-bold";
        if (nomeEtapa === "MARCAÇÃO DE REUNIÃO")
          destaqueClasse = "text-blue-400 font-semibold";

        const tr = `
          <tr class="hover:bg-slate-900/30 transition">
            <td class="py-2.5 ${destaqueClasse}">${nomeEtapa}</td>
            <td class="py-2.5 text-right font-bold text-white">${totalLeads}</td>
          </tr>
        `;
        tabelaFunil.innerHTML += tr;
      });
    }
  } catch (err) {
    console.error("Erro ao processar atualização:", err);
  }
}

const btnFiltrar = document.getElementById("btnFiltrar");
if (btnFiltrar) {
  btnFiltrar.addEventListener("click", atualizarPainel);
}
atualizarPainel();
