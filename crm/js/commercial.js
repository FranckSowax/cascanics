/* Espace commercial : tableau de bord, prospection, commandes, propositions. */
import {
  load, totaux, fmtEUR, fmtEUR2, fmtDate,
  STATUTS_PROSPECT, TYPES_PROSPECT, prochaineEtape,
  addProspect, patchProspect, creerCommande, avancerCommande,
  patchProposition, dateLivraisonEstimee, kpisCommercial,
} from "./store.js";
import { boot, topbar, toast, tente, badgeCommande, railHTML, esc } from "./ui.js";

const me = await boot("commercial");
const main = document.getElementById("main");

const TABS = [
  { id: "dash", label: "Tableau de bord" },
  { id: "prospects", label: "Prospection" },
  { id: "commandes", label: "Commandes" },
  { id: "propositions", label: "Propositions" },
];
const activate = topbar(me, TABS, "Espace commercial");
let tab = "dash";
let detailCmdId = null;

document.querySelectorAll(".topbar [data-tab]").forEach((b) =>
  b.addEventListener("click", () => { tab = b.dataset.tab; detailCmdId = null; render(); })
);

/* ---------- Données filtrées ---------- */
const mesProspects = () => load().prospects.filter((p) => p.commercialId === me.id);
const mesCommandes = () => load().commandes.filter((c) => c.commercialId === me.id);
const mesPropositions = () => load().propositions.filter((p) => p.commercialId === me.id);

/* ---------- Rendu ---------- */
function render() {
  activate(tab);
  if (tab === "dash") renderDash();
  else if (tab === "prospects") renderProspects();
  else if (tab === "commandes") detailCmdId ? renderDetail(detailCmdId) : renderCommandes();
  else renderPropositions();
}

function renderDash() {
  const k = kpisCommercial(me.id);
  const s = load().settings;
  const enCours = mesCommandes().filter((c) => !["livree", "annulee"].includes(c.statut));
  const props = mesPropositions().filter((p) => p.statut === "proposee");
  main.innerHTML = `
    <div class="page-title"><h1>Bonjour, ${esc(me.nom.split(" ")[0])}</h1>
      <span class="sub">Zone : <span class="tag-zone">${esc(me.zone)}</span> · Commission : ${s.commissionPct} % du CA HT encaissé</span></div>
    <div class="grid-kpi">
      ${kpi("CA encaissé (HT)", fmtEUR(k.caEncaisse), "eur", "commandes soldées")}
      ${kpi("Commission acquise", fmtEUR(k.commission), "com", s.commissionPct + " % du CA encaissé")}
      ${kpi("CA signé (HT)", fmtEUR(k.caSigne), "", k.signees + " commande(s) signée(s)")}
      ${kpi("Pipeline (HT)", fmtEUR(k.pipeline), "", "BC en attente de signature")}
      ${kpi("Visites réalisées", k.visites, "", k.prospects + " prospects au total")}
      ${kpi("Taux de conversion", k.conversion + " %", "", "signatures / visites")}
    </div>
    <div class="cols">
      <section class="panel">
        <h2>Commandes en cours <span class="count">${enCours.length}</span></h2>
        ${tableCommandes(enCours)}
      </section>
      <div>
        <section class="panel">
          <h2>Propositions de l'admin <span class="count">${props.length}</span></h2>
          ${props.length ? props.map(propCard).join("") : `<p class="empty">Aucune nouvelle proposition de zone.</p>`}
        </section>
        <section class="panel">
          <h2>Rappels métier</h2>
          <p class="hint" style="line-height:1.7">
            · Acompte <b style="color:var(--ambre-flux)">50 %</b> à la commande.<br />
            · Solde <b style="color:var(--ambre-flux)">50 %</b> avant expédition, après contrôle qualité.<br />
            · Fabrication : <b>${s.delaiFabricationJours} jours</b> hors stock.<br />
            · Stock actuel : <b>${s.stockMachines} machine(s)</b> disponible(s).<br />
            · Offre « Placement en dépôt » : bientôt disponible.
          </p>
        </section>
      </div>
    </div>`;
  bindRows();
  bindPropButtons();
}

