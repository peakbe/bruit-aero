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
      // 1. Météo Open-Meteo
      if (path === "/api/weather") {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        try {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,visibility,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&forecast_hours=24`
          );

          if (!response.ok) {
            return new Response(
              JSON.stringify({ error: "Données indisponibles" }),
              {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const data = await response.json();

          const formattedData = {
            main: { temp: data.current.temperature_2m },
            wind: {
              speed: data.current.wind_speed_10m / 3.6, // Conversion m/s
              deg: data.current.wind_direction_10m,
            },
            visibility: data.current.visibility,
            hourly: data.hourly,
          };

          return new Response(JSON.stringify(formattedData), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: "Données indisponibles" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      // 2. METAR NOAA
      if (path === "/api/metar") {
        const station = url.searchParams.get("station") || "EBLG";

        try {
          const response = await fetch(
            `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${station.toUpperCase()}.TXT`
          );

          if (!response.ok) {
            return new Response(
              JSON.stringify({ error: "Données indisponibles" }),
              {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const text = await response.text();
          const lines = text.trim().split("\n");
          const rawMetar = lines.length > 1 ? lines[1].trim() : text.trim();

          return new Response(JSON.stringify({ raw: rawMetar }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: "Données indisponibles" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      // 3. FIDS (Vols)
      if (path.includes("/api/fids")) {
        const airport = (
          url.searchParams.get("airport") || "EBLG"
        ).toUpperCase();
        const type = url.searchParams.get("type") || "departures";

        if (airport === "EBLG") {
          const fidsTargetUrl = `https://fids.liegeairport.com/api/v1/flights?type=${type}`;
          try {
            const response = await fetch(fidsTargetUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Referer: "https://www.liegeairport.com/",
              },
            });

            if (response.ok) {
              const rawData = await response.json();
              const list = Array.isArray(rawData)
                ? rawData
                : rawData.flights || [];

              const cleanFlights = list.slice(0, 10).map((f) => ({
                flight: f.flightNumber || f.code || "N/A",
                city: f.destination || f.origin || f.city || "Inconnu",
                time: f.scheduledTime || f.time || "--:--",
                status: f.status || "Programmé",
              }));

              return new Response(
                JSON.stringify({ airport, type, flights: cleanFlights }),
                {
                  status: 200,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }
          } catch (e) {
            console.error(e);
          }
        }

        // Si l'aéroport n'est pas supporté ou si l'API externe échoue
        return new Response(
          JSON.stringify({
            airport,
            type,
            flights: [],
            message: "Données indisponibles",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // 4. OpenSky Network (avec Authentification)
if (path === "/api/opensky") {
  try {
    const openskyUrl =
      "https://opensky-network.org/api/states/all?lamin=50.2&lamax=50.8&lomin=4.2&lomax=5.8";

    // Récupération des identifiants depuis l'environnement Cloudflare Worker
    const clientId = env.OPENSKY_CLIENT_ID || "peak-api-client";
    const clientSecret = env.OPENSKY_CLIENT_SECRET;

    const headers = {
      "User-Agent": "Dashboard-Aero-App",
    };

    // Si le secret est présent, on ajoute l'en-tête d'authentification Basic
    if (clientSecret) {
      const credentials = btoa(`${clientId}:${clientSecret}`);
      headers["Authorization"] = `Basic ${credentials}`;
    }

    const response = await fetch(openskyUrl, { headers });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: "Données indisponibles" }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Données indisponibles" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

      // Endpoint non reconnu
      return new Response(
        JSON.stringify({ error: "Endpoint non trouvé", path }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Données indisponibles",
          details: err.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};
