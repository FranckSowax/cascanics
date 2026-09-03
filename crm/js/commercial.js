/* Espace commercial : tableau de bord, prospection, commandes, propositions. */
import {
  load, totaux, fmtEUR, fmtEUR2, fmtDate,
  STATUTS_PROSPECT, TYPES_PROSPECT, prochaineEtape,
  addProspect, patchProspect, creerCommande, avancerCommande,
  patchProposition, dateLivraisonEstimee, kpisCommercial,
  prospectsPool, reserverProspect, relacherProspect, estRelachable,
  quotaHebdo, quotaRestant, reservationsSemaine, debutSemaine,
} from "./store.js";
import { boot, topbar, toast, tente, badgeCommande, railHTML, esc } from "./ui.js";

const me = await boot("commercial");
const main = document.getElementById("main");

const TABS = [
  { id: "dash", label: "Tableau de bord" },
  { id: "pool", label: "Prospects Cascanics" },
  { id: "prospects", label: "Mes prospects" },
  { id: "commandes", label: "Commandes" },
  { id: "propositions", label: "Propositions" },
  { id: "argumentaire", label: "Argumentaire" },
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
  else if (tab === "pool") renderPool();
  else if (tab === "prospects") renderProspects();
  else if (tab === "commandes") detailCmdId ? renderDetail(detailCmdId) : renderCommandes();
  else if (tab === "argumentaire") renderArgumentaire();
  else renderPropositions();
}

function renderDash() {
  const k = kpisCommercial(me.id);
  const s = load().settings;
  const enCours = mesCommandes().filter((c) => !["livree", "annulee"].includes(c.statut));
  const props = mesPropositions().filter((p) => p.statut === "proposee");
  main.innerHTML = `
    <div class="page-title"><h1>Bonjour, ${esc(me.nom.split(" ")[0])}</h1>
      <span class="sub">Zone : <span class="tag-zone">${esc(me.zone)}</span> · Commission : ${s.commissionPct} % du CA HT encaissé, hors transport</span></div>
    <div class="grid-kpi">
      ${kpi("CA encaissé (HT)", fmtEUR(k.caEncaisse), "eur", "commandes soldées")}
      ${kpi("Commission acquise", fmtEUR(k.commission), "com", s.commissionPct + " % du HT machines encaissé")}
      ${kpi("CA signé (HT)", fmtEUR(k.caSigne), "", k.signees + " commande(s) signée(s)")}
      ${kpi("Pipeline (HT)", fmtEUR(k.pipeline), "", "BC en attente de signature")}
      ${kpi("Visites réalisées", k.visites, "", k.prospects + " prospects au total")}
      ${kpi("Taux de conversion", k.conversion + " %", "", "signatures / visites")}
      ${kpi("Réservations restantes", quotaRestant(me.id) + " / " + quotaHebdo(), "",
            "cette semaine · " + prospectsPool().length + " prospect(s) dans le pool")}
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

/* ---------- Carte + itinéraire (Google Maps / Waze) ---------- */
/* L'aperçu utilise OpenStreetMap (géocodage Nominatim) : pas de clé API et pas
   d'écran de consentement Google qui laisserait une iframe vide. Les boutons
   d'itinéraire ouvrent, eux, directement l'app Google Maps ou Waze. */
const adresseProspect = (p) => [p.adresse, p.ville].filter(Boolean).join(", ");
const geoCache = new Map();

async function ouvrirCarte(id) {
  const p = load().prospects.find((x) => x.id === id);
  if (!p) return;
  const adr = adresseProspect(p);
  // Entreprise + adresse : géocodage plus fiable qu'une adresse seule.
  const q = encodeURIComponent([p.entreprise, adr].filter(Boolean).join(", "));
  document.getElementById("carte-titre").textContent = p.entreprise;
  document.getElementById("carte-adresse").textContent = adr || "Adresse non renseignée — recherche par le nom de l'établissement.";
  document.getElementById("carte-maps").href = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  document.getElementById("carte-waze").href = `https://waze.com/ul?q=${q}&navigate=yes`;
  document.getElementById("carte-gmaps-voir").href = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const frame = document.getElementById("carte-frame");
  frame.src = "about:blank";
  document.getElementById("dlg-carte").showModal();
  try {
    let pos = geoCache.get(p.id);
    if (!pos) {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(adr || p.entreprise + " " + (p.ville || ""))}`);
      const js = await r.json();
      if (js[0]) { pos = { lat: +js[0].lat, lon: +js[0].lon }; geoCache.set(p.id, pos); }
    }
    if (pos) {
      const d = 0.008;
      frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${pos.lon - d},${pos.lat - d},${pos.lon + d},${pos.lat + d}&layer=mapnik&marker=${pos.lat},${pos.lon}`;
    }
  } catch {
    // L'aperçu est un confort : les boutons d'itinéraire restent fonctionnels.
  }
}
document.getElementById("carte-fermer").addEventListener("click", () => {
  document.getElementById("carte-frame").src = "about:blank";
  document.getElementById("dlg-carte").close();
});
function bindCartes() {
  main.querySelectorAll("[data-carte]").forEach((b) =>
    b.addEventListener("click", () => ouvrirCarte(b.dataset.carte))
  );
}