function renderProspects() {
  const list = mesProspects().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  main.innerHTML = `
    <div class="page-title"><h1>Prospection</h1>
      <span class="sub">${list.length} prospect(s) — zone ${esc(me.zone)}</span>
      <button class="btn primary sm" id="add-prospect" style="margin-left:auto">+ Nouveau prospect</button></div>
    <section class="panel scroll-x">
      <table>
        <thead><tr><th>Entreprise</th><th>Type</th><th>Ville</th><th>Contact</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${list.map((p) => `<tr>
            <td><b>${esc(p.entreprise)}</b>${p.source === "proposition_admin" ? ` <span class="badge b-cyan b-off">Proposé par l'admin</span>` : ""}
              ${p.notes.length ? `<div class="muted">${esc(p.notes[p.notes.length - 1].t)}</div>` : ""}</td>
            <td class="muted">${esc(p.type)}</td>
            <td>${esc(p.ville)}</td>
            <td class="muted">${esc(p.contact)}${p.tel ? "<br />" + esc(p.tel) : ""}</td>
            <td><select data-statut="${p.id}" class="sm" style="width:auto">
              ${STATUTS_PROSPECT.map((s) => `<option value="${s.id}" ${s.id === p.statut ? "selected" : ""}>${s.label}</option>`).join("")}
            </select></td>
            <td style="white-space:nowrap">
              <button class="btn sm ghost" data-note="${p.id}">+ Note</button>
              <button class="btn sm" data-bc="${p.id}">Bon de commande</button>
            </td>
          </tr>`).join("") || `<tr><td colspan="6"><p class="empty">Aucun prospect. Ajoutez votre première visite.</p></td></tr>`}
        </tbody>
      </table>
    </section>`;
  document.getElementById("add-prospect").addEventListener("click", openProspectDialog);
  main.querySelectorAll("[data-statut]").forEach((sel) =>
    sel.addEventListener("change", async () => {
      const p = load().prospects.find((x) => x.id === sel.dataset.statut);
      await tente(() => patchProspect(p.id, { statut: sel.value }), "Statut mis à jour : " + p.entreprise);
      render();
    })
  );
  main.querySelectorAll("[data-note]").forEach((b) =>
    b.addEventListener("click", async () => {
      const t = prompt("Note de visite / d'appel :");
      if (!t) return;
      const p = load().prospects.find((x) => x.id === b.dataset.note);
      const patch = { notes: [...p.notes, { d: new Date().toISOString(), t }] };
      if (p.statut === "a_visiter") patch.statut = "visite";
      await tente(() => patchProspect(p.id, patch), "Note ajoutée");
      render();
    })
  );
  main.querySelectorAll("[data-bc]").forEach((b) =>
    b.addEventListener("click", () => openCommandeDialog(b.dataset.bc))
  );
}

function renderCommandes() {
  const list = mesCommandes().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  main.innerHTML = `
    <div class="page-title"><h1>Mes commandes</h1>
      <span class="sub">${list.length} bon(s) de commande</span>
      <button class="btn primary sm" id="add-cmd" style="margin-left:auto">+ Nouveau bon de commande</button></div>
    <section class="panel scroll-x">${tableCommandes(list)}</section>`;
  document.getElementById("add-cmd").addEventListener("click", () => openCommandeDialog());
  bindRows();
}

