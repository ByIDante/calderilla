// Recorre con Playwright (el Chrome instalado) lo que hace la gente, comprobando los números en pantalla:
// apuntar cobros dos veces al mes y pagas extra, y jugar con la Calculadora sin que cambien tus datos.
// Saca capturas de cada paso.
//
//   npm run probar-recorridos [-- carpeta-de-capturas]
//
// Trabaja con datos de ejemplo en una carpeta temporal: no toca tus datos.
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { arrancarEjemplo } from "./ejemplo.ts";

const capturas = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "calderilla-recorridos"));
mkdirSync(capturas, { recursive: true });
const { base, bd, ids, cerrar } = await arrancarEjemplo(5193);

const fallos: string[] = [];
function comprobar(cierto: boolean, texto: string) {
  console.log(`  ${cierto ? "✓" : "✗"} ${texto}`);
  if (!cierto) fallos.push(texto);
}

/** «1.278 €», «−14 €» → euros */
function euros(texto: string | null): number {
  const limpio = (texto ?? "").replace(/[−–]/g, "-").replace(/[^\d,-]/g, "").replace(",", ".");
  return Number(limpio);
}

/** Espera (hasta 5 s) a que un elemento tenga un texto: los resultados llegan por htmx tras 400 ms */
async function esperarTexto(pagina: Page, selector: string, buscado: RegExp): Promise<boolean> {
  try {
    await pagina.waitForFunction(
      ([sel, fuente, banderas]) => new RegExp(fuente!, banderas).test(document.querySelector(sel!)?.textContent ?? ""),
      [selector, buscado.source, buscado.flags],
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

const cifra = async (pagina: Page, etiqueta: string) => euros(await pagina.locator("#calculadora-resultado .cifra", { hasText: etiqueta }).locator(".cifra-valor").textContent());
/** Fila de «Todas las cifras»: [ahora, con tu prueba] */
async function fila(pagina: Page, etiqueta: string): Promise<[number, number]> {
  const celdas = pagina.locator("#calculadora-resultado .tabla-comparada").first().locator("tr", { has: pagina.locator("td:first-child", { hasText: etiqueta }) }).first().locator("td");
  return [euros(await celdas.nth(1).textContent()), euros(await celdas.nth(2).textContent())];
}
/**
 * Cambia campos de la Calculadora y espera a los resultados del último cambio: al pasar de un campo a otro, el
 * primero ya pide los suyos (evento change), así que se espera a que no quede ninguna petición pendiente.
 */
async function cambiar(pagina: Page, accion: () => Promise<void>) {
  const respuesta = pagina.waitForResponse((r) => r.url().includes("/calculadora/resultado"));
  await accion();
  await respuesta;
  await pagina.waitForTimeout(450);
  await pagina.waitForLoadState("networkidle");
}

const navegador = await chromium.launch({ channel: "chrome" });

// ── 1. Apuntar cobros dos veces al mes y pagas extra ──
{
  console.log("\nIngresos y gastos (1366 px)");
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 900 } });
  const pagina = await contexto.newPage();

  await pagina.goto(`${base}/gastos/nuevo?tipo=ingreso`, { waitUntil: "networkidle" });
  await pagina.fill("#campo-nombre", "Nómina quincenal");
  await pagina.fill("#campo-importe", "800");
  await pagina.selectOption("#campo-frecuencia", "quincenal");
  await pagina.fill("#campo-inicio", "2026-01-01");
  comprobar(await pagina.locator("text=El segundo llega 15 días después").isVisible(), "explica cuándo llega el segundo cobro");
  comprobar(await esperarTexto(pagina, "#cuenta-al-mes", /1\.600\s€ al mes/), "800 € dos veces al mes: «cuenta como 1600 € al mes» mientras escribes");
  await pagina.click("button:has-text('Guardar')");
  await pagina.waitForURL(/\/gastos(\?|$)/);
  const quincenal = pagina.locator("tr", { hasText: "Nómina quincenal" }).first();
  comprobar(/1\.600,00/.test((await quincenal.textContent()) ?? ""), "en la lista, «Al mes» 1600 €");

  await pagina.goto(`${base}/gastos/nuevo?tipo=ingreso`, { waitUntil: "networkidle" });
  await pagina.fill("#campo-nombre", "Nómina de 14 pagas");
  await pagina.fill("#campo-importe", "1500");
  await pagina.fill("#campo-inicio", "2024-01-28");
  comprobar(!(await pagina.locator("#campo-paga_cuando_1").isVisible()), "las pagas extra no se ven hasta decir que sí");
  await pagina.selectOption("#campo-pagas", "1");
  comprobar(await esperarTexto(pagina, "#cuenta-al-mes", /1\.750\s€ al mes.*2 pagas extra/), "junio y diciembre: 1750 € al mes");
  await pagina.selectOption("#campo-paga_cuando_1", "bimestral");
  comprobar(await esperarTexto(pagina, "#cuenta-al-mes", /2\.250\s€ al mes/), "una cada 2 meses: 2250 € al mes");
  await pagina.selectOption("#campo-paga_cuando_1", "jun-dic");
  await pagina.check("#campo-paga_otra_2");
  await pagina.selectOption("#campo-paga_cuando_2", "elegir");
  await pagina.check("input[name='paga_meses_2'][value='3']");
  await pagina.fill("#campo-paga_importe_2", "800");
  await pagina.fill("#campo-paga_nombre_2", "Beneficios");
  comprobar(await esperarTexto(pagina, "#cuenta-al-mes", /1\.817\s€ al mes/), "y otra de 800 € en marzo: 1817 € al mes");
  await pagina.screenshot({ path: path.join(capturas, "1-pagas-extra-formulario.png"), fullPage: true });
  await pagina.click("button:has-text('Guardar')");
  await pagina.waitForURL(/\/gastos(\?|$)/);
  comprobar(/1\.816,67/.test((await pagina.locator("tr", { hasText: "Nómina de 14 pagas" }).first().textContent()) ?? ""), "en la lista, «Al mes» 1816,67 €");
  const junio = (await pagina.locator("#ingresos-mes-a-mes tr", { hasText: "junio de 2027" }).last().textContent()) ?? "";
  comprobar(/Paga extra de Nómina de 14 pagas/.test(junio), "«Tus ingresos mes a mes» marca la paga extra de junio");
  await pagina.locator("#ingresos-mes-a-mes").screenshot({ path: path.join(capturas, "2-ingresos-mes-a-mes.png") });

  await pagina.click("a:text-is('Nómina de 14 pagas')");
  await pagina.waitForURL(/\/gastos\/\d+$/);
  const desglose = (await pagina.locator("section", { hasText: "Cómo cuenta en tu presupuesto" }).textContent()) ?? "";
  comprobar(/21\.800,00/.test(desglose) && /Beneficios/.test(desglose), "la ficha desglosa el año: 21.800 € con la paga «Beneficios»");
  await pagina.locator("section", { hasText: "Cómo cuenta en tu presupuesto" }).screenshot({ path: path.join(capturas, "3-desglose-ficha.png") });

  await pagina.goto(`${base}/gastos/detectar`, { waitUntil: "networkidle" });
  comprobar(/Eventos levante[\s\S]*Cada 2 semanas/i.test((await pagina.textContent("main")) ?? ""), "en los movimientos encuentra el cobro cada 2 semanas");
  await contexto.close();
}

