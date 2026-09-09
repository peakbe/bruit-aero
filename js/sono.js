// ===============================================================
// sono.js — Sonomètres EBLG + EBCI — Version PRO+++
// ===============================================================

import { map } from "./map.js";
import { WORKER_BASE_URL } from "./config.js";

// ===============================================================
// 1. Conversion DMS → décimal (optimisée)
// ===============================================================
function dmsToDecimal(dms) {
  const [deg, min, sec, dir] = dms.split(" ");
  let dec = +deg + (+min / 60) + (+sec / 3600);
  return (dir === "S" || dir === "W") ? -dec : dec;
}

// ---------------------------------------------------------------
// 2. Sonomètres EBCI / EBLG
// ---------------------------------------------------------------
const rawEBCI = [ 
   { id: "F101", address: "Rue Bruhaute 46, Jumet", latDMS: "50 26 52.37 N", lonDMS: "4 24 57.02 E" },
{ id: "F102", address: "Rue du Vigneron 5, Jumet", latDMS: "50 26 45.73 N", lonDMS: "4 25 22.56 E" },
{ id: "F103", address: "Rue Docteur Pircard 61, Jumet", latDMS: "50 27 8.59 N", lonDMS: "4 24 56.68 E" },
{ id: "F104", address: "Rue du Chiffon Rouge 12, Roux", latDMS: "50 26 32.42 N", lonDMS: "4 23 33.2 E" },
{ id: "F105", address: "Rue Sous le Bois 59, Roux", latDMS: "50 26 49.22 N", lonDMS: "4 24 1.86 E" },
{ id: "F106", address: "Rue Beaurin et Jonet 17, Wangenies", latDMS: "50 28 47.51 N", lonDMS: "4 31 10.46 E" },
{ id: "F107", address: "Rue Maximilien Wattelar 155, Jumet", latDMS: "50 26 38.66 N", lonDMS: "4 24 40.18 E" },
{ id: "F108", address: "Avenue Brunard 83, Fleurus", latDMS: "50 29 11.97 N", lonDMS: "4 32 46.61 E" },
{ id: "F109", address: "Chaussée de Charleroi 265, Sombreffe", latDMS: "50 29 25.27 N", lonDMS: "4 33 44.6 E" },
{ id: "F110", address: "Rue Émile Vandervelde 396, Forchies", latDMS: "50 25 24.85 N", lonDMS: "4 19 38.57 E" },
{ id: "F111", address: "Rue de la Baille 42, Courcelles", latDMS: "50 26 18.68 N", lonDMS: "4 21 7.47 E" },
{ id: "F112", address: "Rue des Liserons 44, Goutroux", latDMS: "50 25 28.75 N", lonDMS: "4 21 27.75 E" },
{ id: "F114", address: "Rue des Ruelles / Rue de la source, Anderlues", latDMS: "50 24 35.39 N", lonDMS: "4 16 37.8 E" },
{ id: "F116", address: "Rue de l'Enseignement 144, Fontaine-l'Evêque", latDMS: "50 24 38.28 N", lonDMS: "4 18 54.19 E" },
{ id: "F117", address: "Rue du Terril 1, Forchies", latDMS: "50 25 53.4 N", lonDMS: "4 18 53.71 E" },
{ id: "F118", address: "Rue Piconette 1, Sombreffe", latDMS: "50 30 18.96 N", lonDMS: "4 36 40.25 E" },
{ id: "F119", address: "Rue René Delhaize 39, Ransart", latDMS: "50 27 47.57 N", lonDMS: "4 28 44.73 E" }
];   // (tes données)

const rawEBLG = [
{ id: "F001", address: "Rue Franquet 15, Houtain", latDMS: "50 44 16.96 N", lonDMS: "5 36 31.8 E" },
{ id: "F002", address: "Rue Noiset 23, St Georges", latDMS: "50 35 18.29 N", lonDMS: "5 22 13.88 E" },
{ id: "F003", address: "Rue Fond Méan 7, St Georges", latDMS: "50 36 4.2 N", lonDMS: "5 22 53.04 E" },
{ id: "F004", address: "Vinâve des Stréats 32, Verlaine", latDMS: "50 36 19.49 N", lonDMS: "5 19 17.06 E" },
{ id: "F005", address: "Rue Caquin 4, Haneffe", latDMS: "50 38 21.59 N", lonDMS: "5 19 24.67 E" },
{ id: "F006", address: "Rue Bolly Chapon 11, Seraing", latDMS: "50 36 34.54 N", lonDMS: "5 16 17.05 E" },
{ id: "F007", address: "Rue Yernawe 13, St Georges", latDMS: "50 35 26.72 N", lonDMS: "5 20 42.81 E" },
{ id: "F008", address: "Rue Warfusée 5, St Georges", latDMS: "50 35 41.56 N", lonDMS: "5 21 32.22 E" },
{ id: "F009", address: "Bibliothèque Communale, Place Verte, 4470 Stockay", latDMS: "50 34 50.99 N", lonDMS: "5 21 19.5 E" },
{ id: "F010", address: "Rue Haute Voie 23, Verlaine", latDMS: "50 35 57.81 N", lonDMS: "5 18 48.57 E" },
{ id: "F011", address: "Rue Albert 1er 18, St Georges", latDMS: "50 36 4.11 N", lonDMS: "5 21 21.62 E" },
{ id: "F012", address: "Rue Barbe d'Or 13, 4317 Aineffe", latDMS: "50 37 18.9 N", lonDMS: "5 15 17.09 E" },
{ id: "F013", address: "Rue Bois Léon 31, Verlaine", latDMS: "50 35 12.89 N", lonDMS: "5 18 31.24 E" },
{ id: "F014", address: "Rue Léon Labye 12, Juprelle", latDMS: "50 43 8.02 N", lonDMS: "5 34 23.39 E" },
{ id: "F015", address: "Rue du Brouck 5, Juprelle", latDMS: "50 41 19.82 N", lonDMS: "5 31 34.38 E" },
{ id: "F016", address: "Rue de Chapon-Seraing 14, Verlaine", latDMS: "50 37 10.62 N", lonDMS: "5 17 43.24 E" },
{ id: "F017", address: "Rue de la Pommeraie, 4690 Wonck", latDMS: "50 45 53.58 N", lonDMS: "5 37 50.18 E" }
];   // (tes données)

