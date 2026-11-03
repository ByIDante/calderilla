// Los iconos PNG de la prueba, dibujados una vez con el Chrome del sistema a partir de icono.svg
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const svg = readFileSync(path.join(import.meta.dirname, "../src/estatico/icono.svg"), "utf8");
const navegador = await chromium.launch({ channel: "chrome" });
for (const lado of [180, 192, 512]) {
  const pagina = await navegador.newPage({ viewport: { width: lado, height: lado } });
  // Fondo lleno (iOS pone negro lo transparente) y margen para la máscara redonda de Android
  await pagina.setContent(`<body style="margin:0;background:#f6f4ef;display:grid;place-items:center;width:${lado}px;height:${lado}px">
    <div style="width:${Math.round(lado * 0.72)}px;height:${Math.round(lado * 0.72)}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body>`);
  await pagina.screenshot({ path: path.join(import.meta.dirname, "estatico", `icono-${lado}.png`) });
  await pagina.close();
}
await navegador.close();
