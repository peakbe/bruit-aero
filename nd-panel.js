// ===============================================================
// ND Airbus — Panneau HDG / TRK / GS / TAS / WIND
// ===============================================================

import { planesLayer } from "./map.js";
import { updateFPV } from "./nd.js";

setInterval(() => {
    if (selectedHex) updateFPV(selectedHex);
}, 1000);

let selectedHex = null;

// Appelé depuis fids.js ou nd.js
export function setSelectedAircraft(hex) {
    selectedHex = hex;
}

// Mise à jour du panneau ND Airbus
function updateNdPanel() {
    if (!selectedHex) return;

    const plane = planesLayer._layers[selectedHex];
    if (!plane) return;

    const p = plane.options.data;

    // Heading (track)
    const hdg = Math.round(p.track || p.heading || 0);

    // Track = heading réel sol
    const trk = Math.round(p.track || hdg);

    // Ground Speed (GS)
    const gs = Math.round(p.gs || p.speed || 0);

    // True Airspeed (TAS) — estimation
    const tas = Math.round(gs * 1.05);

    // Vent (si disponible)
    const windDir = p.wind_direction || "---";
    const windSpd = p.wind_speed || "---";

    document.getElementById("nd-hdg").innerText = hdg;
    document.getElementById("nd-trk").innerText = trk;
    document.getElementById("nd-gs").innerText = gs + " kt";
    document.getElementById("nd-tas").innerText = tas + " kt";
    document.getElementById("nd-wind").innerText = `${windDir}° / ${windSpd} kt`;
}

// Mise à jour automatique
setInterval(updateNdPanel, 2000);
