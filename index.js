export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    try {
      // 1. Météo OpenWeather
      if (path.includes("/api/weather")) {
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

      // 2. METAR (AVWX)
      if (path.includes("/api/metar")) {
        const station = url.searchParams.get("station") || "EBCI";
        const targetUrl = `https://avwx.rest/api/metar/${station}`;

        const res = await fetch(targetUrl, {
          headers: {
            ...(env.AVWR_API_KEY && { "Authorization": `BEARER ${env.AVWR_API_KEY}` })
          }
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=180" }
        });
      }

      // 3. FIDS Liège Airport (EBLG)
      if (path.includes("/api/fids-eblg")) {
        const type = url.searchParams.get("type") || "departures";
        const fidsTargetUrl = `https://www.liegeairport.com/fids/api/flights?type=${type}`;

        try {
          const response = await fetch(fidsTargetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/json, text/plain, */*",
              "Referer": "https://www.liegeairport.com/"
            }
          });

          if (response.ok) {
            const rawData = await response.json();
            const list = Array.isArray(rawData) ? rawData : (rawData.flights || []);

            const cleanFlights = list.map(f => ({
              flight: f.flightNumber || f.code || f.callsign || "N/A",
              destination: f.destination || f.origin || f.city || "Inconnu",
              time: f.scheduledTime || f.time || "--:--",
              status: f.status || "Programmé"
            }));

            return new Response(JSON.stringify({ type, flights: cleanFlights }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }
            });
          }
        } catch (fidsError) {
          console.error("FIDS Fetch Error:", fidsError);
        }

        // Fallback si l'API de Liege Airport bloque la requête serveur
        const fallbackFlights = [
          { flight: "3V801", destination: "Tel Aviv (TLV) - Cargo", time: "22:15", status: "Programmé" },
          { flight: "3V452", destination: "Madrid (MAD) - Cargo", time: "23:00", status: "Programmé" },
          { flight: "5Y091", destination: "New York (JFK) - Cargo", time: "23:45", status: "A l'heure" }
        ];

        return new Response(JSON.stringify({ type, flights: fallbackFlights, source: "fallback" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Endpoint non trouvé", path }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Erreur serveur Proxy", details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
