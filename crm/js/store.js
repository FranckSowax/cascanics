/* ==========================================================================
   CASCANICS CRM — store.js
   Couche de données unique, branchée sur Supabase (Auth + Postgres/RLS).
   Au chargement, tout ce que l'utilisateur a le droit de voir est chargé
   en mémoire (cache `db`) ; chaque mutation écrit en base puis met à jour
   le cache. Les interfaces restent synchrones via load().
   ========================================================================== */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- Workflow commande ----------
   Les deux jalons de paiement (50 % / 50 %) sont des verrous. */
export const ETAPES = [
  { id: "brouillon",        label: "Brouillon",            who: "commercial" },
  { id: "envoyee",          label: "BC envoyé",            who: "commercial" },
  { id: "signee",           label: "Signé client",         who: "commercial" },
  { id: "acompte_recu",     label: "Acompte 50 % reçu",    who: "admin", gate: "50 %" },
  { id: "en_production",    label: "En production",        who: "admin" },
  { id: "controle_qualite", label: "Contrôle qualité OK",  who: "admin" },
  { id: "solde_recu",       label: "Solde 50 % reçu",      who: "admin", gate: "50 %" },
  { id: "expediee",         label: "Expédiée",             who: "admin" },
  { id: "livree",           label: "Livrée",               who: "admin" },
];

export const STATUTS_PROSPECT = [
  { id: "a_visiter", label: "À visiter" },
  { id: "visite",    label: "Visité" },
  { id: "interesse", label: "Intéressé" },
  { id: "devis",     label: "BC envoyé" },
  { id: "client",    label: "Client" },
  { id: "perdu",     label: "Perdu" },
];

export const TYPES_PROSPECT = [
  "Concession moto", "Accessoiriste moto", "Station-service",
  "Aire d'autoroute", "Loueur / flotte", "Salle de sport",
  "Station de ski", "Centre de contrôle technique", "Autre",
];

/* ---------- Cache mémoire ---------- */
let db = null;
let me = null;

export function load() {
  if (!db) throw new Error("Store non initialisé — appeler initStore() d'abord.");
  return db;
}
export function currentUser() { return me; }

/* Conversions snake_case (base) ↔ camelCase (UI) */
const p2js = (r) => ({ id: r.id, commercialId: r.commercial_id, entreprise: r.entreprise, type: r.type, ville: r.ville, adresse: r.adresse, contact: r.contact, tel: r.tel, email: r.email, statut: r.statut, source: r.source, notes: r.notes || [], createdAt: r.created_at });
const c2js = (r) => ({ id: r.id, numero: r.numero, clientId: r.client_id, commercialId: r.commercial_id, offre: r.offre, qty: r.qty, prixUnitaireHT: +r.prix_unitaire_ht, remisePct: +r.remise_pct, statut: r.statut, avecStock: r.avec_stock, historique: r.historique || [], createdAt: r.created_at });
const u2js = (r) => ({ id: r.id, role: r.role, nom: r.nom, zone: r.zone, tel: r.tel, email: r.email });
const pr2js = (r) => ({ id: r.id, commercialId: r.commercial_id, zone: r.zone, cible: r.cible, message: r.message, statut: r.statut, createdAt: r.created_at });

function fail(error, quoi) {
  console.error(quoi, error);
  throw new Error(quoi + " : " + (error.message || "erreur inconnue"));
}

/* ---------- Init : session + chargement complet ---------- */
export async function initStore() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return null;
  const charge = () => Promise.all([
    supa.from("profiles").select("*").order("nom"),
    supa.from("prospects").select("*"),
    supa.from("commandes").select("*"),
    supa.from("propositions").select("*"),
    supa.from("settings").select("data").eq("id", 1).single(),
  ]);
  let [profils, prospects, commandes, propositions, settings] = await charge();
  // Juste après l'émission du jeton, un léger décalage d'horloge côté serveur
  // peut produire « JWT issued at future » : on attend et on réessaie une fois.
  if ([profils, prospects, commandes, propositions, settings].some((r) => r.error && /issued at future/i.test(r.error.message || ""))) {
    await new Promise((res) => setTimeout(res, 1800));
    [profils, prospects, commandes, propositions, settings] = await charge();
  }
  for (const r of [profils, prospects, commandes, propositions, settings]) {
    if (r.error) fail(r.error, "Chargement des données");
  }
  db = {
    users: profils.data.map(u2js),
    prospects: prospects.data.map(p2js),
    commandes: commandes.data.map(c2js),
    propositions: propositions.data.map(pr2js),
    settings: settings.data.data,
  };
  me = db.users.find((u) => u.id === session.user.id) || null;
  return me;
}

