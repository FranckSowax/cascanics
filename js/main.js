/* ==========================================================================
   CASCANICS — main.js
   Lenis + GSAP ScrollTrigger : sections scrub pinnées, overlays synchronisés,
   compteurs, navbar, formulaire. Fallback statique si prefers-reduced-motion.
   ========================================================================== */

import { FrameScrubber } from "./scrub.js";

/* ?static dans l'URL force le mode statique (QA du fallback reduced-motion) */
const REDUCED =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  new URLSearchParams(location.search).has("static");

/* Durées d'animation des overlays, en % de la progression de section */
const FADE_IN = 3;
const FADE_OUT = 3;
const WHIP = 2;

/* Teintes d'univers (S3) — appliquées en soft-light sur le canvas */
const TINTS = {
  brume: "rgba(127, 216, 232, 0.28)",
  uv: "rgba(75, 123, 255, 0.30)",
  air: "rgba(240, 164, 91, 0.28)",
  none: "rgba(0, 0, 0, 0)",
};

init();

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  setupNavbar();
  setupForm();
  setupCtaPreselect();

  if (REDUCED) {
    document.body.classList.add("static-mode");
    hideLoader();
    setupStaticFades();
    return;
  }

  await waitForLibs();
  gsap.registerPlugin(ScrollTrigger);

  const lenis = setupLenis();
  const manifest = await loadManifest();

  const sections = [...document.querySelectorAll(".scrub")];
  const scrubbers = sections.map((section) => {
    const seg = section.dataset.seg;
    return new FrameScrubber(section.querySelector("canvas"), {
      path: `frames/seg${seg}`,
      count: manifest[`seg${seg}`] || 150,
    });
  });

  // Préchargement : 30 premières frames du hero en priorité, avec loader
  await preloadHero(scrubbers[0]);
  hideLoader();

  sections.forEach((section, i) => setupScrubSection(section, scrubbers[i]));
  setupCounters();
  setupAnchors(lenis);

  // Le reste : seg1 complet, puis seg2 et seg3 pendant les temps morts
  scrubbers[0].loadRest()
    .then(() => scrubbers[1].loadRest())
    .then(() => scrubbers[2].loadRest());
}

/* ---------- Librairies CDN (defer) ---------- */
function waitForLibs() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.gsap && window.ScrollTrigger && window.Lenis) resolve();
      else setTimeout(check, 30);
    };
    check();
  });
}

/* ---------- Lenis, synchronisé avec ScrollTrigger ---------- */
function setupLenis() {
  const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

/* ---------- Manifest des frames ---------- */
async function loadManifest() {
  try {
    const res = await fetch("frames/manifest.json");
    const data = await res.json();
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const key = mobile ? "mobile" : "desktop";
    return {
      seg1: data.seg1[key],
      seg2: data.seg2[key],
      seg3: data.seg3[key],
    };
  } catch {
    return { seg1: 150, seg2: 150, seg3: 150 };
  }
}

/* ---------- Loader ---------- */
function preloadHero(scrubber) {
  const loader = document.getElementById("loader");
  const bar = document.getElementById("loader-bar");
  // La barre de progression n'apparaît que si le chargement dépasse 1,5 s
  const barTimer = setTimeout(() => loader.classList.add("show-bar"), 1500);
  return scrubber
    .loadPriority(30, (p) => { bar.style.width = `${Math.round(p * 100)}%`; })
    .then(() => clearTimeout(barTimer));
}

function hideLoader() {
  document.getElementById("loader").classList.add("is-hidden");
}

/* ==========================================================================
   Sections scrub : pin + timeline 0–100 pilotée par la progression
   ========================================================================== */
function setupScrubSection(section, scrubber) {
  const pin = parseInt(section.dataset.pin, 10) || 300;
  const state = { frame: 0 };

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: `+=${pin}%`,
      pin: true,
      scrub: 0.8,
      anticipatePin: 1,
    },
    defaults: { ease: "none" },
  });

  // Scrub vidéo : 0 → dernière frame sur toute la timeline (100 unités)
  tl.to(state, {
    frame: scrubber.count - 1,
    duration: 100,
    onUpdate: () => scrubber.draw(state.frame),
  }, 0);

  // Overlays pilotés par leurs data-attributes (réglage fin : voir RECETTE.md)
  // Le positionnement CSS des .ov utilise transform (centrage) : GSAP anime
  // donc l'opacité sur l'overlay et les mouvements sur un wrapper interne.
  section.querySelectorAll(".ov").forEach((ov) => {
    const at = parseFloat(ov.dataset.in);
    const out = parseFloat(ov.dataset.out);
    const stay = ov.dataset.stay === "true";
    const stamp = ov.dataset.stamp ? parseFloat(ov.dataset.stamp) : null;

    const inner = document.createElement("div");
    inner.className = "ov-in";
    while (ov.firstChild) inner.appendChild(ov.firstChild);
    ov.appendChild(inner);

    // Entrée — fade + translateY 20px (ou slide horizontal)
    if (ov.classList.contains("is-on")) {
      // Visible dès le début (logo hero) : pas de tween d'entrée
    } else if (ov.dataset.fxIn === "slide-right") {
      tl.fromTo(ov, { autoAlpha: 0 }, { autoAlpha: 1, duration: FADE_IN }, at)
        .fromTo(inner, { x: 60 }, { x: 0, duration: FADE_IN, ease: "power2.out" }, at);
    } else {
      tl.fromTo(ov, { autoAlpha: 0 }, { autoAlpha: 1, duration: FADE_IN }, at)
        .fromTo(inner, { y: 20 }, { y: 0, duration: FADE_IN, ease: "power2.out" }, at);
    }

    // Effet « stamp » sur les freezes (cards du cycle)
    if (stamp !== null) {
      tl.to(ov, { "--stamp": 1, duration: 1.2 }, stamp)
        .to(inner, { scale: 1.02, duration: 1.2, ease: "power2.out" }, stamp)
        .to(inner, { scale: 1, duration: 1 }, stamp + 1.4);
    }

    // Sortie — fade, ou whip latéral (suivant le sens du balayage vidéo)
    if (!stay) {
      if (ov.dataset.fxOut === "whip-left") {
        tl.to(ov, { autoAlpha: 0, "--stamp": 0, duration: WHIP }, out)
          .to(inner, { x: -140, duration: WHIP, ease: "power3.in" }, out);
      } else if (ov.dataset.fxOut === "whip-right") {
        tl.to(ov, { autoAlpha: 0, "--stamp": 0, duration: WHIP }, out)
          .to(inner, { x: 140, duration: WHIP, ease: "power3.in" }, out);
      } else {
        tl.to(ov, { autoAlpha: 0, duration: FADE_OUT }, out)
          .to(inner, { y: -20, duration: FADE_OUT, ease: "power2.in" }, out);
      }
    }

    // Vignette renforcée pendant le moment choc (S1)
    if (ov.dataset.boost === "true") {
      const boost = section.querySelector(".vignette-boost");
      if (boost) {
        tl.to(boost, { opacity: 1, duration: FADE_IN }, at)
          .to(boost, { opacity: 0, duration: FADE_OUT }, out);
      }
    }
  });

  // Color tints par univers (S3 uniquement)
  const tint = section.querySelector(".tint");
  if (tint && section.id === "cycle") {
    tl.to(tint, { backgroundColor: TINTS.brume, duration: 3 }, 5)
      .to(tint, { backgroundColor: TINTS.uv, duration: 3 }, 32)
      .to(tint, { backgroundColor: TINTS.air, duration: 3 }, 60)
      .to(tint, { backgroundColor: TINTS.none, duration: 4 }, 94);
  }
}

