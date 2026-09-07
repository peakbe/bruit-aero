// ===============================================================
// FIDS Airplanes.live — EBCI + EBLG
// ===============================================================

import { centerOnAircraft, highlightAircraft } from "./nd.js";
import { setSelectedAircraft } from "./nd-panel.js";

const API_URL = "https://api.airplanes.live/v2/airport/";
const AIRPORTS = ["EBCI", "EBLG"];

// ---------------------------------------------------------------
// 1. Récupération des données FIDS Airplanes.live
// ---------------------------------------------------------------
export async function fetchFIDS(icao) {
    try {
        const res = await fetch(`${API_URL}${icao}`, { cache: "no-store" });
        const data = await res.json();

        return {
            departures: data.departures || [],
            arrivals: data.arrivals || []
        };
    } catch (err) {
        console.error("Erreur FIDS:", err);
        return { departures: [], arrivals: [] };
    }
}

// ---------------------------------------------------------------
// 2. Mise à jour globale FIDS (appelée par app.js)
// ---------------------------------------------------------------
export async function updateFIDS() {
    for (const icao of AIRPORTS) {
        const { departures } = await fetchFIDS(icao);
        renderFIDS(icao, departures);
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
            <span class="fids-dest">${f.route?.dest || f.airport?.name || "?"}</span>
            <span class="fids-status">${f.status || "Programmé"}</span>
        `;

        // -------------------------------------------------------
        // 4. Fusion ND Airbus — clic vol → avion sur radar
        // -------------------------------------------------------
        div.addEventListener("click", () => {
            if (!f.hex) return;
            centerOnAircraft(f.hex);
            highlightAircraft(f.hex);
            setSelectedAircraft(f.hex);

        });

        container.appendChild(div);
    });
}