/* ---------- Auth ---------- */
export async function login(email, password) {
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) fail(error, "Connexion");
  return initStore();
}

export async function logout() {
  await supa.auth.signOut();
  db = null; me = null;
}

/* ---------- Helpers métier (purs) ---------- */
export function totaux(cmd) {
  const s = load().settings;
  const brutHT = cmd.qty * cmd.prixUnitaireHT;
  const ht = brutHT * (1 - (cmd.remisePct || 0) / 100);
  const tva = ht * s.tauxTVA / 100;
  const ttc = ht + tva;
  return { brutHT, ht, tva, ttc, acompte: ttc / 2, solde: ttc / 2 };
}

export function etapeIndex(statut) {
  return ETAPES.findIndex((e) => e.id === statut);
}

export function prochaineEtape(cmd) {
  const i = etapeIndex(cmd.statut);
  if (i < 0 || i >= ETAPES.length - 1 || cmd.statut === "annulee") return null;
  return ETAPES[i + 1];
}

export function dateLivraisonEstimee(cmd) {
  const s = load().settings;
  const dep = cmd.historique.find((h) => h.statut === "acompte_recu");
  const base = dep ? new Date(dep.d) : new Date();
  const jours = cmd.avecStock ? 5 : s.delaiFabricationJours + 5; // +5 j logistique
  return new Date(base.getTime() + jours * 864e5);
}

export function kpisCommercial(commercialId) {
  const d = load();
  const mesProspects = d.prospects.filter((p) => p.commercialId === commercialId);
  const mesCmd = d.commandes.filter((c) => c.commercialId === commercialId && c.statut !== "annulee");
  const encaissees = mesCmd.filter((c) => etapeIndex(c.statut) >= etapeIndex("solde_recu"));
  const signees = mesCmd.filter((c) => etapeIndex(c.statut) >= etapeIndex("signee"));
  const caEncaisse = encaissees.reduce((s, c) => s + totaux(c).ht, 0);
  const caSigne = signees.reduce((s, c) => s + totaux(c).ht, 0);
  const pipeline = mesCmd.filter((c) => etapeIndex(c.statut) < etapeIndex("signee")).reduce((s, c) => s + totaux(c).ht, 0);
  const visites = mesProspects.filter((p) => p.statut !== "a_visiter").length;
  return {
    prospects: mesProspects.length,
    visites,
    devis: mesCmd.length,
    signees: signees.length,
    caSigne, caEncaisse, pipeline,
    commission: caEncaisse * d.settings.commissionPct / 100,
    conversion: visites ? Math.round((signees.length / visites) * 100) : 0,
  };
}

/* ---------- Mutations : prospects ---------- */
export async function addProspect(p) {
  const { data, error } = await supa.from("prospects").insert({
    commercial_id: p.commercialId, entreprise: p.entreprise, type: p.type,
    ville: p.ville, adresse: p.adresse, contact: p.contact, tel: p.tel,
    email: p.email, source: p.source || "perso",
  }).select().single();
  if (error) fail(error, "Ajout du prospect");
  const js = p2js(data);
  load().prospects.push(js);
  return js;
}

export async function patchProspect(id, patch) {
  const snake = {};
  if ("statut" in patch) snake.statut = patch.statut;
  if ("notes" in patch) snake.notes = patch.notes;
  const { error } = await supa.from("prospects").update(snake).eq("id", id);
  if (error) fail(error, "Mise à jour du prospect");
  Object.assign(load().prospects.find((p) => p.id === id), patch);
}

/* ---------- Mutations : commandes ---------- */
export async function creerCommande({ clientId, commercialId, qty, remisePct, avecStock }) {
  const d = load();
  const historique = [{ statut: "brouillon", d: new Date().toISOString() }];
  const { data, error } = await supa.from("commandes").insert({
    client_id: clientId, commercial_id: commercialId, qty,
    prix_unitaire_ht: d.settings.prixMachineHT, remise_pct: remisePct || 0,
    avec_stock: !!avecStock, historique,
  }).select().single();
  if (error) fail(error, "Création du bon de commande");
  const js = c2js(data);
  d.commandes.push(js);
  const p = d.prospects.find((p) => p.id === clientId);
  if (p && p.statut !== "client") await patchProspect(clientId, { statut: "devis" });
  return js;
}

