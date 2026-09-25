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
    // Appel au Worker backend (Syntaxe littérale corrigée)
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
    container.innerHTML = `
