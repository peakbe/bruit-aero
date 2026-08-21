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
