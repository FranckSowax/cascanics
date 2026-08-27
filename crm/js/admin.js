/* Administration : vue globale, commandes (paiements + production + QC),
   équipe commerciale, propositions de zones, réglages. */
import {
  load, totaux, fmtEUR, fmtEUR2, fmtDate,
  etapeIndex, prochaineEtape, avancerCommande, annulerCommande,
  addProposition, creerCommercial, saveSettings,
  dateLivraisonEstimee, kpisCommercial,
} from "./store.js";
import { boot, topbar, toast, tente, badgeCommande, railHTML, esc } from "./ui.js";

const me = await boot("admin");
const main = document.getElementById("main");

const TABS = [
  { id: "dash", label: "Vue globale" },
  { id: "commandes", label: "Commandes" },
  { id: "equipe", label: "Commerciaux" },
  { id: "propositions", label: "Propositions" },
  { id: "reglages", label: "Réglages" },
];
const activate = topbar(me, TABS, "Administration");
let tab = "dash";
let detailCmdId = null;

document.querySelectorAll(".topbar [data-tab]").forEach((b) =>
  b.addEventListener("click", () => { tab = b.dataset.tab; detailCmdId = null; render(); })
);

const commerciaux = () => load().users.filter((u) => u.role === "commercial");
const nomCommercial = (id) => (load().users.find((u) => u.id === id) || {}).nom || "?";
const clientDe = (c) => load().prospects.find((p) => p.id === c.clientId);

function render() {
  activate(tab);
  if (tab === "dash") renderDash();
  else if (tab === "commandes") detailCmdId ? renderDetail(detailCmdId) : renderCommandes();
  else if (tab === "equipe") renderEquipe();
  else if (tab === "propositions") renderPropositions();
  else renderReglages();
}

/* ---------- Vue globale ---------- */
function renderDash() {
  const d = load();
  const cmds = d.commandes.filter((c) => c.statut !== "annulee");
  const caEncaisse = cmds.filter((c) => etapeIndex(c.statut) >= etapeIndex("solde_recu")).reduce((s, c) => s + totaux(c).ht, 0);
  const caSigne = cmds.filter((c) => etapeIndex(c.statut) >= etapeIndex("signee")).reduce((s, c) => s + totaux(c).ht, 0);
  const acomptesAttendus = cmds.filter((c) => c.statut === "signee").reduce((s, c) => s + totaux(c).acompte, 0);
  const soldesAttendus = cmds.filter((c) => c.statut === "controle_qualite").reduce((s, c) => s + totaux(c).solde, 0);
  const enProd = cmds.filter((c) => ["acompte_recu", "en_production"].includes(c.statut)).length;
  const aValider = cmds.filter((c) => {
    const next = prochaineEtape(c);
    return next && next.who === "admin";
  });

  main.innerHTML = `
    <div class="page-title"><h1>Vue globale</h1><span class="sub">${commerciaux().length} commerciaux · ${cmds.length} commandes actives</span></div>
    <div class="grid-kpi">
      ${kpi("CA encaissé (HT)", fmtEUR(caEncaisse), "eur", "commandes soldées")}
      ${kpi("CA signé (HT)", fmtEUR(caSigne), "", "toutes commandes signées")}
      ${kpi("Acomptes 50 % attendus", fmtEUR(acomptesAttendus), "", "commandes signées non payées")}
      ${kpi("Soldes 50 % attendus", fmtEUR(soldesAttendus), "", "QC validé, avant expédition")}
      ${kpi("En fabrication", enProd, "", "délai " + d.settings.delaiFabricationJours + " j hors stock")}
      ${kpi("Stock machines", d.settings.stockMachines, "", "disponibles à l'expédition")}
    </div>
    <div class="cols">
      <section class="panel">
        <h2>Progression des commerciaux</h2>
        ${tableEquipe(false)}
      </section>
      <section class="panel">
        <h2>Actions attendues <span class="count">${aValider.length}</span></h2>
        ${aValider.length ? aValider.map((c) => {
          const next = prochaineEtape(c);
          return `<div style="display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--ligne)">
            <div style="min-width:0"><b>${c.numero}</b> <span class="muted">· ${esc((clientDe(c) || {}).entreprise || "")}</span><br />${badgeCommande(c.statut)}</div>
            <button class="btn sm primary" style="margin-left:auto; white-space:nowrap" data-adv="${c.id}">→ ${next.label}</button>
          </div>`;
        }).join("") : `<p class="empty">Rien à valider.</p>`}
      </section>
    </div>`;
  bindAdvance();
}

