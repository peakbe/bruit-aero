// ===============================================================
// FIDS Unifié — EBCI + EBLG (Worker FIDS ADS-B PRO v4 optimisé)
// ===============================================================

import { centerOnAircraft, highlightAircraft, setSelectedAircraft } from "./nd.js";

const API_BASE = "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/fids-adsb";
const AIRPORTS = ["EBCI", "EBLG"];

let fidsFilter = "all"; // all | arr | dep

// ===============================================================
// Filtre Arr / Dep / All — Optimisé
// ===============================================================
window.setFidsFilter = function (filter) {
  fidsFilter = filter;

  document.querySelectorAll(".fids-btn").forEach(btn =>
    btn.classList.remove("active")
  );

  const activeBtn = document.querySelector(`button[onclick="setFidsFilter('${filter}')"]`);
  if (activeBtn) activeBtn.classList.add("active");

  updateFIDS();
};

// ===============================================================
// 1. Récupération FIDS via Worker — Optimisé
// ===============================================================
async function fetchFIDS(icao) {
  try {
    const res = await fetch(`${API_BASE}?airport=${icao}`, { cache: "no-store" });
    if (!res.ok) {
      console.error("FIDS HTTP error", res.status);
      return { arrivals: [], departures: [] };
    }

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

// ===============================================================
// 2. Mise à jour globale FIDS — Optimisé
// ===============================================================
export async function updateFIDS() {
  const results = await Promise.all(AIRPORTS.map(fetchFIDS));

  AIRPORTS.forEach((icao, i) => {
    const { arrivals, departures } = results[i];
    renderFIDS(icao, arrivals, departures);
  });
}

// ===============================================================
// 3. Rendu HTML des vols — Optimisé PRO+++
// ===============================================================
function renderFIDS(icao, arrivals, departures) {
  const container = document.getElementById(icao === "EBCI" ? "fids-ebci" : "fids-eblg");
  if (!container) return;

  container.innerHTML = "";

  // Sélection liste selon filtre
  const list =
    fidsFilter === "arr" ? arrivals :
    fidsFilter === "dep" ? departures :
    [...arrivals, ...departures];

  // Limite 20 lignes
  const rows = list.slice(0, 20);

  const frag = document.createDocumentFragment();

  for (const f of rows) {
    const div = document.createElement("div");

    const status = f.status || "Programmé";

    // Classification Airbus PRO+++
    let cssClass = "fids-dep airbus-green";

    if (/approche/i.test(status)) cssClass = "fids-app airbus-green";
    else if (/montée/i.test(status)) cssClass = "fids-up airbus-green";
    else if (/sol/i.test(status)) cssClass = "fids-gnd airbus-green";
    else if (/annul/i.test(status)) cssClass = "fids-cnl airbus-red";
    else if (/arrivée prévue/i.test(status)) cssClass = "fids-app airbus-amber";
    else if (/départ probable/i.test(status)) cssClass = "fids-up airbus-amber";

    if (fidsFilter === "arr") cssClass += " airbus-green";

    div.className = `fids-row ${cssClass}`;

    // Construction HTML optimisée
    div.innerHTML = `
      <span class="fids-time">${f.time || "--:--"}</span>
      <span class="fids-flight">${f.flight || "???"}</span>
      <span class="fids-dest">${f.city || "?"}</span>
      <span class="fids-status">${status}</span>
      <span class="fids-extra">
        ${f.distNm ? `${f.distNm} NM` : ""} 
        ${f.altFt ? ` / ${f.altFt} ft` : ""}
      </span>
    `;

    // Intégration ND Airbus (center + highlight + select)
    if (f.hex) {
      div.addEventListener("click", () => {
        centerOnAircraft(f.hex);
        highlightAircraft(f.hex);
        setSelectedAircraft(f.hex);
      });
    }

    frag.appendChild(div);
  }

  container.appendChild(frag);
}
