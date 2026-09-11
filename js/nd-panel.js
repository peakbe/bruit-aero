// ===============================================================
// ND Airbus — Panneau HDG / TRK / GS / TAS / WIND
// ===============================================================

import { planesLayer, planeIndex } from "./map.js";
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

    const plane = planeIndex[selectedHex];

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
export function updateCompassUI(prefix, windDeg, windSpeedKmh) {
  const needle = document.getElementById(`${prefix}-compass-needle`);
  const label = document.getElementById(`${prefix}-compass-label`);
  const loc = document.getElementById(`${prefix}-compass-loc`);
  const gp = document.getElementById(`${prefix}-compass-gp`);
  const windVec = document.getElementById(`${prefix}-compass-wind`);

  if (!needle || !label || !loc || !gp || !windVec) return;

  // Aiguille vent
  needle.style.transform = `rotate(${windDeg}deg)`;

  // Vector wind arrow — même angle que le vent
  windVec.style.transform = `rotate(${windDeg}deg) translate(-50%, -50%)`;

  // LOC approximatif : on aligne la piste sur le vent (comme ton ND vent)
  // EBCI: 24/06, EBLG: 22/04
  let runwayHeading = 0;

  if (prefix === "ebci") {
    runwayHeading = windDeg > 180 ? 240 : 60;
  } else if (prefix === "eblg") {
    runwayHeading = windDeg > 180 ? 220 : 40;
  }

  loc.style.transform = `rotate(${runwayHeading}deg)`;

  // Glidepath 3° : on le représente comme une petite barre verte légèrement décalée
  // Ici, on le garde aligné sur la piste (LOC), mais tu peux le décaler si tu veux
  gp.style.transform = `rotate(${runwayHeading}deg)`;

  // Label Airbus
  label.textContent = `${windDeg}° / ${windSpeedKmh} km/h`;
}


// Mise à jour automatique
setInterval(updateNdPanel, 2000);