/* ---------- Commandes ---------- */
function renderCommandes() {
  const list = load().commandes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  main.innerHTML = `
    <div class="page-title"><h1>Commandes</h1><span class="sub">${list.length} bon(s) de commande</span></div>
    <section class="panel scroll-x">
      <table>
        <thead><tr><th>N°</th><th>Client</th><th>Commercial</th><th>Statut</th><th class="num">TTC</th><th>Livraison est.</th><th></th></tr></thead>
        <tbody>${list.map((c) => {
          const next = prochaineEtape(c);
          return `<tr class="rowlink" data-cmd="${c.id}">
            <td><b>${c.numero}</b><div class="muted">${fmtDate(c.createdAt)}</div></td>
            <td>${esc((clientDe(c) || {}).entreprise || "?")}</td>
            <td class="muted">${esc(nomCommercial(c.commercialId))}</td>
            <td>${badgeCommande(c.statut)}</td>
            <td class="num">${fmtEUR2(totaux(c).ttc)}</td>
            <td class="muted">${["annulee", "livree"].includes(c.statut) ? "—" : fmtDate(dateLivraisonEstimee(c).toISOString())}</td>
            <td>${next ? `<button class="btn sm" data-adv="${c.id}">→ ${next.label}</button>` : ""}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="7"><p class="empty">Aucune commande.</p></td></tr>`}</tbody>
      </table>
    </section>`;
  bindAdvance();
  main.querySelectorAll("[data-cmd]").forEach((r) =>
    r.addEventListener("click", () => { detailCmdId = r.dataset.cmd; render(); })
  );
}

function renderDetail(id) {
  const c = load().commandes.find((x) => x.id === id);
  if (!c) { detailCmdId = null; return renderCommandes(); }
  const p = clientDe(c);
  const t = totaux(c);
  const next = prochaineEtape(c);
  main.innerHTML = `
    <div class="page-title">
      <button class="btn ghost sm" id="back">← Commandes</button>
      <h1>${c.numero}</h1>${badgeCommande(c.statut)}
      <span class="sub">Commercial : ${esc(nomCommercial(c.commercialId))}</span>
    </div>
    <div class="cols">
      <section class="panel">
        <h2>Cycle de la commande</h2>
        ${railHTML(c, fmtDate)}
        <div class="sep"></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          ${next ? `<button class="btn primary" data-adv="${c.id}">Valider « ${next.label} »</button>` : ""}
          <a class="btn" href="bon-de-commande.html?cmd=${c.id}" target="_blank">Voir le BC</a>
          ${!["livree", "annulee"].includes(c.statut) ? `<button class="btn danger ghost" id="cancel">Annuler la commande</button>` : ""}
        </div>
      </section>
      <div>
        <section class="panel">
          <h2>Client</h2>
          <p><b>${esc(p.entreprise)}</b><br /><span class="muted">${esc(p.type)} — ${esc(p.ville)}<br />${esc(p.contact)} ${esc(p.tel)}<br />${esc(p.email)}</span></p>
        </section>
        <section class="panel">
          <h2>Paiements</h2>
          <table>
            <tr><td><b>Total TTC</b></td><td class="num"><b>${fmtEUR2(t.ttc)}</b></td></tr>
            <tr><td>Acompte 50 %</td><td class="num">${etapeIndex(c.statut) >= etapeIndex("acompte_recu") && c.statut !== "annulee" ? `<span class="badge b-vert">Reçu</span>` : fmtEUR2(t.acompte)}</td></tr>
            <tr><td>Solde 50 %</td><td class="num">${etapeIndex(c.statut) >= etapeIndex("solde_recu") && c.statut !== "annulee" ? `<span class="badge b-vert">Reçu</span>` : fmtEUR2(t.solde)}</td></tr>
          </table>
          <p class="hint" style="margin-top:10px">${c.avecStock ? "Machine sur stock." : `Fabrication ${load().settings.delaiFabricationJours} j après acompte.`}
          Livraison estimée : <b>${fmtDate(dateLivraisonEstimee(c).toISOString())}</b></p>
        </section>
      </div>
    </div>`;
  document.getElementById("back").addEventListener("click", () => { detailCmdId = null; render(); });
  bindAdvance();
  const cancel = document.getElementById("cancel");
  if (cancel) cancel.addEventListener("click", async () => {
    if (confirm("Annuler définitivement la commande " + c.numero + " ?")) {
      await tente(() => annulerCommande(c.id), "Commande annulée");
      render();
    }
  });
}

