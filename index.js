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

      // 2. METAR
    if (url.pathname === '/api/metar') {
      const station = url.searchParams.get('station') || 'EBLG';
      
      try {
        const response = await fetch(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${station.toUpperCase()}.TXT`);
        
        if (!response.ok) {
          return new Response(JSON.stringify({ error: "METAR introuvable" }), {
            status: response.status,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const text = await response.text();
        const lines = text.trim().split('\n');
        const rawMetar = lines.length > 1 ? lines[1].trim() : text.trim();

        return new Response(JSON.stringify({ raw: rawMetar }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Erreur serveur" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

      // 3. FIDS (EBLG & EBCI)
      if (path.includes("/api/fids")) {
        const airport = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const type = url.searchParams.get("type") || "departures";

        if (airport === "EBLG") {
          const fidsTargetUrl = `https://fids.liegeairport.com/api/v1/flights?type=${type}`;
          try {
            const response = await fetch(fidsTargetUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.liegeairport.com/"
              }
            });

            if (response.ok) {
              const rawData = await response.json();
              const list = Array.isArray(rawData) ? rawData : (rawData.flights || []);
              
              const cleanFlights = list.slice(0, 10).map(f => ({
                flight: f.flightNumber || f.code || "N/A",
                city: f.destination || f.origin || f.city || "Inconnu",
                time: f.scheduledTime || f.time || "--:--",
                status: f.status || "Programmé"
              }));

              return new Response(JSON.stringify({ airport, type, flights: cleanFlights }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          } catch (e) {
            console.error(e);
          }
        }

        // Fallback / Données de test
        const mockData = airport === "EBCI" 
          ? [
              { flight: "FR1002", city: type === "departures" ? "Marseille (MRS)" : "Porto (OPO)", time: "14:10", status: "A l'heure" },
              { flight: "FR2104", city: type === "departures" ? "Alicante (ALC)" : "Milan (BGY)", time: "14:45", status: "Embarquement" },
              { flight: "W64201", city: type === "departures" ? "Varsovie (WAW)" : "Budapest (BUD)", time: "15:20", status: "Programmé" }
            ]
          : [
              { flight: "3V801", city: type === "departures" ? "Tel Aviv (TLV)" : "Dubaï (DWC)", time: "22:15", status: "Programmé" },
              { flight: "3V452", city: type === "departures" ? "Madrid (MAD)" : "Zhengzhou (CGO)", time: "23:00", status: "A l'heure" }
            ];

        return new Response(JSON.stringify({ airport, type, flights: mockData }), {
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
