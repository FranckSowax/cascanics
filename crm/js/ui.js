/* Helpers UI partagés (démarrage, topbar, toast, badges). */
import { initStore, logout, ETAPES, etapeIndex, STATUTS_PROSPECT } from "./store.js";

/* Initialise le store (session Supabase + données) et vérifie le rôle. */
export async function boot(role) {
  let u = null;
  try { u = await initStore(); }
  catch (e) { console.error(e); }
  if (!u || (role && u.role !== role)) {
    location.href = "index.html";
    throw new Error("non connecté");
  }
  return u;
}

export function topbar(user, tabs, sub) {
  const el = document.querySelector(".topbar");
  el.innerHTML = `
    <a class="brand" href="index.html">
      <img src="../assets/logo-emblem.png" alt="" /> CASCANICS <small>${sub}</small>
    </a>
    <nav>${tabs.map((t) => `<button data-tab="${t.id}">${t.label}</button>`).join("")}</nav>
    <div class="who"><span><b>${user.nom}</b>${user.zone ? " · " + user.zone : ""}</span>
      <a class="btn ghost sm" href="guide.html" target="_blank" rel="noopener">Guide</a>
      <button class="btn ghost sm" id="logout">Se déconnecter</button></div>`;
  el.querySelector("#logout").addEventListener("click", async () => {
    await logout();
    location.href = "index.html";
  });
  const btns = [...el.querySelectorAll("[data-tab]")];
  return function activate(id, cb) {
    btns.forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    document.querySelectorAll("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== id; });
    if (cb) cb(id);
  };
}

let toastTimer;
export function toast(msg, erreur) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.borderLeftColor = erreur ? "var(--rouge)" : "var(--vert-valide)";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), erreur ? 4500 : 2600);
}

/* Exécute une mutation asynchrone : toast d'erreur si elle échoue. */
export async function tente(fn, okMsg) {
  try {
    const res = await fn();
    if (okMsg) toast(okMsg);
    return res;
  } catch (e) {
    toast(e.message, true);
    return undefined;
  }
}

const COULEUR_ETAPE = {
  brouillon: "", envoyee: "b-bleu", signee: "b-bleu",
  acompte_recu: "b-ambre", en_production: "b-cyan", controle_qualite: "b-cyan",
  solde_recu: "b-ambre", expediee: "b-vert", livree: "b-vert", annulee: "b-rouge",
};
export function badgeCommande(statut) {
  const e = ETAPES.find((e) => e.id === statut);
  const label = e ? e.label : "Annulée";
  return `<span class="badge ${COULEUR_ETAPE[statut] || ""}">${label}</span>`;
}

const COULEUR_PROSPECT = {
  a_visiter: "", visite: "b-bleu", interesse: "b-cyan",
  devis: "b-ambre", client: "b-vert", perdu: "b-rouge",
};
export function badgeProspect(statut) {
  const s = STATUTS_PROSPECT.find((s) => s.id === statut);
  return `<span class="badge ${COULEUR_PROSPECT[statut] || ""}">${s ? s.label : statut}</span>`;
}

/* Rail vertical du cycle de commande. */
export function railHTML(cmd, fmtDate) {
  const cur = etapeIndex(cmd.statut);
  const annulee = cmd.statut === "annulee";
  return `<div class="rail">` + ETAPES.map((e, i) => {
    const h = cmd.historique.find((x) => x.statut === e.id);
    const cls = [
      "step",
      e.gate ? "gate" : "",
      !annulee && i < cur ? "done" : "",
      !annulee && i === cur ? (i === ETAPES.length - 1 ? "done" : "now") : "",
    ].join(" ");
    return `<div class="${cls}">
      <span class="dot">${e.gate ? "½" : (!annulee && i <= cur ? "✓" : "")}</span>
      <span class="s-label">${e.label} ${e.gate ? `<span class="s-gate-tag">PAIEMENT</span>` : ""}</span>
      <span class="s-date">${h ? fmtDate(h.d) : ""}</span>
    </div>`;
  }).join("") + `</div>`;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