/* ---------- Équipe ---------- */
function tableEquipe(withContact) {
  return `<div class="scroll-x"><table>
    <thead><tr><th>Commercial</th><th>Zone</th><th class="num">Prospects</th><th class="num">Visites</th><th class="num">Signées</th><th class="num">CA encaissé</th><th class="num">Commission</th><th class="num">Conv.</th></tr></thead>
    <tbody>${commerciaux().map((u) => {
      const k = kpisCommercial(u.id);
      return `<tr>
        <td><b>${esc(u.nom)}</b>${withContact ? `<div class="muted">${esc(u.email || "")} ${esc(u.tel || "")}</div>` : ""}</td>
        <td class="tag-zone">${esc(u.zone)}</td>
        <td class="num">${k.prospects}</td>
        <td class="num">${k.visites}</td>
        <td class="num">${k.signees}</td>
        <td class="num">${fmtEUR(k.caEncaisse)}</td>
        <td class="num" style="color:var(--vert-valide)">${fmtEUR(k.commission)}</td>
        <td class="num">${k.conversion} %</td>
      </tr>`;
    }).join("") || `<tr><td colspan="8"><p class="empty">Aucun commercial — créez le premier compte.</p></td></tr>`}</tbody>
  </table></div>`;
}

function renderEquipe() {
  main.innerHTML = `
    <div class="page-title"><h1>Commerciaux</h1>
      <span class="sub">${commerciaux().length} sur le terrain</span>
      <button class="btn primary sm" id="add-user" style="margin-left:auto">+ Ajouter un commercial</button></div>
    <section class="panel">${tableEquipe(true)}</section>`;
  document.getElementById("add-user").addEventListener("click", () => {
    document.getElementById("form-user").reset();
    document.getElementById("dlg-user").showModal();
  });
}

/* ---------- Propositions ---------- */
function renderPropositions() {
  const list = load().propositions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const badge = (s) => s === "proposee" ? `<span class="badge b-ambre">En attente</span>`
    : s === "acceptee" ? `<span class="badge b-bleu">Acceptée</span>` : `<span class="badge b-vert">Traitée</span>`;
  main.innerHTML = `
    <div class="page-title"><h1>Propositions de démarchage</h1>
      <span class="sub">Suggérez des zones à vos commerciaux selon leur secteur</span>
      <button class="btn primary sm" id="add-prop" style="margin-left:auto">+ Nouvelle proposition</button></div>
    <section class="panel scroll-x">
      <table>
        <thead><tr><th>Zone</th><th>Commercial</th><th>Cibles</th><th>Statut</th><th>Date</th></tr></thead>
        <tbody>${list.map((pr) => `<tr>
          <td class="tag-zone"><b>${esc(pr.zone)}</b><div class="muted">${esc(pr.message)}</div></td>
          <td>${esc(nomCommercial(pr.commercialId))}</td>
          <td class="muted">${esc(pr.cible)}</td>
          <td>${badge(pr.statut)}</td>
          <td class="muted">${fmtDate(pr.createdAt)}</td>
        </tr>`).join("") || `<tr><td colspan="5"><p class="empty">Aucune proposition envoyée.</p></td></tr>`}</tbody>
      </table>
    </section>`;
  document.getElementById("add-prop").addEventListener("click", () => {
    if (!commerciaux().length) { toast("Créez d'abord un compte commercial.", true); return; }
    document.getElementById("pr-com").innerHTML = commerciaux()
      .map((u) => `<option value="${u.id}">${esc(u.nom)} — ${esc(u.zone)}</option>`).join("");
    document.getElementById("form-prop").reset();
    document.getElementById("dlg-prop").showModal();
  });
}

