// ===============================================================
// FIDS Unifié — EBCI + EBLG (Worker proxy)
// ===============================================================

import { centerOnAircraft, highlightAircraft } from "./nd.js";
import { setSelectedAircraft } from "./nd-panel.js";

const API_BASE = "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/fids";
const AIRPORTS = ["EBCI", "EBLG"];

// ---------------------------------------------------------------
// 1. Récupération des données FIDS via Worker
// ---------------------------------------------------------------
export async function fetchFIDS(icao) {
  try {
    const params = new URLSearchParams({
      airport: icao,
      type: "departures"
    });

    const res = await fetch(`${API_BASE}?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();

    return data.flights || [];
  } catch (err) {
    console.error("Erreur FIDS:", err);
    return [];
  }
}

// ---------------------------------------------------------------
// 2. Mise à jour globale FIDS (appelée par app.js)
// ---------------------------------------------------------------
export async function updateFIDS() {
  for (const icao of AIRPORTS) {
    const flights = await fetchFIDS(icao);
    renderFIDS(icao, flights);
  }
}

// ---------------------------------------------------------------
// 3. Rendu HTML des vols
// ---------------------------------------------------------------
function renderFIDS(icao, flights) {
  const id = icao === "EBCI" ? "fids-ebci" : "fids-eblg";
  const container = document.getElementById(id);

  if (!container) return;
  container.innerHTML = "";

  flights.slice(0, 10).forEach(f => {
    const div = document.createElement("div");
    div.className = "fids-row";

    div.innerHTML = `
      <span class="fids-time">${f.time || "--:--"}</span>
      <span class="fids-flight">${f.flight || "???"}</span>
      <span class="fids-dest">${f.city || "?"}</span>
      <span class="fids-status">${f.status || "Programmé"}</span>
    `;

    // Fusion ND Airbus — clic vol → avion sur radar (si hex dispo)
    div.addEventListener("click", () => {
      if (!f.hex) return;
      centerOnAircraft(f.hex);
      highlightAircraft(f.hex);
      setSelectedAircraft(f.hex);
    });

    container.appendChild(div);
  });
}
