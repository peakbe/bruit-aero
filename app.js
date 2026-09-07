// ===============================================================
// IMPORTS MODULES
// ===============================================================
import { map, initRadarMap } from "./map.js";   // Carte Leaflet unique
import { updateFIDS } from "./fids.js";         // FIDS Airplanes.live

// ===============================================================
// INITIALISATION GLOBALE
// ===============================================================
document.addEventListener("DOMContentLoaded", () => {
    initRadarMap();          // Initialise la carte + radar ADS-B
    updateFIDS();            // Charge les vols Airplanes.live
    setInterval(updateFIDS, 30000); // Mise à jour FIDS toutes les 30s

    fetchMetarData();
    fetchWeatherData().then(() => {
    updateRunwaySonometers();   // ← EMPLACEMENT CORRECT
});

    setInterval(fetchMetarData, 300000);   // METAR toutes les 5 min
    setInterval(async () => {
    await fetchWeatherData();
    updateRunwaySonometers();   // ← DEUXIÈME APPEL
}, 300000); // Météo + cônes toutes les 5 min
});

// =================================================================
// 1. CONFIGURATION ET VARIABLES GLOBALES
// =================================================================
const WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

let currentAirport = "EBLG";

const AIRPORTS = {
  EBLG: { lat: 50.6374, lon: 5.4432, name: "Liège Airport" },
  EBCI: { lat: 50.4592, lon: 4.4538, name: "Charleroi Airport" }
};

const AIRPORT_COORDS = {
  EBCI: [50.4592, 4.4538],
  EBLG: [50.6374, 5.4432],
  ALL:  [50.55, 4.95]
};

function msToKmh(ms) {
  return Math.round(ms * 3.6);
}

// =================================================================
// 2. METAR VATSIM DIRECT
// =================================================================
async function fetchMetarData() {
  const airports = ["EBCI", "EBLG"];

  for (const icao of airports) {
    const metarElement = document.getElementById(`${icao.toLowerCase()}-metar`);
    if (!metarElement) continue;

    try {
      const response = await fetch(`https://metar.vatsim.net/${icao}`);
      if (response.ok) {
        const rawMetar = await response.text();
        metarElement.innerText = rawMetar.trim() || "METAR non disponible";
      } else {
        metarElement.innerText = "Erreur de chargement METAR";
      }
    } catch (error) {
      console.error(`Erreur METAR pour ${icao}:`, error);
      metarElement.innerText = "METAR indisponible";
    }
  }
}

// =================================================================
// 3. SONOMÈTRES
// =================================================================
const sonometersEBCI = [ /* … inchangé … */ ];
const sonometersEBLG = [ /* … inchangé … */ ];

function dmsToDecimal(dmsStr) {
  const parts = dmsStr.trim().split(/\s+/);
  let dd = parseFloat(parts[0]) + parseFloat(parts[1]) / 60 + parseFloat(parts[2]) / 3600;
  return (parts[3] === "S" || parts[3] === "W") ? -dd : dd;
}

const sonometerMarkers = [];

