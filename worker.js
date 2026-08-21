export default {
  async fetch(request, env, ctx) {
    // 1. Gestion des requêtes Preflight CORS (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // Vous pouvez restreindre à "https://votre-pseudo.github.io"
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.request || request.url);
    const path = url.pathname;

    let targetUrl = "";

    // 2. Routing selon le service demandé
    switch (path) {
      case "/api/weather": {
        // Paramètres passés par le front-end (ex: ?lat=50.45&lon=4.45)
        const lat = url.searchParams.get("lat") || "50.45";
        const lon = url.searchParams.get("lon") || "4.45";
        
        // La clé OPENWEATHER_API_KEY est injectée depuis les variables d'environnement Cloudflare
        targetUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${env.OPENWEATHER_API_KEY}&units=metric`;
        break;
      }

      case "/api/metar": {
        const station = url.searchParams.get("station") || "EBCI";
        // Exemple avec Aviation Weather REST / AVWR
        targetUrl = `https://avwx.rest/api/metar/${station}`;
        break;
      }

      case "/api/flights": {
        const airport = url.searchParams.get("airport") || "EBCI";
        // Exemple avec Airlabs
        targetUrl = `https://airlabs.co/api/v9/schedules?dep_icao=${airport}&api_key=${env.AIRLABS_API_KEY}`;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
    }

    export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);

    // Endpoint pour récupérer les vols EBLG
    if (url.pathname === "/api/fids-eblg") {
      const type = url.searchParams.get("type") || "departures"; // 'departures' ou 'arrivals'

      try {
        // Interception directe de l'API REST interne du FIDS Liege Airport
        const fidsTargetUrl = `https://fids.liegeairport.com/api/flights?type=${type}`;

        const response = await fetch(fidsTargetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://fids.liegeairport.com/"
          }
        });

        if (!response.ok) {
          throw new Error(`Erreur HTTP: ${response.status}`);
        }

        const rawData = await response.json();

        // Transformation et nettoyage des données pour le front-end HTML
        const cleanFlights = (rawData.flights || rawData || []).map(flight => ({
          flight: flight.flightNumber || flight.code || "N/A",
          airline: flight.airline || flight.company || "Cargo/Passenger",
          destination: flight.destination || flight.origin || "Inconnu",
          time: flight.scheduledTime || flight.time || "--:--",
          status: flight.status || "Programmé",
          gate: flight.gate || flight.stand || "-"
        }));

        return new Response(JSON.stringify({ type, flights: cleanFlights }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=120" // Cache 2 minutes pour éviter de surcharger le FIDS
          }
        });

      } catch (err) {
        // Fallback en cas de blocage ou de changement de structure du FIDS
        return new Response(JSON.stringify({
          error: "Impossible de récupérer le FIDS EBLG",
          details: err.message
        }), {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    return new Response("Endpoint introuvable", { status: 404 });
  }
};
    
    try {
      // 3. Appel de l'API tierce depuis les serveurs Cloudflare
      const apiResponse = await fetch(targetUrl, {
        headers: {
          // Injection d'un Token d'autorisation HTTP si requis par l'API (ex: AVWR)
          ...(env.AVWR_API_KEY && { "Authorization": `BEARER ${env.AVWR_API_KEY}` }),
          "User-Agent": "Dashboard-EBCI-EBLG"
        }
      });

      const data = await apiResponse.json();

      // 4. Renvoi de la réponse au front-end avec les en-têtes CORS
      return new Response(JSON.stringify(data), {
        status: apiResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", // Autorise votre GitHub Pages à lire la réponse
          "Cache-Control": "public, max-age=60" // Mise en cache optionnelle (60 sec)
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Erreur lors de la requête proxy", details: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
