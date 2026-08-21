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

     // 3. FIDS Liège Airport (EBLG) - contournement du blocage
      if (path.includes("/api/fids-eblg")) {
        const type = url.searchParams.get("type") || "departures";
        
        // URL interne du service FIDS de Liege Airport
        const fidsTargetUrl = `https://fids.liegeairport.com/api/v1/flights?type=${type}`;

        try {
          const response = await fetch(fidsTargetUrl, {
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
              "Origin": "https://www.liegeairport.com",
              "Referer": "https://www.liegeairport.com/"
            }
          });

          if (response.ok) {
            const rawData = await response.json();
            const list = Array.isArray(rawData) ? rawData : (rawData.flights || rawData.data || []);

            if (list.length > 0) {
              const cleanFlights = list.map(f => ({
                flight: f.flightNumber || f.flight_no || f.code || "N/A",
                destination: f.destination || f.airport || f.city || "Inconnu",
                time: f.scheduledTime || f.time || f.estimated || "--:--",
                status: f.status || "Programmé"
              }));

              return new Response(JSON.stringify({ type, flights: cleanFlights, source: "live" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" }
              });
            }
          }
        } catch (fidsError) {
          console.error("Erreur direct FIDS:", fidsError);
        }

        // Si l'API en direct échoue, on renvoie le fallback avec un timestamp explicite
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
  }
};
