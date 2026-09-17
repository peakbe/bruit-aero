// ===============================================================
// flights.js — Service de récupération des vols réels EBCI / EBLG
// ===============================================================

import { WORKER_BASE_URL } from "./config.js";

/**
 * Récupère les vols réels (arrivées ou départs) pour un aéroport donné
 * @param {'EBLG' | 'EBCI'} airport - Code ICAO de l'aéroport
 * @param {'arrival' | 'departure'} type - Type de mouvements
 * @returns {Promise<Array>} Liste des vols
 */
export async function fetchRealFlights(airport, type = 'arrival') {
  const now = Math.floor(Date.now() / 1000);
  // Intervalle de 2 heures en arrière
  const begin = now - 7200;

  try {
    // Option A : Via votre Worker / Proxy backend (recommandé pour contourner CORS & cacher la clé API)
    const response = await fetch(`${WORKER_BASE_URL}/api/flights?apt=${airport}&type=${type}`);

    // Option B : Directement via OpenSky Network API
    // const response = await fetch(`https://opensky-network.org/api/flights/${type}?airport=${airport}&begin=${begin}&end=${now}`);

    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }

    const data = await response.json();
    return processFlightData(data, airport, type);
  } catch (error) {
    console.error(`Erreur lors de la récupération des vols réels (${airport}):`, error);
    return [];
  }
}

/**
 * Nettoie et formate les données brutes reçues de l'API
 */
function processFlightData(flights, airport, type) {
  if (!Array.isArray(flights)) return [];

  return flights.map(f => {
    const time = type === 'arrival' ? f.firstSeen : f.lastSeen;
    const timeFormatted = time ? new Date(time * 1000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '--:--';

    return {
      callsign: f.callsign ? f.callsign.trim() : 'N/A',
      icao24: f.icao24,
      estDepartureAirport: f.estDepartureAirport || 'Inconnu',
      estArrivalAirport: f.estArrivalAirport || 'Inconnu',
      time: timeFormatted,
      airport: airport,
      type: type
    };
  });
}