export async function avancerCommande(cmdId) {
  const d = load();
  const cmd = d.commandes.find((c) => c.id === cmdId);
  const next = cmd && prochaineEtape(cmd);
  if (!next) return null;
  const historique = [...cmd.historique, { statut: next.id, d: new Date().toISOString() }];
  const { error } = await supa.from("commandes").update({ statut: next.id, historique }).eq("id", cmdId);
  if (error) fail(error, "Avancement de la commande");
  cmd.statut = next.id;
  cmd.historique = historique;
  // Machine prise sur le stock au paiement de l'acompte.
  if (next.id === "acompte_recu" && cmd.avecStock && d.settings.stockMachines > 0) {
    await saveSettings({ ...d.settings, stockMachines: Math.max(0, d.settings.stockMachines - cmd.qty) });
  }
  // Le prospect devient client à la signature.
  if (next.id === "signee") {
    const p = d.prospects.find((p) => p.id === cmd.clientId);
    if (p && p.statut !== "client") await patchProspect(p.id, { statut: "client" });
  }
  return next;
}

export async function annulerCommande(cmdId) {
  const cmd = load().commandes.find((c) => c.id === cmdId);
  if (!cmd) return;
  const historique = [...cmd.historique, { statut: "annulee", d: new Date().toISOString() }];
  const { error } = await supa.from("commandes").update({ statut: "annulee", historique }).eq("id", cmdId);
  if (error) fail(error, "Annulation de la commande");
  cmd.statut = "annulee";
  cmd.historique = historique;
}

/* ---------- Import de prospects (JSON de recherche) ---------- */

const sansAccent = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const cle = (entreprise, ville) => sansAccent(entreprise).replace(/[^a-z0-9]/g, "") + "|" + sansAccent(ville).replace(/[^a-z0-9]/g, "");

/* Ramène un libellé libre vers un type du CRM. */
export function normaliserType(valeur) {
  const v = sansAccent(valeur).replace(/[-_/]/g, " ").replace(/\s+/g, " ");
  const exact = TYPES_PROSPECT.find((t) => sansAccent(t).replace(/[-_/]/g, " ").replace(/\s+/g, " ") === v);
  if (exact) return exact;
  if (!v) return "Autre";
  const a = (...mots) => mots.some((m) => v.includes(m));
  if (a("controle technique", "ct auto")) return "Centre de contrôle technique";
  if (a("ski", "montagne", "station de ski")) return "Station de ski";
  if (a("sport", "gym", "fitness", "musculation")) return "Salle de sport";
  if (a("autoroute", "aire de")) return "Aire d'autoroute";
  if (a("loueur", "location", "flotte", "livraison", "coursier")) return "Loueur / flotte";
  if (a("station service", "station essence", "carburant", "essence", "petrole")) return "Station-service";
  if (a("accessoir", "equipement", "equipementier", "piece")) return "Accessoiriste moto";
  if (a("concession", "concessionnaire", "garage", "moto", "scooter", "deux roues")) return "Concession moto";
  return "Autre";
}

/* Analyse le JSON collé par l'admin. Fonction pure : ne touche ni au réseau ni au cache.
   Renvoie les lignes prêtes à insérer, les doublons et les rejets (avec la raison). */