function renderSonometersOnMap() {
  sonometerMarkers.forEach(m => map.removeLayer(m));
  sonometerMarkers.length = 0;

  const allSonometers = [
    ...sonometersEBCI.map(s => ({ ...s, airport: "EBCI" })),
    ...sonometersEBLG.map(s => ({ ...s, airport: "EBLG" }))
  ];

  allSonometers.forEach(s => {
    const lat = dmsToDecimal(s.latDMS);
    const lng = dmsToDecimal(s.lonDMS);

    const marker = L.circleMarker([lat, lng], {
      radius: 7, fillColor: "#10b981", color: "#ffffff", weight: 2, fillOpacity: 0.9
    }).addTo(map);

    marker.bindPopup(`<b>Sonomètre ${s.id} (${s.airport})</b><br>${s.address}<br><i>Chargement météo...</i>`);

    marker.on('click', async () => {
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lng}`);
        if (res.ok) {
          const weatherData = await res.json();
          const temp = Math.round(weatherData.main?.temp ?? 0);
          const windSpeed = msToKmh(weatherData.wind?.speed ?? 0);
          const windDeg = weatherData.wind?.deg ?? 0;
          const description = weatherData.weather?.[0]?.description ?? "Ciel dégagé";

          marker.getPopup().setContent(`
            <div style="font-family: sans-serif; font-size: 13px;">
              <h4 style="margin: 0 0 4px 0; color: #1e293b;">Sonomètre ${s.id} (${s.airport})</h4>
              <p style="margin: 0 0 6px 0; font-size: 11px; color: #64748b;">${s.address}</p>
              <hr style="border:0; border-top:1px solid #e2e8f0; margin: 4px 0;">
              <b>🌡️ Température :</b> ${temp}°C<br>
              <b>💨 Vent :</b> ${windSpeed} km/h (${windDeg}°)<br>
              <b>☁️ Météo :</b> ${description}
            </div>
          `);
        }
      } catch (err) {
        console.error("Erreur météo sonomètre :", err);
      }
    });

    sonometerMarkers.push(marker);
  });
}

function updateRunwaySonometers() {
    // EBLG
    const windEBLG = window.metarEBLG?.windDeg ?? 220;
    const rwyEBLG = windEBLG > 180 ? "22" : "04";
    renderSonometers("EBLG", rwyEBLG);

    // EBCI
    const windEBCI = window.metarEBCI?.windDeg ?? 240;
    const rwyEBCI = windEBCI > 180 ? "24" : "06";
    renderSonometers("EBCI", rwyEBCI);
}


// =================================================================
// 4. AUTO-SELECTION PISTE
// =================================================================
let currentRunwayEBCI = "24";
let currentRunwayEBLG = "22";

function autoSelectRunway(airport, windDeg, windSpeed) {
  const RWYS = airport === "EBLG"
    ? [{ num: "22", heading: 220 }, { num: "04", heading: 40 }]
    : [{ num: "24", heading: 240 }, { num: "06", heading: 60 }];

  let bestRunway = RWYS[0];
  let bestHeadwind = -999;

  RWYS.forEach(rwy => {
    const diff = Math.abs(windDeg - rwy.heading);
    const angle = diff > 180 ? 360 - diff : diff;
    const headwind = windSpeed * Math.cos(angle * Math.PI / 180);
    if (headwind > bestHeadwind) {
      bestHeadwind = headwind;
      bestRunway = rwy;
    }
  });

  const el = document.getElementById(
    airport === "EBLG" ? "eblg-runway" : "ebci-runway"
  );
  if (el) el.textContent = `Piste ${bestRunway.num}`;
}

// =================================================================
// 5. METEO + CÔNES ILS
// =================================================================
const RUNWAY_HEADINGS = {
  EBLG: 220,
  EBCI: 60
};

let conePolygons = {};

async function fetchWeatherData() {
  for (const [code, apt] of Object.entries(AIRPORTS)) {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${apt.lat}&lon=${apt.lon}`);
      if (!res.ok) continue;

      const weather = await res.json();
      const temp = Math.round(weather.main?.temp ?? 0);
      const windSpeedMs = weather.wind?.speed ?? 0;
      const windSpeedKmh = msToKmh(windSpeedMs);
      const windSpeedKt = Math.round(windSpeedMs * 1.94384);
      const windDeg = weather.wind?.deg ?? 0;

      autoSelectRunway(code, windDeg, windSpeedMs);

      const prefix = code.toLowerCase();
      const tempEl = document.getElementById(`${prefix}-temp`);
      const windEl = document.getElementById(`${prefix}-wind`);

      if (tempEl) tempEl.textContent = `${temp}°C`;
      if (windEl) windEl.textContent = `Vent: ${windSpeedKmh} km/h (${windDeg}°)`;

      updateCompassUI(prefix, windDeg, windSpeedKmh, windSpeedKt);
      drawApproachDepartureCones(code, apt.lat, apt.lon, windDeg);

      fetchSingleMetar(code);
      fetchWeatherForecast(code, apt.lat, apt.lon);

    } catch (e) {
      console.error(`Erreur météo ${code} :`, e);
    }
  }
}

