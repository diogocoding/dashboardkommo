const API_URL = "https://dashboardkommo.onrender.com";

const inputStart = document.getElementById("startDate");
const inputEnd = document.getElementById("endDate");

const hoje = new Date();
inputStart.value = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  .toISOString()
  .split("T")[0];
inputEnd.value = hoje.toISOString().split("T")[0];

async function atualizarPainel() {
  try {
    const res = await fetch(
      `${API_URL}?startDate=${inputStart.value}&endDate=${inputEnd.value}`,
    );
    const data = await res.json();

    if (data.error) return;

    // Atualiza Meta Comercial da Equipe (40 Reuniões)
    document.getElementById("metaReuniões").innerText =
      `${data.summary.realizadas} / 40`;

    // Atualiza os Cards Analíticos de Reuniões
    document.getElementById("cardRealizadas").innerText =
      data.summary.realizadas;
    document.getElementById("cardAgendadasTotal").innerText =
      data.summary.agendadasTotal;
    document.getElementById("subAgendadasNovas").innerText =
      data.summary.agendadasNovas;
    document.getElementById("subReagendamentos").innerText =
      data.summary.reagendamentos;

    // Renderiza o Breakdown Completo de todas as etapas exigidas
    const tabelaFunil = document.getElementById("corpoFunil");
    tabelaFunil.innerHTML = "";

    Object.entries(data.breakdownFunil).forEach(([nomeEtapa, totalLeads]) => {
      // Destaca colunas importantes visualmente
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
  } catch (err) {
    console.error("Erro ao processar atualização:", err);
  }
}

document
  .getElementById("btnFiltrar")
  .addEventListener("click", atualizarPainel);
atualizarPainel();
