// ===============================================================
// config.js — Cockpit Airbus PRO+++
// Centralisation des constantes globales
// ===============================================================

// Proxy Cloudflare Workers
export const WORKER_BASE_URL =
  "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

// Coordonnées des aéroports pour la carte (ALL = vue générale)
export const AIRPORT_COORDS = {
  EBCI: { lat: 50.4592, lon: 4.4538 },
  EBLG: { lat: 50.6374, lon: 5.4432 },
  ALL:  { lat: 50.55,   lon: 4.95 }
};

// Headings principaux des pistes (utilisés pour les calculs ND / ILS)
export const RUNWAY_HEADINGS = {
  EBLG: {
    "22": 222,
    "04": 42
  },
  EBCI: {
    "24": 241,
    "06": 61
  }
};

// Paramètres de rendu des cônes d'approche/départ (carte Leaflet)
export const ILS_CONE_LENGTH = 6000; // Longueur en mètres
export const ILS_CONE_SPREAD = 0.02; // Ouverture angulaire

// Cadences de rafraîchissement (ms)
export const RADAR_REFRESH_MS   = 5000;   // ADS-B / FIDS (5 secondes)
export const METAR_REFRESH_MS   = 300000; // METAR VATSIM (5 minutes)
export const WEATHER_REFRESH_MS = 300000; // Météo Open-Meteo (5 minutes)