/* ---------- Réglages ---------- */
function renderReglages() {
  const s = load().settings;
  main.innerHTML = `
    <div class="page-title"><h1>Réglages</h1><span class="sub">Prix, commissions, stock, société</span></div>
    <section class="panel" style="max-width:640px">
      <div class="f-row">
        <div><label class="f" for="s-prix">Prix machine (€ HT)</label><input id="s-prix" type="number" min="0" value="${s.prixMachineHT}" /></div>
        <div><label class="f" for="s-tva">TVA (%)</label><input id="s-tva" type="number" min="0" value="${s.tauxTVA}" /></div>
      </div>
      <div class="f-row">
        <div><label class="f" for="s-com">Commission commerciaux (% du CA HT encaissé)</label><input id="s-com" type="number" min="0" step="0.5" value="${s.commissionPct}" /></div>
        <div><label class="f" for="s-delai">Délai de fabrication (jours)</label><input id="s-delai" type="number" min="1" value="${s.delaiFabricationJours}" /></div>
      </div>
      <div class="f-row">
        <div><label class="f" for="s-stock">Machines en stock</label><input id="s-stock" type="number" min="0" value="${s.stockMachines}" /></div>
        <div></div>
      </div>
      <div class="sep"></div>
      <label class="f" for="s-nom">Société (en-tête du bon de commande)</label>
      <input id="s-nom" value="${esc(s.societe.nom)}" />
      <label class="f" for="s-adresse">Adresse</label>
      <input id="s-adresse" value="${esc(s.societe.adresse)}" />
      <div class="f-row">
        <div><label class="f" for="s-email">E-mail</label><input id="s-email" value="${esc(s.societe.email)}" /></div>
        <div><label class="f" for="s-siret">SIRET</label><input id="s-siret" value="${esc(s.societe.siret)}" /></div>
      </div>
      <div class="d-actions" style="justify-content:flex-start">
        <button class="btn primary" id="save-settings">Enregistrer les réglages</button>
      </div>
      <p class="hint">Le prix s'applique aux nouveaux bons de commande ; les BC existants gardent leur prix.</p>
    </section>`;
  document.getElementById("save-settings").addEventListener("click", async () => {
    const s = load().settings;
    await tente(() => saveSettings({
      prixMachineHT: +document.getElementById("s-prix").value || s.prixMachineHT,
      tauxTVA: +document.getElementById("s-tva").value,
      commissionPct: +document.getElementById("s-com").value,
      delaiFabricationJours: +document.getElementById("s-delai").value || 25,
      stockMachines: Math.max(0, +document.getElementById("s-stock").value || 0),
      societe: {
        nom: document.getElementById("s-nom").value.trim(),
        adresse: document.getElementById("s-adresse").value.trim(),
        email: document.getElementById("s-email").value.trim(),
        siret: document.getElementById("s-siret").value.trim(),
      },
    }), "Réglages enregistrés");
  });
}

/* ---------- Communs ---------- */
function bindAdvance() {
  main.querySelectorAll("[data-adv]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const done = await tente(() => avancerCommande(b.dataset.adv));
      if (done) toast("Étape validée : " + done.label);
      render();
    })
  );
}

function kpi(label, val, cls, sub) {
  return `<div class="panel kpi"><div class="k-label">${label}</div>
    <div class="k-val ${cls}">${val}</div><div class="k-sub">${sub}</div></div>`;
}

/* ---------- Formulaires modaux ---------- */
document.getElementById("form-user").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  await tente(() => creerCommercial({
    email: document.getElementById("u-email").value.trim(),
    password: document.getElementById("u-pw").value,
    nom: document.getElementById("u-nom").value.trim(),
    zone: document.getElementById("u-zone").value.trim(),
    tel: document.getElementById("u-tel").value.trim(),
  }), "Compte commercial créé — transmettez-lui ses identifiants.");
  render();
});

document.getElementById("form-prop").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  await tente(() => addProposition({
    commercialId: document.getElementById("pr-com").value,
    zone: document.getElementById("pr-zone").value.trim(),
    cible: document.getElementById("pr-cible").value.trim(),
    message: document.getElementById("pr-msg").value.trim(),
  }), "Proposition envoyée au commercial");
  render();
});

render();
