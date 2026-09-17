// ===============================================================
// Cloudflare Worker Proxy PRO - Bruit Aéro (EBLG / EBCI)
// ===============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    // 1. Gestion des requêtes Preflight CORS (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // -------------------------------------------------------------
      // ROUTE 1 : /api/adsb -> Avions en direct via OpenSky Network
      // -------------------------------------------------------------
      if (pathname === "/api/adsb") {
        // Zone Belgique (EBLG/EBCI)
        const openSkyUrl = "https://opensky-network.org/api/states/all?lamin=50.0&lomin=4.0&lamax=51.0&lomax=6.0";
        const res = await fetch(openSkyUrl, {
          headers: { "User-Agent": "BruitAeroProxy/1.0" }
        });
        
        const data = res.ok ? await res.json() : { states: [] };
        return jsonResponse(data);
      }

      // -------------------------------------------------------------
      // ROUTE 2 : /api/meteo -> METAR aviation (via NOAA / AviationWeather)
      // -------------------------------------------------------------
      if (pathname === "/api/meteo") {
        const apt = (url.searchParams.get("apt") || "EBLG").toUpperCase();
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${apt}&format=json`;
        
        const res = await fetch(metarUrl, {
          headers: { "User-Agent": "BruitAeroProxy/1.0" }
        });

        if (res.ok) {
          const data = await res.json();
          const rawMetar = data[0]?.rawOb || `${apt} N/A`;
          return jsonResponse({ apt, metar: rawMetar, raw: rawMetar, data: data[0] });
        }
        
        return jsonResponse({ apt, metar: `${apt} METAR UNAVAILABLE`, raw: "" });
      }

      // -------------------------------------------------------------
      // ROUTE 3 : /api/taf -> Prévisions TAF aviation
      // -------------------------------------------------------------
      if (pathname === "/api/taf") {
        const apt = (url.searchParams.get("apt") || "EBLG").toUpperCase();
        const tafUrl = `https://aviationweather.gov/api/data/taf?ids=${apt}&format=raw`;
        
        const res = await fetch(tafUrl, {
          headers: { "User-Agent": "BruitAeroProxy/1.0" }
        });

        const tafText = res.ok ? await res.text() : "TAF non disponible";
        return new Response(tafText, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders }
        });
      }

      // -------------------------------------------------------------
      // ROUTE 4 : /api/weather -> Météo locale / Sonomètres (Open-Meteo)
      // -------------------------------------------------------------
      if (pathname === "/api/weather") {
        const lat = url.searchParams.get("lat") || "50.6371";
        const lon = url.searchParams.get("lon") || "5.4432";
        
        const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        const res = await fetch(omUrl);
        
        if (res.ok) {
          const data = await res.json();
          const cw = data.current_weather || {};
          return jsonResponse({
            meteo: {
              main: { temp: cw.temperature ?? 15 },
              wind: { speed: (cw.windspeed ?? 10) / 3.6, deg: cw.winddirection ?? 0 } // m/s
            }
          });
        }

        return jsonResponse({ meteo: { main: { temp: 15 }, wind: { speed: 3, deg: 220 } } });
      }

      // -------------------------------------------------------------
      // ROUTE 5 : /api/flights ou /api/fids-adsb -> Départs & Arrivées réels
      // -------------------------------------------------------------
      if (pathname === "/api/flights" || pathname === "/api/fids-adsb") {
        const apt = (url.searchParams.get("apt") || url.searchParams.get("airport") || "EBLG").toUpperCase();
        const type = url.searchParams.get("type") || "arrival";
        
        const now = Math.floor(Date.now() / 1000);
        const begin = now - (12 * 3600); // 12h en arrière

        const openSkyFlightsUrl = `https://opensky-network.org/api/flights/${type}?airport=${apt}&begin=${begin}&end=${now}`;
        const res = await fetch(openSkyFlightsUrl, {
          headers: { "User-Agent": "BruitAeroProxy/1.0" }
        });

        const data = res.ok ? await res.json() : [];
        return jsonResponse(data);
      }

      // 404 pour toute autre route inconnue
      return jsonResponse({ error: `Route '${pathname}' non trouvée.` }, 404);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

/**
 * Helper pour retourner une réponse JSON structurée avec CORS
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}
