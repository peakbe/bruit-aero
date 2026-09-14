// ===============================================================
// FIDS Unifié — EBCI + EBLG (Worker proxy)
// ===============================================================

import { centerOnAircraft, highlightAircraft } from "./nd.js";
import { setSelectedAircraft } from "./nd-panel.js";

const API_BASE = "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/fids";
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
    const res = await fetch(`${API_BASE}?airport=${icao}`, { cache: "no-store" });
    const data = await res.json();

    const arr = data.arrivals || [];
    const dep = data.departures || [];

    // Filtre cockpit Airbus
    if (fidsFilter === "arr") return arr;
    if (fidsFilter === "dep") return dep;

    return [...arr, ...dep]; // all
  } catch (err) {
    console.error("Erreur FIDS:", err);
    return [];
  }
}

// ---------------------------------------------------------------
// 2. Mise à jour globale FIDS
// ---------------------------------------------------------------
export async function updateFIDS() {
  for (const icao of AIRPORTS) {
    const flights = await fetchFIDS(icao);
    renderFIDS(icao, flights);
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
function renderFIDS(icao, flights) {
  const id = icao === "EBCI" ? "fids-ebci" : "fids-eblg";
  const container = document.getElementById(id);

  if (!container) return;
  container.innerHTML = "";

  flights.slice(0, 10).forEach(f => {
    const div = document.createElement("div");
    div.className = "fids-row";

    const time = formatTime(f.dep_time_utc || f.arr_time_utc);
    const flight = f.flight_iata || f.flight_icao || "???";
    const dest = f.airport?.name || f.arr_iata || f.dep_iata || "?";
    const status = f.status || "Programmé";

    div.innerHTML = `
      <span class="fids-time">${time}</span>
      <span class="fids-flight">${flight}</span>
      <span class="fids-dest">${dest}</span>
      <span class="fids-status">${status}</span>
    `;

    // ND Airbus — clic vol → avion sur radar
    div.addEventListener("click", () => {
      if (!f.hex) return;
      centerOnAircraft(f.hex);
      highlightAircraft(f.hex);
      setSelectedAircraft(f.hex);
    });

    container.appendChild(div);
  });
}