// ── 2. Calculadora: jugar con los números sin cambiar nada de verdad ──
for (const tamano of [
  { nombre: "portatil", ancho: 1366, alto: 900 },
  { nombre: "movil", ancho: 390, alto: 844 },
]) {
  console.log(`\nCalculadora (${tamano.ancho} px)`);
  bd.escribirMeta("sucio", "0");
  const contexto = await navegador.newContext({ viewport: { width: tamano.ancho, height: tamano.alto }, isMobile: tamano.ancho < 600, hasTouch: tamano.ancho < 600 });
  const pagina = await contexto.newPage();

  await pagina.goto(`${base}/`, { waitUntil: "networkidle" });
  const frase = pagina.locator(".frase-mes b");
  const realAhorro = euros(await frase.nth(0).textContent());
  const realOcio = euros(await frase.nth(1).textContent());
  await pagina.goto(`${base}/ocio`, { waitUntil: "networkidle" });
  const realQueda = euros(await pagina.locator(".cifra", { hasText: "Te queda para ocio" }).locator(".cifra-valor").textContent());

  await pagina.goto(`${base}/calculadora`, { waitUntil: "networkidle" });
  comprobar(await pagina.locator("text=Solo para probar").isVisible(), "avisa de que es solo para probar");
  comprobar((await cifra(pagina, "Para ocio este mes")) === realOcio && (await cifra(pagina, "Toca ahorrar")) === realAhorro, `sin cambios, lo mismo que el Resumen (ocio ${realOcio} €, ahorro ${realAhorro} €)`);
  comprobar((await fila(pagina, "Te queda para ocio"))[1] === realQueda, `y lo mismo que Ocio (te quedan ${realQueda} €)`);
  if (tamano.ancho < 600) comprobar(await pagina.locator(".calculadora-flotante").isVisible(), "en el móvil, la barra de abajo enseña ocio y ahorro");

  const [sobraAntes] = await fila(pagina, "Te sobra al mes");
  await cambiar(pagina, () => pagina.fill(`#importe-${ids.nomina}`, "2250"));
  const [, sobraDespues] = await fila(pagina, "Te sobra al mes");
  comprobar(sobraDespues - sobraAntes === 117, `subir la nómina 100 € (con 14 pagas): sobran 117 € más (${sobraAntes} → ${sobraDespues})`);
  const ahorro = await fila(pagina, "Toca ahorrar este mes");
  const ocio = await fila(pagina, "Para ocio este mes");
  comprobar(Math.abs(ahorro[1] - ahorro[0] + (ocio[1] - ocio[0]) - 117) <= 1, `y se reparten entre ahorro (+${ahorro[1] - ahorro[0]}) y ocio (+${ocio[1] - ocio[0]})`);
  comprobar(/2\.625\s€ al mes/.test((await pagina.textContent(`#al-mes-${ids.nomina}`)) ?? ""), "al lado de la nómina: «= 2625 € al mes»");
  comprobar(/Con 1 cambio/.test((await pagina.textContent("#calculadora-resultado")) ?? ""), "cuenta los cambios");
  if (tamano.ancho < 600) comprobar(/▲/.test((await pagina.textContent(".calculadora-flotante")) ?? ""), "la barra de abajo enseña que sube");

  const [gastosAntes] = await fila(pagina, "Gastos al mes");
  await cambiar(pagina, () => pagina.check(`input[name='quitar_${ids.netflix}']`));
  comprobar(gastosAntes - (await fila(pagina, "Gastos al mes"))[1] === 14, "quitar Netflix: 14 € menos de gastos");
  await cambiar(pagina, async () => {
    await pagina.fill("#campo-nuevo_nombre_1", "Gimnasio");
    await pagina.fill("#campo-nuevo_importe_1", "40");
  });
  comprobar((await fila(pagina, "Gastos al mes"))[1] === gastosAntes - 14 + 40, "añadir un gimnasio de 40 €: 40 € más");

  const [metasAntes] = await fila(pagina, "De eso, para tus metas");
  await cambiar(pagina, async () => {
    await pagina.fill("#campo-meta_nueva_nombre", "Coche");
    await pagina.fill("#campo-meta_nueva_objetivo", "1200");
    await pagina.fill("#campo-meta_nueva_fecha", "2027-10-30");
  });
  comprobar((await fila(pagina, "De eso, para tus metas"))[1] - metasAntes >= 100, "una meta de 1.200 € en un año: unos 100 € más al mes para metas");

  const ocioAntesRegla = (await fila(pagina, "Para ocio este mes"))[1];
  await pagina.click("summary:has-text('Las reglas')");
  const regla = pagina.locator(".reglas-prueba .campo", { hasText: "(tu etapa)" }).locator("input");
  await cambiar(pagina, () => regla.fill("100"));
  const ocioMinimo = (await fila(pagina, "Ocio mínimo"))[1];
  const ocioRegla = (await fila(pagina, "Para ocio este mes"))[1];
  comprobar(ocioRegla <= ocioAntesRegla && ocioRegla >= ocioMinimo, `ahorrar 100 de cada 100 €: el ocio baja al mínimo (${ocioAntesRegla} → ${ocioRegla} €, mínimo ${ocioMinimo} €)`);
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth);
  comprobar(ancho <= tamano.ancho + 1, `con los cambios hechos, la página no se sale de lado (${ancho} px de ${tamano.ancho})`);
  await pagina.screenshot({ path: path.join(capturas, `4-calculadora-con-cambios-${tamano.nombre}.png`) });
  await pagina.locator("#calculadora-resultado").screenshot({ path: path.join(capturas, `5-calculadora-resultado-${tamano.nombre}.png`) });

  await pagina.click(".calculadora-datos a:has-text('Volver a mis números')");
  await pagina.waitForLoadState("networkidle");
  comprobar(
    /Aún no has cambiado nada/.test((await pagina.textContent("#calculadora-resultado")) ?? "") && (await cifra(pagina, "Para ocio este mes")) === realOcio,
    "«Volver a mis números» deja todo como estaba",
  );

  await pagina.goto(`${base}/`, { waitUntil: "networkidle" });
  comprobar(euros(await frase.nth(0).textContent()) === realAhorro && euros(await frase.nth(1).textContent()) === realOcio, "el Resumen sigue igual");
  await pagina.goto(`${base}/ocio`, { waitUntil: "networkidle" });
  comprobar(euros(await pagina.locator(".cifra", { hasText: "Te queda para ocio" }).locator(".cifra-valor").textContent()) === realQueda, "Ocio sigue igual");
  comprobar(bd.leerMeta("sucio") === "0", "y no se ha guardado nada en tus datos");
  await contexto.close();
}

await navegador.close();
cerrar();
console.log(`\n${fallos.length ? `${fallos.length} fallos:\n${fallos.map((f) => `  · ${f}`).join("\n")}` : "Todo bien"} · capturas en ${capturas}`);
process.exitCode = fallos.length ? 1 : 0;
