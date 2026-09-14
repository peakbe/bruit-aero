// ===============================================================
// ND Airbus — Panneau HDG / TRK / GS / TAS / WIND (PRO v3)
// ===============================================================

import { planeIndex } from "./map.js";
import { updateFPV } from "./nd.js";

let selectedHex = null;

// ---------------------------------------------------------------
// Sélection avion depuis ND / FIDS
// ---------------------------------------------------------------
export function setSelectedAircraft(hex) {
  selectedHex = hex;
}

// ---------------------------------------------------------------
// Mise à jour panneau ND Airbus
// ---------------------------------------------------------------
function updateNdPanel() {
  if (!selectedHex) return;

  const plane = planeIndex[selectedHex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  // -----------------------------
  // HDG / TRK — fallback Airbus
  // -----------------------------
  const hdg =
    p.heading ||
    p.true_heading ||
    p.mag_heading ||
    p.track ||
    0;

  const trk = p.track || hdg;

  const hdgNorm = Math.round(((hdg % 360) + 360) % 360);
  const trkNorm = Math.round(((trk % 360) + 360) % 360);

  // -----------------------------
  // GS / TAS
  // -----------------------------
  const gsKt = Math.round(
    p.gs ||
    (p.speed_ms ? p.speed_ms / 0.514444 : 0)
  );

  const tasKt = Math.round(gsKt * 1.05);

  // -----------------------------
  // Vent
  // -----------------------------
  const windDir = p.wind_direction ?? "---";
  const windSpd = p.wind_speed ?? "---";

  // -----------------------------
  // Injection cockpit Airbus
  // -----------------------------
  document.getElementById("nd-hdg").innerText = hdgNorm;
  document.getElementById("nd-trk").innerText = trkNorm;
  document.getElementById("nd-gs").innerText = `${gsKt} kt`;
  document.getElementById("nd-tas").innerText = `${tasKt} kt`;
  document.getElementById("nd-wind").innerText = `${windDir}° / ${windSpd} kt`;
}

// ---------------------------------------------------------------
// Boussole vent / LOC / GP — PRO v3
// ---------------------------------------------------------------
export function updateCompassUI(prefix, windDeg, windSpeedKmh) {
  const needle = document.getElementById(`${prefix}-compass-needle`);
  const label  = document.getElementById(`${prefix}-compass-label`);
  const loc    = document.getElementById(`${prefix}-compass-loc`);
  const gp     = document.getElementById(`${prefix}-compass-gp`);
  const windVec = document.getElementById(`${prefix}-compass-wind`);

  if (!needle || !label || !loc || !gp || !windVec) return;

  // Aiguille vent
  needle.style.transform = `rotate(${windDeg}deg)`;

  // Flèche vent
  windVec.style.transform = `rotate(${windDeg}deg) translate(-50%, -50%)`;

  // Runway heading (Airbus-style)
  let runwayHeading = 0;

  if (prefix === "ebci") runwayHeading = windDeg > 180 ? 240 : 60;
  if (prefix === "eblg") runwayHeading = windDeg > 180 ? 220 : 40;

  loc.style.transform = `rotate(${runwayHeading}deg)`;
  gp.style.transform  = `rotate(${runwayHeading}deg)`;

  // Label cockpit
  label.textContent = `${windDeg}° / ${windSpeedKmh} km/h`;
}

// ---------------------------------------------------------------
// Mise à jour automatique ND + FPV
// ---------------------------------------------------------------
setInterval(() => {
  if (selectedHex) {
    updateNdPanel();
    updateFPV(selectedHex);
  }
}, 1000);