export function analyserImport(texte, { commercialParDefaut, commerciaux, existants }) {
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch (e) {
    // Tolère un bloc ```json … ``` copié tel quel depuis une conversation.
    const bloc = String(texte).match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!bloc) return { erreurGlobale: "JSON invalide : " + e.message, valides: [], doublons: [], rejets: [] };
    try { brut = JSON.parse(bloc[1]); }
    catch (e2) { return { erreurGlobale: "JSON invalide : " + e2.message, valides: [], doublons: [], rejets: [] }; }
  }
  const liste = Array.isArray(brut) ? brut : Array.isArray(brut?.prospects) ? brut.prospects : null;
  if (!liste) return { erreurGlobale: "Format attendu : un tableau, ou un objet avec une clé « prospects ».", valides: [], doublons: [], rejets: [] };

  const vus = new Set(existants.map((p) => cle(p.entreprise, p.ville)));
  const valides = [], doublons = [], rejets = [];

  liste.forEach((item, i) => {
    const rang = i + 1;
    if (!item || typeof item !== "object") { rejets.push({ rang, libelle: "entrée " + rang, raison: "n'est pas un objet" }); return; }
    const entreprise = String(item.entreprise ?? item.nom ?? "").trim();
    if (!entreprise) { rejets.push({ rang, libelle: "entrée " + rang, raison: "nom d'entreprise manquant" }); return; }
    const ville = String(item.ville ?? "").trim();
    const k = cle(entreprise, ville);
    if (vus.has(k)) { doublons.push({ rang, libelle: entreprise + (ville ? " — " + ville : "") }); return; }
    vus.add(k);

    // Un e-mail ou un nom dans « commercial » permet de répartir un lot entre plusieurs zones.
    let commercialId = commercialParDefaut;
    const cible = String(item.commercial ?? "").trim();
    if (cible) {
      const u = commerciaux.find((u) => sansAccent(u.email) === sansAccent(cible) || sansAccent(u.nom) === sansAccent(cible));
      if (u) commercialId = u.id;
      else { rejets.push({ rang, libelle: entreprise, raison: "commercial « " + cible + " » inconnu" }); return; }
    }
    if (!commercialId) { rejets.push({ rang, libelle: entreprise, raison: "aucun commercial destinataire" }); return; }

    // notes accepte une phrase, une liste de phrases, ou le format interne [{d,t}].
    const n = item.notes ?? item.note ?? "";
    const textes = (Array.isArray(n) ? n : [n])
      .map((x) => (x && typeof x === "object" ? x.t : x))
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    const maintenant = new Date().toISOString();

    valides.push({
      commercialId,
      entreprise: entreprise.slice(0, 160),
      type: normaliserType(item.type),
      ville: String(item.ville ?? "").trim().slice(0, 120),
      adresse: String(item.adresse ?? "").trim().slice(0, 240),
      contact: String(item.contact ?? "").trim().slice(0, 120),
      tel: String(item.tel ?? item.telephone ?? "").trim().slice(0, 40),
      email: String(item.email ?? "").trim().slice(0, 160),
      notes: textes.map((t) => ({ d: maintenant, t })),
    });
  });

  return { erreurGlobale: null, valides, doublons, rejets, zone: brut?.zone || "" };
}

export async function importerProspects(lignes) {
  if (!lignes.length) return [];
  const { data, error } = await supa.from("prospects").insert(
    lignes.map((l) => ({
      commercial_id: l.commercialId, entreprise: l.entreprise, type: l.type,
      ville: l.ville, adresse: l.adresse, contact: l.contact, tel: l.tel,
      email: l.email, notes: l.notes, source: "proposition_admin",
    }))
  ).select();
  if (error) fail(error, "Import des prospects");
  const js = data.map(p2js);
  load().prospects.push(...js);
  return js;
}

/* ---------- Mutations : propositions ---------- */
export async function addProposition(pr) {
  const { data, error } = await supa.from("propositions").insert({
    commercial_id: pr.commercialId, zone: pr.zone, cible: pr.cible, message: pr.message,
  }).select().single();
  if (error) fail(error, "Envoi de la proposition");
  const js = pr2js(data);
  load().propositions.push(js);
  return js;
}

export async function patchProposition(id, statut) {
  const { error } = await supa.from("propositions").update({ statut }).eq("id", id);
  if (error) fail(error, "Mise à jour de la proposition");
  load().propositions.find((p) => p.id === id).statut = statut;
}

/* ---------- Mutations : réglages & équipe (admin) ---------- */
export async function saveSettings(data) {
  const { error } = await supa.from("settings").update({ data }).eq("id", 1);
  if (error) fail(error, "Enregistrement des réglages");
  load().settings = data;
}

export async function creerCommercial({ email, password, nom, zone, tel }) {
  const { data, error } = await supa.rpc("creer_commercial", {
    p_email: email, p_password: password, p_nom: nom, p_zone: zone || "", p_tel: tel || "",
  });
  if (error) fail(error, "Création du compte commercial");
  load().users.push({ id: data, role: "commercial", nom, zone, tel, email });
  return data;
}

/* ---------- Formats ---------- */
export function fmtEUR(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
export function fmtEUR2(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}
export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