function tableCommandes(list) {
  if (!list.length) return `<p class="empty">Aucune commande pour le moment.</p>`;
  return `<table>
    <thead><tr><th>N°</th><th>Client</th><th>Statut</th><th class="num">Total TTC</th><th class="num">Acompte 50 %</th><th>Livraison est.</th></tr></thead>
    <tbody>${list.map((c) => {
      const p = load().prospects.find((x) => x.id === c.clientId);
      const t = totaux(c);
      return `<tr class="rowlink" data-cmd="${c.id}">
        <td><b>${c.numero}</b><div class="muted">${fmtDate(c.createdAt)}</div></td>
        <td>${esc(p ? p.entreprise : "?")}</td>
        <td>${badgeCommande(c.statut)}</td>
        <td class="num">${fmtEUR2(t.ttc)}</td>
        <td class="num">${fmtEUR2(t.acompte)}</td>
        <td class="muted">${["annulee", "livree"].includes(c.statut) ? "—" : fmtDate(dateLivraisonEstimee(c).toISOString())}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

function renderDetail(id) {
  const c = load().commandes.find((x) => x.id === id);
  if (!c) { detailCmdId = null; return renderCommandes(); }
  const p = load().prospects.find((x) => x.id === c.clientId);
  const t = totaux(c);
  const next = prochaineEtape(c);
  // Le commercial fait avancer les étapes commerciales ; l'admin gère paiements, production et QC.
  const actionCommerciale = next && ["envoyee", "signee"].includes(next.id);
  main.innerHTML = `
    <div class="page-title">
      <button class="btn ghost sm" id="back">← Commandes</button>
      <h1>${c.numero}</h1>${badgeCommande(c.statut)}
    </div>
    <div class="cols">
      <section class="panel">
        <h2>Cycle de la commande</h2>
        ${railHTML(c, fmtDate)}
        <div class="sep"></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          ${actionCommerciale ? `<button class="btn primary" id="advance">Marquer « ${next.label} »</button>` : ""}
          ${next && !actionCommerciale && c.statut !== "annulee" ? `<span class="hint" style="align-self:center">Prochaine étape (« ${next.label} ») validée par l'administration.</span>` : ""}
          <a class="btn" href="bon-de-commande.html?cmd=${c.id}" target="_blank">Imprimer le BC</a>
          <button class="btn" id="send">Envoyer par e-mail</button>
        </div>
      </section>
      <div>
        <section class="panel">
          <h2>Client</h2>
          <p><b>${esc(p.entreprise)}</b><br />
          <span class="muted">${esc(p.type)} — ${esc(p.ville)}</span><br />
          <span class="muted">${esc(p.contact)} ${esc(p.tel)}<br />${esc(p.email)}</span></p>
        </section>
        <section class="panel">
          <h2>Montants</h2>
          <table>
            <tr><td>Machine × ${c.qty}${c.remisePct ? ` (remise ${c.remisePct} %)` : ""}</td><td class="num">${fmtEUR2(t.ht)} HT</td></tr>
            <tr><td>TVA ${load().settings.tauxTVA} %</td><td class="num">${fmtEUR2(t.tva)}</td></tr>
            <tr><td><b>Total TTC</b></td><td class="num"><b>${fmtEUR2(t.ttc)}</b></td></tr>
            <tr><td style="color:var(--ambre-flux)">Acompte 50 % à la commande</td><td class="num">${fmtEUR2(t.acompte)}</td></tr>
            <tr><td style="color:var(--ambre-flux)">Solde 50 % avant départ</td><td class="num">${fmtEUR2(t.solde)}</td></tr>
          </table>
          <p class="hint" style="margin-top:10px">${c.avecStock
            ? "Machine sur stock — expédition rapide après solde."
            : `Fabrication : ${load().settings.delaiFabricationJours} jours après réception de l'acompte.`}
            Livraison estimée : <b>${fmtDate(dateLivraisonEstimee(c).toISOString())}</b></p>
        </section>
      </div>
    </div>`;
  document.getElementById("back").addEventListener("click", () => { detailCmdId = null; render(); });
  const adv = document.getElementById("advance");
  if (adv) adv.addEventListener("click", async () => {
    const done = await tente(() => avancerCommande(c.id));
    if (done) toast("Commande " + c.numero + " → " + done.label);
    render();
  });
  document.getElementById("send").addEventListener("click", () => {
    const body = [
      `Bonjour ${p.contact || ""},`, "",
      `Veuillez trouver ci-dessous le récapitulatif de votre bon de commande ${c.numero} :`,
      `- Machine Cascanics x ${c.qty} — Total ${fmtEUR2(t.ttc)} TTC`,
      `- Acompte de 50 % à la commande : ${fmtEUR2(t.acompte)}`,
      `- Solde de 50 % avant expédition, après validation du contrôle qualité : ${fmtEUR2(t.solde)}`,
      c.avecStock ? `- Machine disponible en stock.` : `- Délai de fabrication : ${load().settings.delaiFabricationJours} jours à réception de l'acompte.`,
      "", `Le bon de commande complet vous sera remis en version imprimée ou PDF.`,
      "", `Bien cordialement,`, me.nom + " — Cascanics", me.tel || "",
    ].join("\n");
    location.href = `mailto:${encodeURIComponent(p.email || "")}?subject=${encodeURIComponent("Cascanics — Bon de commande " + c.numero)}&body=${encodeURIComponent(body)}`;
  });
}

function renderPropositions() {
  const list = mesPropositions().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  main.innerHTML = `
    <div class="page-title"><h1>Propositions de démarchage</h1>
      <span class="sub">Zones et cibles suggérées par l'administration selon votre secteur</span></div>
    <section class="panel">
      ${list.length ? list.map(propCard).join("") : `<p class="empty">Aucune proposition pour le moment.</p>`}
    </section>`;
  bindPropButtons();
}

function propCard(pr) {
  const badge = pr.statut === "proposee" ? `<span class="badge b-ambre">Nouvelle</span>`
    : pr.statut === "acceptee" ? `<span class="badge b-bleu">Acceptée</span>`
    : `<span class="badge b-vert">Traitée</span>`;
  return `<div style="padding:12px 0; border-bottom:1px solid var(--ligne)">
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
      <b class="tag-zone">${esc(pr.zone)}</b>${badge}
      <span class="muted" style="margin-left:auto">${fmtDate(pr.createdAt)}</span>
    </div>
    <div style="font-size:13px; margin-top:4px">${esc(pr.cible)}</div>
    <div class="muted" style="margin-top:2px">${esc(pr.message)}</div>
    ${pr.statut === "proposee" ? `<div style="margin-top:8px"><button class="btn sm primary" data-accept="${pr.id}">Accepter la tournée</button></div>` : ""}
    ${pr.statut === "acceptee" ? `<div style="margin-top:8px"><button class="btn sm" data-done="${pr.id}">Marquer traitée</button></div>` : ""}
  </div>`;
}

