// Revisa todas las pantallas de Calderilla con Playwright (usa el Chrome instalado) en varios tamaños, de
// móvil a monitor grande: busca desplazamiento lateral, cosas que se salen de su tarjeta, textos que bajan de
// línea antes de tiempo, tablas que necesitan desplazarse y controles pequeños en el móvil. Saca capturas.
//
//   npm run revisar-pantallas [-- carpeta-de-capturas]
//
// Trabaja con datos de ejemplo en una carpeta temporal: no toca tus datos.
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { arrancarEjemplo } from "./ejemplo.ts";

const capturas = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "calderilla-capturas"));
mkdirSync(capturas, { recursive: true });
const { base, ids, cerrar } = await arrancarEjemplo(5190);
const { coche, fondo, nomina } = ids;

const PAGINAS = [
  "/",
  "/?mes=2026-09",
  "/gastos",
  "/gastos/detectar",
  "/gastos/nuevo",
  "/gastos/nuevo?tipo=ingreso",
  `/gastos/${coche}`,
  `/gastos/${nomina}`,
  `/gastos/${coche}/cuadro`,
  "/ocio",
  "/movimientos",
  "/movimientos/1",
  "/cuentas",
  "/cierre",
  "/inversiones",
  `/activos/${fondo}`,
  "/metas",
  "/calculadora",
  "/ajustes",
  "/ajustes/mercado",
  "/ajustes/parametros",
  "/ajustes/cuestionario",
  "/ajustes/copias",
  "/importar",
  "/bancos",
];
const TAMANOS = [
  { nombre: "movil", ancho: 390, alto: 844 },
  { nombre: "tablet", ancho: 820, alto: 1180 },
  { nombre: "portatil", ancho: 1366, alto: 768 },
  { nombre: "completa", ancho: 1920, alto: 1080 },
  { nombre: "grande", ancho: 2560, alto: 1440 },
];
// Capturas de las pantallas principales (todas las páginas en todos los tamaños serían demasiadas)
const CON_CAPTURA = new Set(["/", "/ocio", "/movimientos", "/cuentas", "/inversiones", "/gastos", "/gastos/detectar", "/calculadora", `/gastos/${nomina}`, "/ajustes"]);

function revisar() {
  const problemas: string[] = [];
  const ancho = window.innerWidth;
  if (document.documentElement.scrollWidth > ancho + 1) problemas.push(`la página se desplaza en horizontal (${document.documentElement.scrollWidth} px de ${ancho})`);
  for (const caja of document.querySelectorAll(".tarjeta, .opcion, .cifra, .aviso, .version, fieldset")) {
    const limite = caja.getBoundingClientRect();
    for (const el of caja.querySelectorAll("*")) {
      if (el.closest(".tabla-contenedor") || (el.closest("details:not([open])") && !el.closest("summary"))) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > limite.right + 2) {
        problemas.push(`se sale de su tarjeta: <${el.tagName.toLowerCase()}> «${(el.textContent ?? "").trim().slice(0, 40)}» (+${Math.round(r.right - limite.right)} px)`);
        break;
      }
    }
  }
  for (const p of document.querySelectorAll("main p")) {
    const padre = p.parentElement!.getBoundingClientRect();
    const r = p.getBoundingClientRect();
    const linea = parseFloat(getComputedStyle(p).lineHeight) || 22;
    if (padre.width > 500 && r.height > linea * 1.5 && r.width < padre.width * 0.85) {
      problemas.push(`texto que baja de línea antes de tiempo: «${(p.textContent ?? "").trim().slice(0, 50)}» (${Math.round(r.width)} de ${Math.round(padre.width)} px)`);
    }
  }
  // En pantallas estrechas el menú se desliza: la sección actual tiene que verse sin tocarlo
  const actual = document.querySelector('.menu a[aria-current="page"]');
  const fila = actual?.closest("ul");
  if (actual && fila && getComputedStyle(fila).display === "flex") {
    const r = actual.getBoundingClientRect();
    const caja = fila.getBoundingClientRect();
    if (r.left < caja.left - 1 || r.right > caja.right - 20) problemas.push(`la sección actual («${actual.textContent?.trim()}») queda fuera del menú`);
  }
  // Las marcadas como desplazables (p. ej. el cuadro de amortización) se desplazan a propósito
  for (const t of document.querySelectorAll(".tabla-contenedor:not(.desplazable)")) {
    if (t.scrollWidth > t.clientWidth + 2) problemas.push(`tabla que hay que desplazar de lado (${t.scrollWidth} px en ${t.clientWidth})`);
  }
  if (ancho < 600) {
    // Las casillas y opciones se pulsan también por su texto (la etiqueta), así que no cuentan
    const pequenos = [...document.querySelectorAll("main a, main button, main select, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main summary")].filter((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height < 31 && !x.closest("p, li, td div, .apagado");
    });
    if (pequenos.length) problemas.push(`${pequenos.length} controles de menos de 32 px de alto (difíciles de pulsar con el dedo)`);
  }
  return [...new Set(problemas)];
}

const navegador = await chromium.launch({ channel: "chrome" });
let total = 0;
for (const tamano of TAMANOS) {
  const contexto = await navegador.newContext({ viewport: { width: tamano.ancho, height: tamano.alto }, isMobile: tamano.ancho < 600, hasTouch: tamano.ancho < 600 });
  const pagina = await contexto.newPage();
  for (const ruta of PAGINAS) {
    await pagina.goto(base + ruta, { waitUntil: "networkidle" });
    const problemas = await pagina.evaluate(revisar);
    if (problemas.length) {
      total += problemas.length;
      console.log(`\n[${tamano.nombre} ${tamano.ancho}px] ${ruta}`);
      for (const problema of problemas.slice(0, 8)) console.log(`  · ${problema}`);
    }
    if (CON_CAPTURA.has(ruta)) {
      const nombre = `${tamano.nombre}-${ruta === "/" ? "resumen" : ruta.slice(1).replace(/\W+/g, "-")}.png`;
      await pagina.screenshot({ path: path.join(capturas, nombre), fullPage: true });
    }
  }
  await contexto.close();
}
await navegador.close();
cerrar();
console.log(`\n${total ? `${total} problemas` : "Sin problemas"} · capturas en ${capturas}`);