// =================================================================
// 6. ROSE DES VENTS — FIN DU BLOC
// =================================================================
function updateCompassUI(prefix, windDeg, speedKmh, crosswindKt) {
  const card = document.querySelector(`.card[data-airport="${prefix.toUpperCase()}"]`);
  if (!card) return;

  let compassContainer = card.querySelector('.rose-des-vents');
  if (!compassContainer) return;

  compassContainer.innerHTML = `
    <div style="text-align: center; margin-top: 5px;">
      <div style="position: relative; width: 60px; height: 60px; margin: 0 auto; border: 2px solid #3b82f6; border-radius: 50%; background: #1e293b; display: flex; align-items: center; justify-content: center;">
        <span style="position: absolute; top: 2px; font-size: 9px; color: #ef4444; font-weight: bold;">N</span>
        <div style="transform: rotate(${windDeg}deg); transition: transform 0.5s ease; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
          <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 22px solid #38bdf8;"></div>
        </div>
      </div>
      <span style="font-size: 11px; color: #94a3b8; display: block; margin-top: 4px;">${windDeg}° - ${speedKmh} km/h</span>
      <span style="font-size: 11px; font-weight: bold; color: #38bdf8; display: block; margin-top: 2px;">Travers: ${crosswindKt} kt</span>
    </div>
  `;
}

// =================================================================
// 7. TENDANCE MÉTÉO
// =================================================================
async function fetchWeatherForecast(airportCode, lat, lon) {
  const card = document.querySelector(`.card[data-airport="${airportCode}"]`);
  if (!card) return;

  let forecastEl = card.querySelector('.weather-forecast-box');
  if (!forecastEl) {
    forecastEl = document.createElement('div');
    forecastEl.className = 'weather-forecast-box';
    forecastEl.style.cssText = "margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: #cbd5e1;";
    card.appendChild(forecastEl);
  }

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/forecast?lat=${lat}&lon=${lon}`);
    if (!res.ok) {
      forecastEl.innerHTML = `<span style="opacity: 0.7;">Tendance : non disponible</span>`;
      return;
    }

    const data = await res.json();
    const list = data.list ? data.list.slice(0, 3) : [];

    if (list.length > 0) {
      const itemsHtml = list.map(item => {
        const time = new Date(item.dt * 1000).toLocaleTimeString("fr-BE", { hour: '2-digit', minute: '2-digit' });
        const temp = Math.round(item.main.temp);
        const icon = item.weather[0]?.icon ? `https://openweathermap.org/img/wn/${item.weather[0].icon}.png` : '';
        const pop = Math.round((item.pop || 0) * 100);

        return `
          <div style="text-align: center; flex: 1;">
            <div style="color: #94a3b8; font-size: 10px;">${time}</div>
            ${icon ? `<img src="${icon}" style="width:28px; height:28px; margin:-4px 0;" title="${item.weather[0].description}" />` : ''}
            <div style="font-weight: bold;">${temp}°C</div>
            ${pop > 20 ? `<div style="color: #38bdf8; font-size: 10px;">🌧️ ${pop}%</div>` : ''}
          </div>
        `;
      }).join('');

      forecastEl.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px; color: #f8fafc;">Tendance à venir :</div>
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px;">
          ${itemsHtml}
        </div>
      `;
    }
  } catch (err) {
    console.error(`Erreur tendance ${airportCode}:`, err);
    forecastEl.innerHTML = `<span style="opacity: 0.7;">Tendance indisponible</span>`;
  }
}

// =================================================================
// 8. METAR UNIFIÉ
// =================================================================
async function fetchSingleMetar(airportCode) {
  const card = document.querySelector(`.card[data-airport="${airportCode}"]`);
  if (!card) return;

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/metar?station=${airportCode}`);
    if (!res.ok) return;

    const data = await res.json();
    let metarBox = card.querySelector('.metar-box');

    if (!metarBox) {
      metarBox = document.createElement('div');
      metarBox.className = 'metar-box';
      metarBox.style.cssText = "background: rgba(15, 23, 42, 0.6); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; margin-top: 8px; border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; word-break: break-all;";
      card.appendChild(metarBox);
    }

    metarBox.innerHTML = `<strong style="color: #f59e0b;">METAR:</strong> ${data.raw || 'Indisponible'}`;
  } catch (e) {
    console.error(`Erreur METAR ${airportCode}:`, e);
  }
}

