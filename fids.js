// ===============================
// FIDS Airplanes.live PRO+++
// EBCI + EBLG
// ===============================

import { centerOnAircraft, highlightAircraft } from "./nd.js"; 
// nd.js = ton module ND Airbus (centrage + highlight)

const AIRPORTS = ["EBCI", "EBLG"];
const API_URL = "https://api.airplanes.live/v2/airport/";

export async function fetchFIDS(icao) {
    try {
        const url = `${API_URL}${icao}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();

        return {
            departures: data.departures || [],
            arrivals: data.arrivals || []
        };
    } catch (err) {
        console.error("FIDS error:", err);
        return { departures: [], arrivals: [] };
    }
}

export async function updateFIDS() {
    for (const icao of AIRPORTS) {
        const { departures } = await fetchFIDS(icao);
        renderFIDS(icao, departures);
    }
}

function renderFIDS(icao, flights) {
    const id = icao === "EBCI" ? "fids-ebci" : "fids-eblg";
    const container = document.getElementById(id);

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

        // --- Fusion ND Airbus ---
        div.addEventListener("click", () => {
            if (!f.hex) return;
            centerOnAircraft(f.hex);      // centre la carte sur l’avion
            highlightAircraft(f.hex);     // surbrillance avionique PRO+++
        });

        container.appendChild(div);
    });
}

// Mise à jour automatique
setInterval(updateFIDS, 30000);
updateFIDS();