// ===============================================================
// 3. Pré‑calcul lat/lon + création dictionnaire
// ===============================================================
function preprocess(list, airport) {
  return list.map(s => ({
    ...s,
    airport,
    lat: dmsToDecimal(s.latDMS),
    lon: dmsToDecimal(s.lonDMS)
  }));
}

export const sonometersEBCI = preprocess(rawEBCI, "EBCI");
export const sonometersEBLG = preprocess(rawEBLG, "EBLG");

// ===============================================================
// 4. Règles cockpit Airbus — lookup O(1)
// ===============================================================
const rules = {
  EBLG: {
    "22": {
      green: new Set(["F001","F002","F003","F004","F005","F006","F007","F008","F009","F010","F011","F012","F013","F014","F015","F016","F017"]),
      red:   new Set()
    },
    "04": {
      green: new Set(["F001","F002","F003","F007","F008","F009","F011","F013","F014","F015"]),
      red:   new Set(["F004","F005","F006","F010","F012","F016","F017"])
    }
  },
  EBCI: {
    "24": {
      green: new Set(["F101","F102","F103","F104","F105","F106","F107","F108","F109","F110","F111","F112","F114","F116","F117","F118","F119"]),
      red:   new Set()
    },
    "06": {
      green: new Set(["F101","F102","F103","F104","F105","F106","F107","F108","F109","F110","F111","F112","F119"]),
      red:   new Set(["F114","F116","F117","F118"])
    }
  }
};

// ===============================================================
// 5. Layer + dictionnaire markers
// ===============================================================
export const sonoLayer = L.layerGroup();
const sonoIndex = {}; // { id: marker }

// ===============================================================
// 6. Création des markers (une seule fois)
// ===============================================================
function createMarkers(list) {
  list.forEach(s => {
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 7,
      color: "gray",
      weight: 2,
      fillOpacity: 0.8
    });

    marker._id = s.id;
    marker._airport = s.airport;

    marker.bindPopup(buildPopupHTML(s));

    sonoLayer.addLayer(marker);
    sonoIndex[s.id] = marker;
  });
}

createMarkers(sonometersEBCI);
createMarkers(sonometersEBLG);

// ===============================================================
// 7. Mise à jour cockpit Airbus — recoloration dynamique
// ===============================================================
export function renderSonometers(airport, runway) {

  // 🟦 MODE ALL — afficher EBLG + EBCI avec leurs vraies couleurs
  if (airport === "ALL") {

    // EBLG → piste par défaut (22)
    const ruleEBLG = rules.EBLG["22"];

    Object.values(sonoIndex).forEach(marker => {
      if (marker._airport !== "EBLG") return;

      const id = marker._id;
      let color = "gray";

      if (ruleEBLG.green.has(id)) color = "lime";
      if (ruleEBLG.red.has(id))   color = "red";

      marker.setStyle({ color, fillColor: color });
    });

    // EBCI → piste par défaut (24)
    const ruleEBCI = rules.EBCI["24"];

    Object.values(sonoIndex).forEach(marker => {
      if (marker._airport !== "EBCI") return;

      const id = marker._id;
      let color = "gray";

      if (ruleEBCI.green.has(id)) color = "lime";
      if (ruleEBCI.red.has(id))   color = "red";

      marker.setStyle({ color, fillColor: color });
    });

    return;
  }

  // 🟦 MODE NORMAL (EBLG ou EBCI)
  const airportRules = rules[airport];
  if (!airportRules) return;

  const rule = airportRules[runway];
  if (!rule) return;

  Object.values(sonoIndex).forEach(marker => {
    if (marker._airport !== airport) return;

    const id = marker._id;

    let color = "gray";
    if (rule.green.has(id)) color = "lime";
    if (rule.red.has(id))   color = "red";

    marker.setStyle({
      color,
      fillColor: color
    });
  });
}

// ===============================================================
// 8. Popup météo + graphique vent — PRO+++
// ===============================================================

