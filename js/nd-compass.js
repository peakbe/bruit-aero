// ===============================================================
// nd-compass.js — Boussole / Rosace Vent Style Airbus ND
// ===============================================================

export function drawCompass(canvasId, windDeg, windSpeed) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2 - 6; // Légère élévation pour laisser de la place au texte en bas
  const r = Math.min(w, h) / 2 - 14;

  ctx.clearRect(0, 0, w, h);

  // 1. CERCLE EXTÉRIEUR (Rosace)
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2. GRADUATIONS & CARDINAUX (N, E, S, W)
  const cardinalPoints = [
    { label: "N", angle: 0, color: "#ef4444" },  // Rouge pour le Nord
    { label: "E", angle: 90, color: "#94a3b8" },
    { label: "S", angle: 180, color: "#94a3b8" },
    { label: "W", angle: 270, color: "#94a3b8" }
  ];

  ctx.font = "bold 10px Consolas, Monaco, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  cardinalPoints.forEach(pt => {
    const aRad = (pt.angle - 90) * Math.PI / 180;
    const tx = cx + (r - 9) * Math.cos(aRad);
    const ty = cy + (r - 9) * Math.sin(aRad);

    ctx.fillStyle = pt.color;
    ctx.fillText(pt.label, tx, ty);
  });

  // Ticks secondaires (graduations tous les 30°)
  for (let deg = 0; deg < 360; deg += 30) {
    if (deg % 90 === 0) continue; // Sauter les points cardinaux
    const aRad = (deg - 90) * Math.PI / 180;
    const x1 = cx + r * Math.cos(aRad);
    const y1 = cy + r * Math.sin(aRad);
    const x2 = cx + (r - 4) * Math.cos(aRad);
    const y2 = cy + (r - 4) * Math.sin(aRad);

    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 3. FLÈCHE DU VENT (Vector + Arrowhead)
  if (windSpeed > 0) {
    // Calcul de l'angle du vent (origine météo -> destination)
    const windRad = (windDeg - 90) * Math.PI / 180;
    const arrowLength = r - 12;

    const endX = cx + arrowLength * Math.cos(windRad);
    const endY = cy + arrowLength * Math.sin(windRad);

    // Ligne principale de la flèche (Cyan Airbus)
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Tête de flèche à l'extrémité
    const headLen = 6;
    const angleHead = Math.PI / 6;

    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLen * Math.cos(windRad - angleHead),
      endY - headLen * Math.sin(windRad - angleHead)
    );
    ctx.lineTo(
      endX - headLen * Math.cos(windRad + angleHead),
      endY - headLen * Math.sin(windRad + angleHead)
    );
    ctx.closePath();
    ctx.fill();
  }

  // Point central
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 4. TEXTE DU VENT (Direction / Vitesse)
  const degStr = String(Math.round(windDeg)).padStart(3, "0");
  const spdStr = Math.round(windSpeed);

  ctx.fillStyle = "#22c55e"; // Vert Vert/Airbus PRO
  ctx.font = "bold 11px Consolas, Monaco, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${degStr}° / ${spdStr} km/h`, cx, h - 2);
}