/* ---------- Pool commun : prospects Cascanics à réserver ---------- */
function renderPool() {
  const restant = quotaRestant(me.id);
  const quota = quotaHebdo();
  const pris = reservationsSemaine(me.id);
  const lundi = debutSemaine();
  const prochainLundi = new Date(lundi.getTime() + 7 * 864e5);
  const list = prospectsPool().slice().sort((a, b) =>
    (a.ville || "").localeCompare(b.ville || "") || a.entreprise.localeCompare(b.entreprise));

  const villes = [...new Set(list.map((p) => p.ville).filter(Boolean))].sort();
  const types = [...new Set(list.map((p) => p.type).filter(Boolean))].sort();

  main.innerHTML = `
    <div class="page-title"><h1>Prospects Cascanics</h1>
      <span class="sub">Fichier commun à toute l'équipe — premier arrivé, premier servi</span>
      <span style="margin-left:auto" class="badge ${restant ? "b-vert" : "b-rouge"}">
        ${restant} réservation(s) restante(s) sur ${quota}</span></div>

    <section class="panel">
      <p class="hint" style="line-height:1.7">
        Vous avez réservé <b>${pris}</b> prospect(s) depuis le lundi ${fmtDate(lundi.toISOString())}.
        Le compteur repart à zéro le <b>${fmtDate(prochainLundi.toISOString())}</b>.
        Un prospect réservé bascule dans « Mes prospects » et disparaît de cette liste pour les autres.
        Tant que vous ne l'avez pas visité, vous pouvez le rendre au pool — cela vous rend une réservation.
      </p>
    </section>

    <section class="panel scroll-x">
      <h2>Disponibles <span class="count">${list.length}</span>
        <span style="margin-left:auto; display:flex; gap:8px">
          <select id="pool-ville" class="sm" style="width:auto"><option value="">Toutes les villes</option>
            ${villes.map((v) => `<option>${esc(v)}</option>`).join("")}</select>
          <select id="pool-type" class="sm" style="width:auto"><option value="">Tous les types</option>
            ${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
        </span></h2>
      <table>
        <thead><tr><th>Entreprise</th><th>Type</th><th>Ville</th><th>Adresse</th><th>Contact</th><th></th></tr></thead>
        <tbody id="pool-rows">
          ${list.map((p) => `<tr data-ville="${esc(p.ville)}" data-type="${esc(p.type)}">
            <td><b>${esc(p.entreprise)}</b></td>
            <td class="muted">${esc(p.type)}</td>
            <td>${esc(p.ville)}</td>
            <td class="muted">${esc(p.adresse)}</td>
            <td class="muted">${esc(p.contact)}${p.tel ? "<br />" + esc(p.tel) : ""}</td>
            <td style="white-space:nowrap">
              <button class="btn sm ghost" data-carte="${p.id}" title="Voir sur la carte et lancer l'itinéraire">Carte</button>
              <button class="btn sm primary" data-reserve="${p.id}" ${restant ? "" : "disabled"}>Réserver</button>
            </td>
          </tr>`).join("") || `<tr><td colspan="6"><p class="empty">Le pool est vide. L'administration l'alimente depuis son espace.</p></td></tr>`}
        </tbody>
      </table>
      ${restant ? "" : `<p class="hint" style="margin-top:10px; color:var(--ambre-flux)">
        Quota hebdomadaire atteint. Traitez vos prospects en cours, ou rendez au pool ceux que vous ne visiterez pas.</p>`}
    </section>`;

  const filtrer = () => {
    const v = document.getElementById("pool-ville").value;
    const t = document.getElementById("pool-type").value;
    main.querySelectorAll("#pool-rows tr[data-ville]").forEach((tr) => {
      const ok = (!v || tr.dataset.ville === v) && (!t || tr.dataset.type === t);
      tr.style.display = ok ? "" : "none";
    });
  };
  ["pool-ville", "pool-type"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", filtrer);
  });

  main.querySelectorAll("[data-reserve]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await tente(() => reserverProspect(b.dataset.reserve));
      if (r) { toast(`« ${r.entreprise} » est à vous — il est dans « Mes prospects ».`); render(); }
      else { b.disabled = false; render(); }
    })
  );
  bindCartes();
}

