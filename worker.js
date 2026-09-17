// ===============================================================
// Cloudflare Worker Proxy — En-têtes CORS autorisés
// ===============================================================

// En-têtes CORS réutilisables
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Vous pouvez remplacer "*" par "https://peakbe.github.io" pour plus de sécurité
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    // 1. Gérer les requêtes pré-vol CORS (Preflight OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      const url = new URL(request.url);

      // Ex : Gestion de la route /api/fids-adsb
      if (url.pathname === "/api/fids-adsb") {
        const airport = url.searchParams.get("airport") || "EBLG";
        
        // Exemple d'appel vers l'API OpenSky Network
        const openSkyUrl = `https://opensky-network.org/api/states/all`;
        const apiResponse = await fetch(openSkyUrl);
        const data = await apiResponse.json();

        // Renvoyer la réponse avec les en-têtes CORS
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }

      // Route non trouvée
      return new Response(JSON.stringify({ error: "Route non trouvée" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
  }
};