// =================================================================
// 9. CÔNES D'APPROCHE & DÉPART
// =================================================================
function drawApproachDepartureCones(airportCode, lat, lon, windDeg) {
  if (!map) return;

  if (conePolygons[airportCode]) {
    conePolygons[airportCode].forEach(layer => map.removeLayer(layer));
  }
  conePolygons[airportCode] = [];

  const rwyHeading = RUNWAY_HEADINGS[airportCode] || 0;
  const diff = Math.abs(((windDeg - rwyHeading + 180) % 360) - 180);

  const activeApproachBearing = diff > 90 ? (rwyHeading + 180) % 360 : rwyHeading;

  function createConePoints(originLat, originLng, bearing, distanceKm = 8, angleWidth = 25) {
    const coords = [[originLat, originLng]];
    const startAngle = bearing - angleWidth / 2;
    const endAngle = bearing + angleWidth / 2;

    for (let a = startAngle; a <= endAngle; a += 5) {
      const rad = a * (Math.PI / 180);
      const dLat = (distanceKm / 110.574) * Math.cos(rad);
      const dLng = (distanceKm / (111.320 * Math.cos(originLat * (Math.PI / 180)))) * Math.sin(rad);
      coords.push([originLat + dLat, originLng + dLng]);
    }
    return coords;
  }

  const appBearing = (activeApproachBearing + 180) % 360;
  const approachPoints = createConePoints(lat, lon, appBearing);
  const approachPoly = L.polygon(approachPoints, {
    color: '#10b981',
    fillColor: '#10b981',
    fillOpacity: 0.15,
    weight: 1,
    dashArray: '4, 4'
  }).bindTooltip(`Axe d'approche (${activeApproachBearing}°)`);

  const departurePoints = createConePoints(lat, lon, activeApproachBearing);
  const departurePoly = L.polygon(departurePoints, {
    color: '#ef4444',
    fillColor: '#ef4444',
    fillOpacity: 0.12,
    weight: 1,
    dashArray: '4, 4'
  }).bindTooltip(`Axe de départ (${activeApproachBearing}°)`);

  approachPoly.addTo(map);
  departurePoly.addTo(map);

  conePolygons[airportCode].push(approachPoly, departurePoly);
}

// =================================================================
// 10. FILTRE AÉROPORT
// =================================================================
window.filterAirportView = function(airport) {
  const buttons = document.querySelectorAll('.control-bar-inline .airport-icon-btn');
  buttons.forEach(btn => btn.classList.remove('active'));

  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  } else {
    const activeBtn = document.querySelector(`.control-bar-inline .airport-icon-btn[onclick*="${airport}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  currentAirport = airport;

  const cards = document.querySelectorAll('[data-airport]');
  cards.forEach(card => {
    const cardAirport = card.getAttribute('data-airport');
    card.style.display = (airport === 'ALL' || cardAirport === airport) ? 'block' : 'none';
  });

  if (map && AIRPORT_COORDS[airport]) {
    const zoomLevel = airport === 'ALL' ? 8 : 11;
    map.setView(AIRPORT_COORDS[airport], zoomLevel, { animate: true });
  }

  if (typeof updateFIDS === "function") {
    updateFIDS();
  }
};

// =================================================================
// 11. EXPORTS (si nécessaire pour d'autres modules)
// =================================================================
export {
  fetchWeatherData,
  fetchMetarData,
  renderSonometersOnMap,
  autoSelectRunway,
  drawApproachDepartureCones
};
