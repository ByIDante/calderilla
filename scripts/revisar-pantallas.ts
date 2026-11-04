// Revisa todas las pantallas de Calderilla con Playwright (usa el Chrome instalado) en varios tamaños, de
// móvil a monitor grande, y también en modo oscuro: busca desplazamiento lateral, cosas que se salen de su
// tarjeta, textos que bajan de línea antes de tiempo, tablas que necesitan desplazarse, controles pequeños en
// el móvil y texto que casi no se lee contra su fondo. Saca capturas.
//
//   npm run revisar-pantallas [-- carpeta-de-capturas]
//
// Trabaja con datos de ejemplo en una carpeta temporal: no toca tus datos.
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { arrancarEjemplo } from "./ejemplo.ts";
import { revisar } from "./revision.ts";

const capturas = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "calderilla-capturas"));
mkdirSync(capturas, { recursive: true });
const { base, bd, ids, cerrar } = await arrancarEjemplo(5190);
const { coche, moto, fondo, nomina, netflix, clases, traducciones } = ids;
// La cena compartida y uno de sus Bizums (sus fichas enseñan «¿Te devolvieron parte?»)
const apunte = (concepto: string) => bd.uno<{ id: number }>("SELECT id FROM apuntes WHERE concepto = ?", concepto)!.id;

const PAGINAS = [
  "/",
  "/?mes=2026-09",
  "/anio",
  "/anio?anio=2025",
  "/gastos",
  "/gastos/detectar",
  "/gastos/suscripciones",
  "/gastos/nuevo",
  "/gastos/nuevo?tipo=ingreso",
  `/gastos/${coche}`,
  `/gastos/${nomina}`,
  `/gastos/${coche}/cuadro`,
  `/gastos/${moto}`,
  `/gastos/${moto}/cuadro`,
  `/gastos/${traducciones}`,
  "/ocio",
  "/ocio?mes=2026-09",
  "/movimientos",
  "/movimientos?buscar=consum&todo=1",
  "/movimientos/1",
  `/movimientos/${apunte("RESTAURANTE LA PEPICA")}`,
  `/movimientos/${apunte("Bizum recibido · Marta;Ruiz")}`,
  "/cuentas",
  "/cierre",
  "/inversiones",
  `/activos/${fondo}`,
  "/metas",
  "/calculadora",
  `/calculadora/aplicar?importe_${netflix}=17%2C99&quitar_${clases}=1&liquidez=0`,
  "/ajustes",
  "/ajustes?bruto=30000",
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
// En modo oscuro basta con un tamaño estrecho y uno ancho: lo que cambia son los colores, no la colocación
const PASADAS = [
  ...TAMANOS.map((tamano) => ({ ...tamano, oscuro: false })),
  ...TAMANOS.filter((tamano) => ["movil", "portatil"].includes(tamano.nombre)).map((tamano) => ({ ...tamano, oscuro: true })),
];
// Capturas de las pantallas principales (todas las páginas en todos los tamaños serían demasiadas)
const CON_CAPTURA = new Set(["/", "/anio", "/ocio", "/movimientos", "/cuentas", "/inversiones", "/gastos", "/gastos/detectar", "/calculadora", `/gastos/${nomina}`, "/ajustes"]);

const navegador = await chromium.launch({ channel: "chrome" });
let total = 0;
for (const tamano of PASADAS) {
  const contexto = await navegador.newContext({
    viewport: { width: tamano.ancho, height: tamano.alto },
    isMobile: tamano.ancho < 600,
    hasTouch: tamano.ancho < 600,
    colorScheme: tamano.oscuro ? "dark" : "light",
  });
  const prefijo = tamano.oscuro ? "oscuro-" : "";
  const pagina = await contexto.newPage();
  for (const ruta of PAGINAS) {
    await pagina.goto(base + ruta, { waitUntil: "networkidle" });
    const problemas = await pagina.evaluate(revisar);
    if (problemas.length) {
      total += problemas.length;
      console.log(`\n[${prefijo}${tamano.nombre} ${tamano.ancho}px] ${ruta}`);
      for (const problema of problemas.slice(0, 8)) console.log(`  · ${problema}`);
    }
    if (CON_CAPTURA.has(ruta)) {
      const nombre = `${prefijo}${tamano.nombre}-${ruta === "/" ? "resumen" : ruta.slice(1).replace(/\W+/g, "-")}.png`;
      await pagina.screenshot({ path: path.join(capturas, nombre), fullPage: true });
    }
  }
  await contexto.close();
}
await navegador.close();
cerrar();
console.log(`\n${total ? `${total} problemas` : "Sin problemas"} · capturas en ${capturas}`);