/* ==========================================================================
   Sections statiques
   ========================================================================== */
function setupCounters() {
  document.querySelectorAll(".count").forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || "";
    const state = { v: 0 };
    el.textContent = prefix + "0";
    gsap.to(state, {
      v: target,
      duration: 1.4,
      ease: "power2.out",
      snap: { v: 1 },
      scrollTrigger: { trigger: el, start: "top 85%", once: true },
      onUpdate: () => { el.textContent = prefix + Math.round(state.v); },
    });
  });

  gsap.utils.toArray(".fade-in").forEach((el) => {
    gsap.fromTo(el, { autoAlpha: 0, y: 24 }, {
      autoAlpha: 1, y: 0, duration: 0.8, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  });
}

/* ---------- Navbar : transparent → noir-carbone après 80 px ---------- */
function setupNavbar() {
  const nav = document.getElementById("nav");
  const update = () => nav.classList.toggle("is-solid", window.scrollY > 80);
  window.addEventListener("scroll", update, { passive: true });
  update();
}

/* ---------- Ancres lissées par Lenis ---------- */
function setupAnchors(lenis) {
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    });
  });
}

/* ---------- CTA orbit/offres → préselection du projet dans le form ---------- */
function setupCtaPreselect() {
  document.querySelectorAll("a[data-projet]").forEach((a) => {
    a.addEventListener("click", () => {
      const select = document.getElementById("f-projet");
      if (select) select.value = a.dataset.projet;
    });
  });
}

/* ---------- Formulaire (Formspree) ---------- */
function setupForm() {
  const form = document.getElementById("devis-form");
  const status = document.getElementById("form-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    status.textContent = "Envoi en cours…";
    status.className = "form-status";
    try {
      const res = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        form.reset();
        status.textContent = "Demande envoyée. Nous vous recontactons sous 24 h ouvrées.";
        status.className = "form-status ok";
      } else {
        throw new Error();
      }
    } catch {
      status.textContent = "Une erreur est survenue. Écrivez-nous directement : contact@cascanics.com";
      status.className = "form-status err";
    }
  });
}

/* ---------- Fallback reduced-motion : fades simples à l'IntersectionObserver ---------- */
function setupStaticFades() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("in-view");
        obs.unobserve(en.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".fade-in").forEach((el) => obs.observe(el));
  // Compteurs : valeurs finales affichées directement
  document.querySelectorAll(".count").forEach((el) => {
    el.textContent = (el.dataset.prefix || "") + el.dataset.count;
  });
}
