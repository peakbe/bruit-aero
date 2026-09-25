// ===============================================================
// js/flights.js — Service de récupération des vols réels EBCI / EBLG
// ===============================================================

import { WORKER_BASE_URL } from "./config.js";

/**
 * Récupère les vols réels (arrivées ou départs) depuis l'API / Worker
 * @param {'EBLG' | 'EBCI'} airport - Code ICAO de l'aéroport
 * @param {'arrival' | 'departure'} type - Type de mouvements
 * @returns {Promise<Array>} Liste des vols formatée
 */
export async function fetchRealFlights(airport, type = 'arrival') {
  try {
    // Appel au Worker backend
    const response = await fetch(`\({WORKER_BASE_URL}/api/flights?apt=\){airport}&type=${type}`);

    if (!response.ok) {
      throw new Error(`Erreur réseau HTTP: ${response.status}`);
    }

    const data = await response.json();
    return formatFlightData(data, airport, type);

  } catch (error) {
    console.error(`[flights.js] Erreur chargement vols ${type} pour ${airport}:`, error);
    return [];
  }
}

/**
 * Normalise et formate les objets de vol reçus de l'API OpenSky / Aviationstack
 */
function formatFlightData(rawFlights, airport, type) {
  if (!Array.isArray(rawFlights)) return [];

  return rawFlights.map(f => {
    // Calcul de l'heure Unix
    const timestamp = type === 'arrival' ? (f.firstSeen || f.estArrivalAirportTime) : (f.lastSeen || f.estDepartureAirportTime);
    
    // Formatage HH:MM
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

  if (!flights || flights.length === 0) {
    container.innerHTML = `<div style="color:#64748b; padding:10px; text-align:center;">Aucun vol trouvé</div>`;
    return;
  }

  const rowsHtml = flights.map(f => `
    <tr style="border-bottom: 1px solid #334155;">
      <td style="color:#00ffff; font-weight:bold; padding:6px;">${f.callsign}</td>
      <td style="color:#cbd5e1; padding:6px;">${f.type === 'arrival' ? f.origin : f.destination}</td>
      <td style="color:#f59e0b; padding:6px;">${f.time}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table style="width:100%; text-align:left; font-size:12px; border-collapse:collapse;">
      <thead>
        <tr style="color:#94a3b8; border-bottom:1px solid #475569;">
          <th style="padding:4px;">VOL</th>
          <th style="padding:4px;">PROVENANCE/DEST.</th>
          <th style="padding:4px;">HEURE</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}
