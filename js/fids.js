// ===============================================================
// FIDS Unifié — EBCI + EBLG (Worker ADS‑B PRO v2)
// ===============================================================

import { centerOnAircraft, highlightAircraft } from "./nd.js";
import { setSelectedAircraft } from "./nd-panel.js";

const API_BASE = "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/fids-adsb";
const AIRPORTS = ["EBCI", "EBLG"];

// ---------------------------------------------------------------
// Filtre Arr / Dep / All
// ---------------------------------------------------------------
let fidsFilter = "all"; // all | arr | dep

window.setFidsFilter = function(filter) {
  fidsFilter = filter;

  document.querySelectorAll(".fids-btn").forEach(btn =>
    btn.classList.remove("active")
  );

  document.querySelector(`button[onclick="setFidsFilter('${filter}')"]`)
    ?.classList.add("active");

  updateFIDS();
};

// ---------------------------------------------------------------
// 1. Récupération des données FIDS via Worker
// ---------------------------------------------------------------
export async function fetchFIDS(icao) {
  try {
    const params = new URLSearchParams({ airport: icao });
    const res = await fetch(`${API_BASE}?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();

    return {
      arrivals: Array.isArray(data.arrivals) ? data.arrivals : [],
      departures: Array.isArray(data.departures) ? data.departures : []
    };
  } catch (err) {
    console.error("Erreur FIDS dyn:", err);
    return { arrivals: [], departures: [] };
  }
}

// ---------------------------------------------------------------
// 2. Tri par heure cockpit Airbus
// ---------------------------------------------------------------
function sortByTime(list) {
  return list.sort((a, b) => {
    const ta = parseTime(a.time);
    const tb = parseTime(b.time);
    return ta - tb;
  });
}

function parseTime(t) {
  if (!t || typeof t !== "string") return 999999;
  const m = t.match(/(\d{2}):(\d{2})/);
  if (!m) return 999999;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ---------------------------------------------------------------
// 3. Mise à jour globale FIDS
// ---------------------------------------------------------------
export async function updateFIDS() {
  for (const icao of AIRPORTS) {
    const { arrivals, departures } = await fetchFIDS(icao);

    // Tri cockpit Airbus
    const arrSorted = sortByTime(arrivals);
    const depSorted = sortByTime(departures);

    renderFIDS(icao, arrSorted, depSorted);
  }
}

// ---------------------------------------------------------------
// 4. Normalisation statut → classes CSS cockpit
// ---------------------------------------------------------------
function getCssClass(status, filter) {
  const s = status.toLowerCase();

  if (s.includes("approche")) return "fids-app";
  if (s.includes("montée")) return "fids-up";
  if (s.includes("sol")) return "fids-gnd";
  if (s.includes("annul")) return "fids-cnl";

  // Filtre Arrivées
  if (filter === "arr") return "fids-arr";

  // Filtre Départs
  if (filter === "dep") return "fids-dep";

  // Par défaut → départ (bleu)
  return "fids-dep";
}

// ---------------------------------------------------------------
// 5. Rendu HTML des vols
// ---------------------------------------------------------------
function renderFIDS(icao, arrivals, departures) {
  const id = icao === "EBCI" ? "fids-ebci" : "fids-eblg";
  const container = document.getElementById(id);
  if (!container) return;
  container.innerHTML = "";

  let list = [];
  if (fidsFilter === "arr") list = arrivals;
  else if (fidsFilter === "dep") list = departures;
  else list = [...arrivals, ...departures];

  // Limite cockpit : max 20 lignes
  list.slice(0, 20).forEach(f => {
    const div = document.createElement("div");

    const cssClass = getCssClass(f.status || "", fidsFilter);
    div.className = `fids-row ${cssClass}`;

    div.innerHTML = `
      <span class="fids-time">${f.time || "--:--"}</span>
      <span class="fids-flight">${f.flight || "???"}</span>
      <span class="fids-dest">${f.city || "?"}</span>
      <span class="fids-status">${f.status || "Programmé"}</span>
    `;

    div.addEventListener("click", () => {
      if (!f.hex) return;
      centerOnAircraft(f.hex);
      highlightAircraft(f.hex);
      setSelectedAircraft(f.hex);
    });

    container.appendChild(div);
  });
}