function bindPropButtons() {
  main.querySelectorAll("[data-accept]").forEach((b) =>
    b.addEventListener("click", async () => {
      await tente(() => patchProposition(b.dataset.accept, "acceptee"), "Tournée acceptée — bonne prospection !");
      render();
    })
  );
  main.querySelectorAll("[data-done]").forEach((b) =>
    b.addEventListener("click", async () => {
      await tente(() => patchProposition(b.dataset.done, "traitee"), "Proposition marquée traitée");
      render();
    })
  );
}

function bindRows() {
  main.querySelectorAll("[data-cmd]").forEach((r) =>
    r.addEventListener("click", () => { tab = "commandes"; detailCmdId = r.dataset.cmd; render(); })
  );
}

function kpi(label, val, cls, sub) {
  return `<div class="panel kpi"><div class="k-label">${label}</div>
    <div class="k-val ${cls}">${val}</div><div class="k-sub">${sub}</div></div>`;
}

/* ---------- Modale prospect ---------- */
const dlgProspect = document.getElementById("dlg-prospect");
document.getElementById("p-type").innerHTML = TYPES_PROSPECT.map((t) => `<option>${t}</option>`).join("");

function openProspectDialog() {
  document.getElementById("form-prospect").reset();
  dlgProspect.showModal();
}
document.getElementById("form-prospect").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  await tente(() => addProspect({
    commercialId: me.id,
    entreprise: document.getElementById("p-ent").value.trim(),
    type: document.getElementById("p-type").value,
    ville: document.getElementById("p-ville").value.trim(),
    adresse: document.getElementById("p-adresse").value.trim(),
    contact: document.getElementById("p-contact").value.trim(),
    tel: document.getElementById("p-tel").value.trim(),
    email: document.getElementById("p-email").value.trim(),
  }), "Prospect ajouté");
  render();
});

/* ---------- Modale commande ---------- */
const dlgCmd = document.getElementById("dlg-commande");
function openCommandeDialog(clientId) {
  const sel = document.getElementById("c-client");
  sel.innerHTML = mesProspects()
    .filter((p) => p.statut !== "perdu")
    .map((p) => `<option value="${p.id}" ${p.id === clientId ? "selected" : ""}>${esc(p.entreprise)} — ${esc(p.ville)}</option>`)
    .join("");
  if (!sel.innerHTML) { toast("Ajoutez d'abord un prospect."); return; }
  majTotauxDialog();
  dlgCmd.showModal();
}
function majTotauxDialog() {
  const s = load().settings;
  const qty = Math.max(1, +document.getElementById("c-qty").value || 1);
  const remise = Math.min(15, Math.max(0, +document.getElementById("c-remise").value || 0));
  const ht = qty * s.prixMachineHT * (1 - remise / 100);
  const ttc = ht * (1 + s.tauxTVA / 100);
  document.getElementById("c-stock-info").innerHTML = s.stockMachines >= qty
    ? `✔ ${s.stockMachines} machine(s) en stock — expédition rapide.`
    : `⚠ Stock insuffisant : fabrication sous <b>${s.delaiFabricationJours} jours</b> après acompte.`;
  document.getElementById("c-totaux").innerHTML =
    `Total : <b>${fmtEUR2(ttc)} TTC</b> — Acompte 50 % : <b style="color:var(--ambre-flux)">${fmtEUR2(ttc / 2)}</b> · Solde 50 % avant départ : <b style="color:var(--ambre-flux)">${fmtEUR2(ttc / 2)}</b>`;
}
["c-qty", "c-remise"].forEach((id) => document.getElementById(id).addEventListener("input", majTotauxDialog));
document.getElementById("form-commande").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  const s = load().settings;
  const qty = Math.max(1, +document.getElementById("c-qty").value || 1);
  const cmd = await tente(() => creerCommande({
    clientId: document.getElementById("c-client").value,
    commercialId: me.id,
    qty,
    remisePct: Math.min(15, Math.max(0, +document.getElementById("c-remise").value || 0)),
    avecStock: s.stockMachines >= qty,
  }));
  if (cmd) {
    toast("Bon de commande " + cmd.numero + " créé");
    tab = "commandes"; detailCmdId = cmd.id;
  }
  render();
});

render();
