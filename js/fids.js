// ===============================================================
// FIDS Unifié — EBCI + EBLG (Worker proxy)
// ===============================================================

import { centerOnAircraft, highlightAircraft } from "./nd.js";
import { setSelectedAircraft } from "./nd-panel.js";

const API_BASE = "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/fids-dyn";

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
      arrivals: data.arrivals || [],
      departures: data.departures || []
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
// 3. Format HH:MM cockpit Airbus
// ---------------------------------------------------------------
function formatTime(t) {
  if (!t) return "--:--";
  try {
    return t.split("T")[1].replace("Z", "").slice(0, 5);
  } catch {
    return "--:--";
  }
}

// ---------------------------------------------------------------
// 4. Rendu HTML des vols
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
    div.className = "fids-row";

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
