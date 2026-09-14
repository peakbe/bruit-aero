// ===============================================================
// FIDS Unifié — EBCI + EBLG (Worker FIDS ADS-B PRO v3)
// ===============================================================

import { centerOnAircraft, highlightAircraft } from "./nd.js";
import { setSelectedAircraft } from "./nd-panel.js";

const API_BASE = "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/fids-adsb";
const AIRPORTS = ["EBCI", "EBLG"];

let fidsFilter = "all"; // all | arr | dep

// ---------------------------------------------------------------
// Filtre Arr / Dep / All
// ---------------------------------------------------------------
window.setFidsFilter = function (filter) {
  fidsFilter = filter;

  document.querySelectorAll(".fids-btn").forEach(btn =>
    btn.classList.remove("active")
  );

  document
    .querySelector(`button[onclick="setFidsFilter('${filter}')"]`)
    ?.classList.add("active");

  updateFIDS();
};

// ---------------------------------------------------------------
// 1. Récupération FIDS via Worker PRO v3
// ---------------------------------------------------------------
async function fetchFIDS(icao) {
  try {
    const params = new URLSearchParams({ airport: icao });
    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      cache: "no-store"
    });

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

// ---------------------------------------------------------------
// 2. Mise à jour globale FIDS
// ---------------------------------------------------------------
export async function updateFIDS() {
  for (const icao of AIRPORTS) {
    const { arrivals, departures } = await fetchFIDS(icao);
    renderFIDS(icao, arrivals, departures);
  }
}

// ---------------------------------------------------------------
// 3. Rendu HTML des vols
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

  list.slice(0, 20).forEach(f => {
    const div = document.createElement("div");

    const status = f.status || "Programmé";

    let cssClass = "fids-dep";
    if (/approche/i.test(status)) cssClass = "fids-app";
    if (/montée/i.test(status)) cssClass = "fids-up";
    if (/sol/i.test(status)) cssClass = "fids-gnd";
    if (/annul/i.test(status)) cssClass = "fids-cnl";
    if (/arrivée prévue/i.test(status)) cssClass = "fids-app";
    if (/départ probable/i.test(status)) cssClass = "fids-up";
    if (fidsFilter === "arr") cssClass = "fids-arr";

    div.className = `fids-row ${cssClass}`;

    div.innerHTML = `
      <span class="fids-time">${f.time || "--:--"}</span>
      <span class="fids-flight">${f.flight || "???"}</span>
      <span class="fids-dest">${f.city || "?"}</span>
      <span class="fids-status">${status}</span>
    `;

    if (f.hex) {
      div.addEventListener("click", () => {
        centerOnAircraft(f.hex);
        highlightAircraft(f.hex);
        setSelectedAircraft(f.hex);
      });
    }

    container.appendChild(div);
  });
}
