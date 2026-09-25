// ===============================================================
// js/flights.js — Service de récupération des vols réels EBCI / EBLG
// ===============================================================

import { WORKER_BASE_URL } from "./config.js";

/**
 * Récupère les vols réels (arrivées ou départs) depuis l'API / Worker
 * @param {'EBLG' | 'EBCI'} airport - Code ICAO de l'aéroport
 * @param {'arrival' | 'departure'} type - Type de mouvements
 * @returns {Promise} Liste des vols formatée
 */
export async function fetchRealFlights(airport, type = 'arrival') {
  try {
    const response = await fetch(`\({WORKER_BASE_URL}/api/flights?apt=\){airport}&type=${type}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Erreur réseau HTTP: ${response.status}`);
    }

    const data = await response.json();
    return formatFlightData(data, airport, type);

  } catch (error) {
    console.error(`[flights.js] Erreur chargement vols \({type} pour\){airport}:`, error);
    return [];
  }
}

/**
 * Normalise et formate les objets de vol reçus de l'API OpenSky / Aviationstack
 */
function formatFlightData(rawFlights, airport, type) {
  if (!Array.isArray(rawFlights)) return [];

  return rawFlights.map(f => {
    const timestamp = type === 'arrival' ? (f.firstSeen || f.estArrivalAirportTime) : (f.lastSeen || f.estDepartureAirportTime);
    
    const timeFormatted = timestamp 
      ? new Date(timestamp * 1000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) 
      : '--:--';

    return {
      callsign: (f.callsign || f.number || 'N/A').trim(),
      icao24: f.icao24 || 'UNK',
      origin: f.estDepartureAirport || f.dep_icao || 'Inconnu',
      destination: f.estArrivalAirport || f.arr_icao || 'Inconnu',
      time: timeFormatted,
      airport: airport,
      type: type
    };
  });
}

/**
 * Met à jour le tableau d'affichage des vols dans le DOM
 * @param {string} containerId - L'ID de l'élément HTML parent
 * @param {Array} flights - La liste des vols
 */
export function renderFlightTable(containerId, flights) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  if (!flights || flights.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.cssText = "color:#64748b; padding:10px; text-align:center;";
    emptyDiv.textContent = "Aucun vol trouvé";
    container.appendChild(emptyDiv);
    return;
  }

  const table = document.createElement("table");
  table.style.cssText = "width:100%; text-align:left; font-size:12px; border-collapse:collapse;";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.style.cssText = "color:#94a3b8; border-bottom:1px solid #475569;";

  const headers = ["VOL", "PROVENANCE/DEST.", "HEURE"];
  headers.forEach(text => {
    const th = document.createElement("th");
    th.style.padding = "4px";
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  flights.forEach(f => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #334155";

    const tdCallsign = document.createElement("td");
    tdCallsign.style.cssText = "color:#00ffff; font-weight:bold; padding:6px;";
    tdCallsign.textContent = f.callsign;

    const tdLoc = document.createElement("td");
    tdLoc.style.cssText = "color:#cbd5e1; padding:6px;";
    tdLoc.textContent = f.type === "arrival" ? f.origin : f.destination;

    const tdTime = document.createElement("td");
    tdTime.style.cssText = "color:#f59e0b; padding:6px;";
    tdTime.textContent = f.time;

    tr.appendChild(tdCallsign);
    tr.appendChild(tdLoc);
    tr.appendChild(tdTime);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}