function buildPopupHTML(s) {
  return `
    <div style="font-family:'Segoe UI'; font-size:13px; color:#e2e8f0;">
      <h4 style="margin:0 0 4px 0; color:#38bdf8;">
        Sonomètre ${s.id}
      </h4>
      <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">
        ${s.address}
      </div>

      <!-- Rose des vents -->
      <div style="text-align:center; margin:8px 0;">
        <div style="
          position:relative;
          width:70px;
          height:70px;
          margin:auto;
          border:2px solid #334155;
          border-radius:50%;
          background:#1e293b;
          display:flex;
          align-items:center;
          justify-content:center;">
          <span style="position:absolute; top:2px; font-size:9px; color:#ef4444; font-weight:bold;">N</span>
          <div id="windarrow-${s.id}" style="
            width:100%;
            height:100%;
            display:flex;
            align-items:center;
            justify-content:center;
            transition:transform 0.5s ease;">
            <div style="
              width:0;
              height:0;
              border-left:6px solid transparent;
              border-right:6px solid transparent;
              border-bottom:26px solid #38bdf8;">
            </div>
          </div>
        </div>
        <span id="windtext-${s.id}" style="font-size:11px; color:#94a3b8; display:block; margin-top:4px;">...</span>
      </div>

      <!-- Graphique vent -->
      <div style="margin-top:10px;">
        <canvas id="windchart-${s.id}" width="140" height="40"
          style="background:#0f172a; border:1px solid #334155; border-radius:6px;">
        </canvas>
        <div style="font-size:10px; color:#64748b; text-align:center; margin-top:2px;">
          Vent — 30 min
        </div>
      </div>

      <!-- Bloc météo -->
      <div style="background:rgba(15,23,42,0.6); padding:6px; border-radius:6px; border:1px solid #334155; margin-top:10px;">
        <b style="color:#f59e0b;">🌡️ Température :</b> <span id="temp-${s.id}">...</span><br>
        <b style="color:#38bdf8;">💨 Vent :</b> <span id="wind-${s.id}">...</span><br>
        <b style="color:#cbd5e1;">☁️ Météo :</b> <span id="desc-${s.id}">...</span><br>
        <b style="color:#22c55e;">🛬 Piste active :</b> <span id="rwy-${s.id}">...</span>
      </div>
    </div>
  `;
}

// ===============================================================
// 9. Attacher popup + mise à jour dynamique — PRO+++
// ===============================================================
Object.values(sonoIndex).forEach(marker => {
  const s = marker._airport === "EBLG"
    ? sonometersEBLG.find(x => x.id === marker._id)
    : sonometersEBCI.find(x => x.id === marker._id);

  marker.bindPopup(buildPopupHTML(s));

  marker.on("popupopen", async () => {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${s.lat}&lon=${s.lon}`);
      if (!res.ok) return;

      const w = await res.json();

      const temp = Math.round(w.main?.temp ?? 0);
      const windSpeed = Math.round((w.wind?.speed ?? 0) * 3.6);
      const windDeg = w.wind?.deg ?? 0;
      const desc = w.weather?.[0]?.description ?? "Ciel dégagé";

      // -----------------------------------------------------------
      // Historique vent — PRO+++
      // -----------------------------------------------------------
      if (!windHistory[s.id]) windHistory[s.id] = [];
      windHistory[s.id].push(windSpeed);
      if (windHistory[s.id].length > 30) windHistory[s.id].shift();

      // -----------------------------------------------------------
      // Graphique vent — PRO+++
      // -----------------------------------------------------------
      const canvas = document.getElementById(`windchart-${s.id}`);
      if (canvas) {
        const ctx = canvas.getContext("2d");
        const values = windHistory[s.id];

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.beginPath();

        const max = Math.max(...values);
        const min = Math.min(...values);
        const range = max - min || 1;

        values.forEach((v, i) => {
          const x = (i / (values.length - 1)) * canvas.width;
          const y = canvas.height - ((v - min) / range) * canvas.height;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        ctx.stroke();
      }

      // -----------------------------------------------------------
      // Rose des vents — PRO+++
      // -----------------------------------------------------------
      const arrow = document.getElementById(`windarrow-${s.id}`);
      const windText = document.getElementById(`windtext-${s.id}`);

      if (arrow) arrow.style.transform = `rotate(${windDeg}deg)`;
      if (windText) windText.textContent = `${windDeg}° — ${windSpeed} km/h`;

      // -----------------------------------------------------------
      // Bloc météo — PRO+++
      // -----------------------------------------------------------
      document.getElementById(`temp-${s.id}`).textContent = `${temp}°C`;
      document.getElementById(`wind-${s.id}`).textContent = `${windSpeed} km/h (${windDeg}°)`;
      document.getElementById(`desc-${s.id}`).textContent = desc;

      const runway = s.airport === "EBLG"
        ? (windDeg > 180 ? "22" : "04")
        : (windDeg > 180 ? "24" : "06");

      document.getElementById(`rwy-${s.id}`).textContent = runway;

    } catch (err) {
      console.error("Erreur météo sonomètre :", err);
    }
  });
});