function renderProspects() {
  const list = mesProspects().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  main.innerHTML = `
    <div class="page-title"><h1>Prospection</h1>
      <span class="sub">${list.length} prospect(s) — zone ${esc(me.zone)} · ${quotaRestant(me.id)} réservation(s) restante(s) cette semaine</span>
      <button class="btn primary sm" id="add-prospect" style="margin-left:auto">+ Nouveau prospect</button></div>
    <section class="panel scroll-x">
      <table>
        <thead><tr><th>Entreprise</th><th>Type</th><th>Ville</th><th>Contact</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${list.map((p) => `<tr>
            <td><b>${esc(p.entreprise)}</b>${p.reserveLe
                ? ` <span class="badge b-cyan b-off">Réservé le ${fmtDate(p.reserveLe)}</span>`
                : p.source === "proposition_admin" ? ` <span class="badge b-cyan b-off">Confié par l'admin</span>` : ""}
              ${p.notes.length ? `<div class="muted">${esc(p.notes[p.notes.length - 1].t)}</div>` : ""}</td>
            <td class="muted">${esc(p.type)}</td>
            <td>${esc(p.ville)}</td>
            <td class="muted">${esc(p.contact)}${p.tel ? "<br />" + esc(p.tel) : ""}</td>
            <td><select data-statut="${p.id}" class="sm" style="width:auto">
              ${STATUTS_PROSPECT.map((s) => `<option value="${s.id}" ${s.id === p.statut ? "selected" : ""}>${s.label}</option>`).join("")}
            </select></td>
            <td style="white-space:nowrap">
              <button class="btn sm ghost" data-carte="${p.id}" title="Voir sur la carte et lancer l'itinéraire">Carte</button>
              <button class="btn sm ghost" data-note="${p.id}">+ Note</button>
              <button class="btn sm" data-bc="${p.id}">Bon de commande</button>
              ${estRelachable(p) ? `<button class="btn sm ghost" data-relache="${p.id}" title="Le remettre à disposition de l'équipe">Rendre au pool</button>` : ""}
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
  main.querySelectorAll("[data-relache]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = load().prospects.find((x) => x.id === b.dataset.relache);
      if (!confirm(`Rendre « ${p.entreprise} » au pool ? Il redevient réservable par toute l'équipe et vous récupérez une réservation.`)) return;
      await tente(() => relacherProspect(p.id), "Prospect rendu au pool");
      render();
    })
  );
  bindCartes();
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
            <tr><td>Machine × ${c.qty}${c.remisePct ? ` (remise ${c.remisePct} %)` : ""}</td><td class="num">${fmtEUR2(t.htMachines)} HT</td></tr>
            ${t.transport ? `<tr><td>Transport &amp; livraison</td><td class="num">${fmtEUR2(t.transport)} HT</td></tr>` : ""}
            <tr><td>Total HT</td><td class="num">${fmtEUR2(t.ht)}</td></tr>
            ${+load().settings.tauxTVA
              ? `<tr><td>TVA ${load().settings.tauxTVA} %</td><td class="num">${fmtEUR2(t.tva)}</td></tr>`
              : `<tr><td>TVA non applicable (vendeur hors UE)</td><td class="num">0,00 €</td></tr>`}
            <tr><td><b>Total ${+load().settings.tauxTVA ? "TTC" : "net"}</b></td><td class="num"><b>${fmtEUR2(t.ttc)}</b></td></tr>
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

