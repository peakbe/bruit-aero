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
  ALL:  { lat: 50.55, lon: 4.95 }
};

// Headings des pistes (utile pour ND / ILS)
export const RUNWAY_HEADINGS = {
  EBLG: 220,
  EBCI: 60
};

// Longueur du cône ILS (m)
export const ILS_CONE_LENGTH = 6000;

// Largeur du cône ILS (degrés lat/lon)
export const ILS_CONE_SPREAD = 0.02;

// Intervalle radar ADS‑B (ms)
export const RADAR_REFRESH_MS = 5000;

// Intervalle METAR (ms)
export const METAR_REFRESH_MS = 300000;

// Intervalle météo locale (ms)
export const WEATHER_REFRESH_MS = 300000;
