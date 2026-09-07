// ===============================================================
// sono.js — Sonomètres EBLG + EBCI + couleurs dynamiques
// ===============================================================

import { map } from "./map.js";

// ---------------------------------------------------------------
// 1. Conversion DMS → décimal
// ---------------------------------------------------------------
function dmsToDecimal(dms) {
    const parts = dms.split(" ");
    const deg = parseFloat(parts[0]);
    const min = parseFloat(parts[1]);
    const sec = parseFloat(parts[2]);
    const dir = parts[3];

    let dec = deg + (min / 60) + (sec / 3600);
    if (dir === "S" || dir === "W") dec *= -1;
    return dec;
}

// ---------------------------------------------------------------
// 2. Sonomètres EBCI / EBLG
// ---------------------------------------------------------------
export const sonometersEBCI = [...];   // (tes données)
export const sonometersEBLG = [...];   // (tes données)

// ---------------------------------------------------------------
// 3. Conditions d'affichage selon piste
// ---------------------------------------------------------------
const rules = {
    EBLG: {
        "22": {
            green: ["F001","F002","F003","F004","F005","F006","F007","F008","F009","F010","F011","F012","F013","F014","F015","F016","F017"],
            red: []
        },
        "04": {
            green: ["F001","F002","F003","F007","F008","F009","F011","F013","F014","F015"],
            red:   ["F004","F005","F006","F010","F012","F016","F017"]
        }
    },
    EBCI: {
        "24": {
            green: ["F101","F102","F103","F104","F105","F106","F107","F108","F109","F110","F111","F112","F114","F116","F117","F118","F119"],
            red: []
        },
        "06": {
            green: ["F101","F102","F103","F104","F105","F106","F107","F108","F109","F110","F111","F112","F119"],
            red:   ["F114","F116","F117","F118"]
        }
    }
};

// ---------------------------------------------------------------
// 4. Layer sonomètres
// ---------------------------------------------------------------
export const sonoLayer = L.layerGroup();

// ---------------------------------------------------------------
// 5. Affichage des sonomètres
// ---------------------------------------------------------------
export function renderSonometers(airport, runway) {

    sonoLayer.clearLayers();

    const list = airport === "EBLG" ? sonometersEBLG : sonometersEBCI;
    const rule = rules[airport][runway];

    list.forEach(s => {
        const lat = dmsToDecimal(s.latDMS);
        const lon = dmsToDecimal(s.lonDMS);

        const isGreen = rule.green.includes(s.id);
        const isRed   = rule.red.includes(s.id);

        const color = isGreen ? "green" : isRed ? "red" : "gray";

        const marker = L.circleMarker([lat, lon], {
            radius: 7,
            color,
            weight: 2,
            fillOpacity: 0.8
        });

        marker.bindPopup(`
            <b>${s.id}</b><br>
            ${s.address}<br>
            <i>${airport} piste ${runway}</i>
        `);

        sonoLayer.addLayer(marker);
    });

    sonoLayer.addTo(map);
}
