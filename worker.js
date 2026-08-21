export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 1. Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 2. Endpoint Météo OpenWeather
      if (path === "/api/weather") {
        const lat = url.searchParams.get("lat") || "50.45";
        const lon = url.searchParams.get("lon") || "4.45";
        const targetUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${env.OPENWEATHER_API_KEY}&units=metric&lang=fr`;
        
        const res = await fetch(targetUrl);
        const data = await res.json();

        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
        });
      }

      // 3. Endpoint METAR (Aviation Weather / AVWX)
     // Extrait à vérifier/remplacer dans votre worker.js
if (path === "/api/metar") {
  const station = url.searchParams.get("station") || "EBLG";
  
  // Utilisation de l'API AVWX / AviationWeather
  const targetUrl = `https://avwx.rest/api/metar/${station}`;

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Dashboard-Aero",
      ...(env.AVWR_API_KEY && { "Authorization": `BEARER ${env.AVWR_API_KEY}` })
    }
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Erreur AVWX", status: res.status }), {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const data = await res.json();

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=180"
    }
  });
}

     // 4. Endpoint FIDS Liège Airport (EBLG)
      if (path === "/api/fids-eblg") {
        const type = url.searchParams.get("type") || "departures";
        const fidsTargetUrl = `https://fids.liegeairport.com/api/flights?type=${type}`;

        const response = await fetch(fidsTargetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://fids.liegeairport.com/"
          }
        });

        if (!response.ok) {
          throw new Error(`FIDS indisponible (${response.status})`);
        }

        const rawData = await response.json();
        const list = Array.isArray(rawData) ? rawData : (rawData.flights || []);

        // =========================================================
        // ICI : ADAPTATION ET CONVERSION EN HEURE LOCALE (Belgique)
        // =========================================================
        const cleanFlights = list.map(f => {
          let timeFormatted = f.scheduledTime || f.time || f.estimatedTime || "--:--";

          // Si le FIDS fournit un Horodatage Unix (ex: 1718900000) ou un ISO String (ex: 2026-08-21T10:00:00Z)
          if (timeFormatted !== "--:--" && !isNaN(Date.parse(timeFormatted))) {
            const dateObj = new Date(timeFormatted);
            timeFormatted = dateObj.toLocaleTimeString("fr-BE", {
              timeZone: "Europe/Brussels",
              hour: "2-digit",
              minute: "2-digit"
            });
          }

          return {
            flight: f.flightNumber || f.code || f.callsign || "N/A",
            destination: f.destination || f.origin || f.city || "Inconnu",
            time: timeFormatted, // Affiche l'heure locale exacte de Belgique (ex: 13:45)
            status: f.status || "Programmé"
          };
        });
        // =========================================================

        return new Response(JSON.stringify({ type, flights: cleanFlights }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }
        });
      }

      // 5. Endpoint Vols Airlabs (Optionnel / EBCI)
      if (path === "/api/flights") {
        const airport = url.searchParams.get("airport") || "EBCI";
        const targetUrl = `https://airlabs.co/api/v9/schedules?dep_icao=${airport}&api_key=${env.AIRLABS_API_KEY}`;

        const res = await fetch(targetUrl);
        const data = await res.json();

        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
        });
      }

      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Erreur serveur Proxy", details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};