/* ---------- Argumentaire terrain ----------
   Fiche produit + réponses aux objections. Les chiffres commerciaux sont lus
   dans les réglages pour rester alignés sur les bons de commande. */
function renderArgumentaire() {
  const s = load().settings;
  const ttc = s.prixMachineHT * (1 + s.tauxTVA / 100);

  const bloc = (titre, items) => `<section class="panel">
    <h2>${titre}</h2>
    <ul class="arg-list">${items.map((t) => `<li>${t}</li>`).join("")}</ul>
  </section>`;

  const objections = [
    ["« Je n'ai pas la place. »",
     "66 × 56 cm au sol, moins de 0,4 m². Une prise 220 V standard suffit : ni arrivée d'eau, ni évacuation, ni génie civil. Intérieur ou extérieur abrité."],
    ["« C'est cher. »",
     `Ramenez-le au cycle : la machine tourne sans personnel, 7 j/7. Ajoutez la location d'espaces publicitaires sur l'écran, et vous avez deux revenus pour un seul investissement. Financement possible : ${fmtEUR2(ttc / 2)} à la commande, le solde seulement après contrôle qualité.`],
    ["« Et si elle tombe en panne ? »",
     "Garantie 12 mois : support technique à distance et pièces remplacées. La supervision à distance nous alerte souvent avant que le client ne voie le problème."],
    ["« Mes clients ne paieront pas. »",
     "Aucun frein au paiement : CB sans contact, Visa, Mastercard, Apple Pay, Google Pay, plus billets et pièces. Le client paie comme il veut, en trois gestes."],
    ["« Il faut quelqu'un pour s'en occuper ? »",
     "Non. Le client scanne, choisit son cycle, récupère son casque. Vous pilotez le chiffre d'affaires, les prix et les alertes depuis votre téléphone."],
    ["« Ça abîme les casques ? »",
     "Aucun démontage, aucun contact avec l'eau : brume active, UV-C, séchage à air tempéré. C'est justement l'argument contre le lavage à la main."],
    ["« Quel délai ? »",
     `${s.delaiFabricationJours} jours de fabrication si la machine n'est pas en stock, à compter de la réception de l'acompte. Vérifiez le stock dans le CRM avant de vous engager sur une date.`],
  ];

  main.innerHTML = `
    <div class="page-title"><h1>Argumentaire</h1>
      <span class="sub">Ce que vous vendez, ce qui est compris, et quoi répondre</span></div>

    <div class="arg-grid">
      ${bloc("La machine en 30 secondes", [
        "<b>Double caisson</b> : 2 casques traités en même temps — duos, groupes, flux de station.",
        "<b>Écran tactile 21,5 pouces</b> : parcours en 3 gestes, aucun personnel requis.",
        "<b>Sans eau, sans démontage</b> : brume active 360°, traitement UV-C, séchage air maîtrisé.",
        "<b>Multi-casques</b> : moto, scooter, ski, vélo, chantier — le marché dépasse les motards.",
        "<b>Supervision à distance</b> : chiffre d'affaires, alertes et prix depuis le téléphone.",
      ])}

      ${bloc("Ce qui est compris", [
        "Habillage personnalisé aux couleurs du client.",
        "Encaissement complet : CB sans contact, Visa, Mastercard, Apple Pay, Google Pay, billets et pièces en euros.",
        "Caisse bois de transport.",
        "Installation, paramétrage des cycles et des prix, prise en main.",
        "Garantie 12 mois : support technique à distance et pièces remplacées.",
      ])}

      ${bloc("Encombrement &amp; installation", [
        "Machine : <b>1830 × 660 × 560 mm</b>, 125 kg — moins de 0,4 m² au sol.",
        "Emballée : 1960 × 750 × 650 mm, 145 kg, 0,96 m³ — prévoir l'accès de livraison.",
        "Alimentation <b>220 V</b>, prise standard. Ni arrivée d'eau, ni évacuation.",
        "Intérieur ou extérieur abrité.",
      ])}

      <section class="panel arg-revenus">
        <h2>Deux sources de revenus</h2>
        <div class="arg-rev">
          <div><span class="k-label">1 — Les cycles</span>
            <p>La machine encaisse seule, 7 j/7, sans personnel ni gestion de caisse.</p></div>
          <div><span class="k-label">2 — L'écran</span>
            <p>Entre deux casques, l'écran 21,5 pouces diffuse ce que le client décide :
               ses propres offres, ou des publicités locales qu'il facture aux commerces
               voisins — garage, auto-école, assureur, restaurant. Un revenu qui tombe
               même quand personne ne lave son casque.</p></div>
        </div>
        <p class="hint">C'est souvent l'argument qui débloque : l'écran travaille alors que la machine est à l'arrêt.</p>
      </section>

      <section class="panel">
        <h2>Conditions commerciales</h2>
        <table>
          <tr><td>Prix machine</td><td class="num"><b>${fmtEUR2(s.prixMachineHT)} HT</b> · ${fmtEUR2(ttc)} TTC</td></tr>
          <tr><td>Acompte à la commande</td><td class="num" style="color:var(--ambre-flux)">50 % — ${fmtEUR2(ttc / 2)}</td></tr>
          <tr><td>Solde avant départ, après contrôle qualité</td><td class="num" style="color:var(--ambre-flux)">50 % — ${fmtEUR2(ttc / 2)}</td></tr>
          <tr><td>Fabrication hors stock</td><td class="num">${s.delaiFabricationJours} jours après acompte</td></tr>
          <tr><td>Machines en stock</td><td class="num">${s.stockMachines}</td></tr>
          <tr><td>Votre commission</td><td class="num" style="color:var(--vert-valide)">${s.commissionPct} % du CA HT encaissé, hors transport</td></tr>
        </table>
        <p class="hint">Remise possible jusqu'à 15 % depuis le bon de commande. Le placement en dépôt n'est pas encore ouvert à la vente.</p>
      </section>
    </div>

    <section class="panel">
      <h2>Objections fréquentes <span class="count">${objections.length}</span></h2>
      ${objections.map(([q, r]) => `<div class="obj"><b>${q}</b><p>${r}</p></div>`).join("")}
    </section>`;
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
  const transport = Math.max(0, +document.getElementById("c-transport").value || 0);
  const htMachines = qty * s.prixMachineHT * (1 - remise / 100);
  const ht = htMachines + transport;
  const ttc = ht * (1 + s.tauxTVA / 100);
  document.getElementById("c-stock-info").innerHTML = s.stockMachines >= qty
    ? `✔ ${s.stockMachines} machine(s) en stock — expédition rapide.`
    : `⚠ Stock insuffisant : fabrication sous <b>${s.delaiFabricationJours} jours</b> après acompte.`;
  document.getElementById("c-totaux").innerHTML =
    `Total : <b>${fmtEUR2(ttc)} TTC</b>${transport ? ` (dont ${fmtEUR2(transport)} HT de transport)` : ""} — Acompte 50 % : <b style="color:var(--ambre-flux)">${fmtEUR2(ttc / 2)}</b> · Solde 50 % avant départ : <b style="color:var(--ambre-flux)">${fmtEUR2(ttc / 2)}</b>
     <br />Commission sur cette commande : <b style="color:var(--vert-valide)">${fmtEUR2(htMachines * s.commissionPct / 100)}</b> (${s.commissionPct} % du HT machines, hors transport)`;
}
["c-qty", "c-remise", "c-transport"].forEach((id) => document.getElementById(id).addEventListener("input", majTotauxDialog));
document.getElementById("form-commande").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  const s = load().settings;
  const qty = Math.max(1, +document.getElementById("c-qty").value || 1);
  const cmd = await tente(() => creerCommande({
    clientId: document.getElementById("c-client").value,
    commercialId: me.id,
    qty,
    remisePct: Math.min(15, Math.max(0, +document.getElementById("c-remise").value || 0)),
    transportHT: Math.max(0, +document.getElementById("c-transport").value || 0),
    avecStock: s.stockMachines >= qty,
  }));
  if (cmd) {
    toast("Bon de commande " + cmd.numero + " créé");
    tab = "commandes"; detailCmdId = cmd.id;
  }
  render();
});

render();
