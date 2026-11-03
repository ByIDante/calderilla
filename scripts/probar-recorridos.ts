// Recorre con Playwright (el Chrome instalado) lo que hace la gente, comprobando los números en pantalla:
// apuntar cobros dos veces al mes y pagas extra, jugar con la Calculadora sin que cambien tus datos y, después,
// lo de revisar tus datos (avisos, traspasos, gastos compartidos, categorías, lo prudente, el IRPF) y aplicar
// una prueba de la Calculadora de verdad. Saca capturas de cada paso.
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

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** «Ya» → −1, «mayo de 2027» → su número de mes, «Más de 2 años» → infinito: para comparar cuándo llegas */
function cuando(texto: string | null): number {
  const limpio = (texto ?? "").trim();
  if (limpio === "Ya") return -1;
  const [mes, anio] = limpio.split(" de ");
  return MESES.includes(mes ?? "") ? Number(anio) * 12 + MESES.indexOf(mes!) : Infinity;
}

const cifra = async (pagina: Page, etiqueta: string) => euros(await pagina.locator("#calculadora-resultado .cifra", { hasText: etiqueta }).locator(".cifra-valor").textContent());
/** Fila de «Todas las cifras»: [ahora, con tu prueba] */
async function fila(pagina: Page, etiqueta: string): Promise<[number, number]> {
  const celdas = pagina.locator("#calculadora-resultado .tabla-comparada").first().locator("tr", { has: pagina.locator("td:first-child", { hasText: etiqueta }) }).first().locator("td");
  return [euros(await celdas.nth(1).textContent()), euros(await celdas.nth(2).textContent())];
}
/**
 * Espera a htmx: lo que se escribe pide los resultados 400 ms después y, mientras hay una petición en curso, htmx
 * marca su elemento con .htmx-request. Luego, un momento para que se coloque y se pinte (los gráficos).
 * (waitForLoadState("networkidle") no sirve: solo mira la carga de la página, no las peticiones de después.)
 */
async function esperarHtmx(pagina: Page) {
  await pagina.waitForTimeout(450);
  await pagina.waitForFunction(() => !document.querySelector(".htmx-request"), undefined, { timeout: 5000 });
  await pagina.waitForTimeout(80);
}

/**
 * Cambia campos de la Calculadora y espera a los resultados del último cambio: al pasar de un campo a otro, el
 * primero ya pide los suyos (evento change), así que se espera a que no quede ninguna petición pendiente.
 */
async function cambiar(pagina: Page, accion: () => Promise<void>) {
  const respuesta = pagina.waitForResponse((r) => r.url().includes("/calculadora"));
  await accion();
  await respuesta;
  await esperarHtmx(pagina);
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
  const restaurante = pagina.locator("tr", { hasText: "RESTAURANTE MARE" }).first();
  comprobar(/Con sus pagas extra: junio y diciembre/.test((await restaurante.textContent()) ?? ""), "encuentra el sueldo del restaurante con su paga extra de junio (y propone diciembre)");
  await restaurante.screenshot({ path: path.join(capturas, "3b-paga-extra-encontrada.png") });
  await restaurante.locator("input[name='ids']").check();
  await pagina.click("button:has-text('Añadir lo marcado')");
  await esperarHtmx(pagina);
  comprobar(/pagas extra apuntadas en 1 ingreso/.test((await pagina.textContent("main")) ?? ""), "al aceptarlo, avisa de que apunta sus pagas extra");
  await pagina.goto(`${base}/gastos`, { waitUntil: "networkidle" });
  comprobar(/1\.283,33/.test((await pagina.locator("tr", { hasText: "Restaurante mare" }).first().textContent()) ?? ""), "y «Al mes» las incluye: 1.100 € + 2 × 1.100 € ÷ 12 = 1.283,33 €");
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
  // Las cifras salen en euros redondeados: 116,67 € más puede verse como 116 o 117
  comprobar(Math.abs(sobraDespues - sobraAntes - 117) <= 1, `subir la nómina 100 € (con 14 pagas): sobran 117 € más (${sobraAntes} → ${sobraDespues})`);
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
  await esperarHtmx(pagina);
  comprobar(
    /Aún no has cambiado nada/.test((await pagina.textContent("#calculadora-resultado")) ?? "") && (await cifra(pagina, "Para ocio este mes")) === realOcio,
    "«Volver a mis números» deja todo como estaba",
  );
  comprobar(
    (await pagina.locator("form.calculadora-datos").count()) === 1 && (await pagina.inputValue(`#importe-${ids.nomina}`)) === "2150",
    "y vuelve a cargar la página entera: un solo formulario, con la nómina de verdad",
  );

  // Botones «¿Y si…?»: rellenan la prueba sobre lo que ya hay
  const [ingresosAntes] = await fila(pagina, "Ingresos al mes");
  await cambiar(pagina, () => pagina.click("button[value='sueldo']"));
  const [, ingresosSueldo] = await fila(pagina, "Ingresos al mes");
  // Un poco menos del 5 % en total: las pagas extra con importe propio («Beneficios») no suben con el sueldo
  const subida = ingresosSueldo / ingresosAntes - 1;
  comprobar(subida > 0.045 && subida <= 0.0505, `«Me suben el sueldo un 5 %»: ingresos de ${ingresosAntes} € a ${ingresosSueldo} € (+${(subida * 100).toFixed(2)} %)`);
  comprobar((await pagina.inputValue(`#importe-${ids.nomina}`)) === "2257,50", "y el campo de la nómina ya dice 2257,50");
  await cambiar(pagina, () => pagina.click("button[value='sin_ingresos']"));
  const sinIngresos = (await pagina.textContent("#calculadora-resultado")) ?? "";
  comprobar(/aguantarías unos [\d,]+ meses pagando solo lo esencial/.test(sinIngresos), "«Me quedo sin ingresos»: dice cuántos meses aguantas");
  comprobar(/Te quedarías sin dinero en las cuentas/.test(sinIngresos), "y en qué mes te quedarías sin dinero");
  await pagina.locator("#calculadora-resultado").screenshot({ path: path.join(capturas, `6-sin-ingresos-${tamano.nombre}.png`) });
  await pagina.click(".calculadora-datos a:has-text('Volver a mis números')");
  await esperarHtmx(pagina);

  // Adelantar 2.000 € del coche reduciendo plazo
  await cambiar(pagina, () => pagina.fill(`#adelantar-${ids.coche}`, "2000"));
  const adelanto = pagina.locator("#calculadora-resultado section", { has: pagina.locator("h2", { hasText: "Adelantar «Coche»" }) });
  const textoAdelanto = (await adelanto.textContent()) ?? "";
  const [, finNuevo, finAntes] = /Terminas\s*(\d\d\/\d\d\/\d{4})\s*antes\s*(\d\d\/\d\d\/\d{4})/.exec(textoAdelanto) ?? [];
  const fecha = (texto: string | undefined) => (texto ?? "").split("/").reverse().join("-");
  comprobar(/Te ahorras de intereses\s*[\d.]+,\d\d/.test(textoAdelanto) && fecha(finNuevo) < fecha(finAntes), `adelantar 2.000 € del coche: intereses ahorrados y acabas antes (${finNuevo}, antes ${finAntes})`);
  await adelanto.screenshot({ path: path.join(capturas, `7-adelantar-coche-${tamano.nombre}.png`) });
  await cambiar(pagina, () => pagina.fill(`#adelantar-${ids.coche}`, ""));

  // Proyección: empezando con las cuentas a cero, el fondo de emergencia tarda más; con más sueldo, ahorras más
  comprobar((await pagina.locator("#grafico-proyeccion[data-pintado]").count()) === 1, "la proyección a 2 años tiene su gráfico");
  await cambiar(pagina, () => pagina.fill("#campo-liquidez", "0"));
  const hito = pagina.locator("#cuando-llegas tr[data-hito='fondo'] td");
  const [fondoAhora, fondoPrueba] = [await hito.nth(1).textContent(), await hito.nth(2).textContent()];
  comprobar(cuando(fondoPrueba) > cuando(fondoAhora), `con las cuentas a cero, el fondo de emergencia llega más tarde («${fondoAhora}» → «${fondoPrueba}»)`);
  await cambiar(pagina, async () => {
    await pagina.fill("#campo-liquidez", "");
    await pagina.fill(`#importe-${ids.nomina}`, "4000");
  });
  const final = pagina.locator("#calculadora-resultado .grafico:has(#grafico-proyeccion) tbody tr").last().locator("td");
  const [finalAhora, finalPrueba] = [euros(await final.nth(1).textContent()), euros(await final.nth(2).textContent())];
  comprobar(finalPrueba > finalAhora, `con 4.000 € de nómina, a 2 años tendrías más ahorrado (${finalAhora} € → ${finalPrueba} €)`);
  comprobar((await pagina.locator("#grafico-proyeccion[data-pintado]").count()) === 1, "y el gráfico se vuelve a pintar con los números nuevos");
  await pagina.locator("#calculadora-resultado section", { has: pagina.locator("h2", { hasText: "En los próximos 2 años" }) }).screenshot({ path: path.join(capturas, `8-proyeccion-${tamano.nombre}.png`) });
  const anchoFinal = await pagina.evaluate(() => document.documentElement.scrollWidth);
  comprobar(anchoFinal <= tamano.ancho + 1, `con la proyección y el adelanto, la página no se sale de lado (${anchoFinal} px)`);

  await pagina.goto(`${base}/`, { waitUntil: "networkidle" });
  comprobar(euros(await frase.nth(0).textContent()) === realAhorro && euros(await frase.nth(1).textContent()) === realOcio, "el Resumen sigue igual");
  await pagina.goto(`${base}/ocio`, { waitUntil: "networkidle" });
  comprobar(euros(await pagina.locator(".cifra", { hasText: "Te queda para ocio" }).locator(".cifra-valor").textContent()) === realQueda, "Ocio sigue igual");
  comprobar(bd.leerMeta("sucio") === "0", "y no se ha guardado nada en tus datos");
  await contexto.close();
}

// ── 3. Revisar tus datos y aplicar una prueba de verdad (esto sí cambia los datos de ejemplo) ──
{
  const id = (concepto: string) => bd.uno<{ id: number }>("SELECT id FROM apuntes WHERE concepto = ? ORDER BY fecha DESC LIMIT 1", concepto)!.id;
  const ancho = (pagina: Page) => pagina.evaluate(() => document.documentElement.scrollWidth);

  // Antes de tocar nada, en el móvil: las tarjetas nuevas no se salen de lado
  console.log("\nLo nuevo en el móvil (390 px)");
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pagina = await contexto.newPage();
    for (const [ruta, nombre] of [
      ["/movimientos", "movimientos"],
      ["/gastos/detectar", "detectar"],
      [`/gastos/${ids.moto}`, "moto"],
      [`/gastos/${ids.traducciones}`, "traducciones"],
      ["/ajustes?bruto=30000#irpf", "irpf"],
      ["/anio", "anio"],
      ["/gastos/suscripciones", "suscripciones"],
      ["/movimientos?buscar=consum&todo=1", "buscar"],
      [`/calculadora/aplicar?importe_${ids.netflix}=17%2C99&quitar_${ids.clases}=1&liquidez=0`, "aplicar"],
    ] as const) {
      await pagina.goto(`${base}${ruta}`, { waitUntil: "networkidle" });
      const px = await ancho(pagina);
      comprobar(px <= 391, `${ruta} no se sale de lado (${px} px)`);
      await pagina.screenshot({ path: path.join(capturas, `9-${nombre}-movil.png`), fullPage: true });
    }
    // Movimientos en el móvil: cada uno en dos líneas, sin «Borrar» (está en su ficha), y lo secundario plegado
    await pagina.goto(`${base}/movimientos`, { waitUntil: "networkidle" });
    const filas = await pagina.evaluate(() => {
      const lista = [...document.querySelectorAll(".tabla-movimientos tbody tr")];
      const borrar = [...document.querySelectorAll(".tabla-movimientos .m-borrar")].some((x) => x.getBoundingClientRect().height > 0);
      return { media: lista.reduce((s, f) => s + f.getBoundingClientRect().height, 0) / lista.length, borrar };
    });
    comprobar(filas.media <= 90 && !filas.borrar, `en el móvil, cada movimiento ocupa unos ${Math.round(filas.media)} px, sin «Borrar» en la lista`);
    const plegadas = await pagina.evaluate(() => ["presupuesto", "compartidos"].map((id) => (document.getElementById(id) as HTMLDetailsElement | null)?.open));
    comprobar(plegadas[0] === false && plegadas[1] === true, "el presupuesto empieza plegado; los gastos compartidos, abiertos");
    await contexto.close();
  }

  console.log("\nRevisar tus datos (1366 px)");
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 900 } });
  const pagina = await contexto.newPage();
  const queda = async () => {
    await pagina.goto(`${base}/ocio`, { waitUntil: "networkidle" });
    return euros(await pagina.locator(".cifra", { hasText: "Te queda para ocio" }).locator(".cifra-valor").textContent());
  };

  await pagina.goto(`${base}/`, { waitUntil: "networkidle" });
  const resumen = (await pagina.textContent("main")) ?? "";
  comprobar(/toca la cuota final de «Moto»: 3\.000\s€/.test(resumen), "el Resumen avisa de la cuota final de la moto");
  comprobar(/En Compras llevas 90\s€ este mes: un 165 % más de lo que sueles gastar en todo un mes \(34\s€\)/.test(resumen), "y de que en Compras vas muy por encima de lo que sueles");
  comprobar(/«Traducciones» varía: .*lo prudente es 250\s€/.test(resumen), "y de que «Traducciones» varía (lo prudente, 250 €)");

  await pagina.goto(`${base}/gastos/${ids.moto}`, { waitUntil: "networkidle" });
  comprobar(/Cuota final \(la pagas, la refinancias o devuelves el vehículo\)\s*3\.000,00\s€ el 20\/12\/2026/.test((await pagina.textContent("main")) ?? ""), "la ficha de la moto enseña la cuota final y su fecha");
  await pagina.goto(`${base}/gastos`, { waitUntil: "networkidle" });
  comprobar(/y la cuota final de 3\.000,00\s€ el 20\/12\/2026/.test((await pagina.locator("tr", { has: pagina.locator("a:text-is('Moto')") }).textContent()) ?? ""), "y la lista, junto a su última cuota");
  await pagina.goto(`${base}/gastos/${ids.moto}`, { waitUntil: "networkidle" });
  await pagina.goto(`${base}/gastos/${ids.moto}/cuadro`, { waitUntil: "networkidle" });
  comprobar(/Final\s*20\/12\/2026\s*3\.000,00/.test((await pagina.locator("tr", { has: pagina.locator("td:text-is('Final')") }).textContent()) ?? ""), "y su cuadro de amortización la marca como «Final»");

  await pagina.goto(`${base}/gastos/${ids.traducciones}`, { waitUntil: "networkidle" });
  comprobar(/Lo prudente: 250,00\s€/.test((await pagina.textContent("main")) ?? ""), "la ficha de «Traducciones» calcula lo prudente: 250 €, el segundo mes más flojo");
  await pagina.click("button:has-text('Usar 250,00')");
  await pagina.waitForURL(/ok=/);
  comprobar(/cuenta ahora 250\s€/.test((await pagina.textContent("main")) ?? ""), "al usarlo, cuenta 250 € desde este mes");
  await pagina.goto(`${base}/gastos`, { waitUntil: "networkidle" });
  comprobar(!/«Traducciones» varía/.test((await pagina.textContent("main")) ?? ""), "y el aviso desaparece");

  const envio = id("Envío a mi cuenta · Laura;Gomez Ferrer");
  await pagina.goto(`${base}/gastos/detectar`, { waitUntil: "networkidle" });
  const traspasos = pagina.locator("section", { has: pagina.locator("h2", { hasText: "Lo que te pasas a cuentas tuyas" }) });
  comprobar(/Envío a mi cuenta/.test((await traspasos.textContent()) ?? ""), "«Buscar en mis movimientos» pregunta si el envío con tu nombre es un traspaso");
  await traspasos.screenshot({ path: path.join(capturas, "10-traspasos.png") });
  await pagina.check(`input[name='ids'][value='t${envio}']`);
  await pagina.click("button:has-text('Añadir lo marcado')");
  await esperarHtmx(pagina);
  comprobar(/1 traspaso a una cuenta tuya/.test((await pagina.textContent("main")) ?? ""), "al aceptarlo, lo cuenta como traspaso");
  comprobar(bd.uno<{ traspaso: number }>("SELECT traspaso FROM apuntes WHERE id = ?", envio)?.traspaso === 1, "y ya no es un gasto");

  const quedaAntes = await queda();
  await pagina.goto(`${base}/movimientos`, { waitUntil: "networkidle" });
  const compartidos = pagina.locator("#compartidos");
  comprobar(/RESTAURANTE LA PEPICA[\s\S]*te devolvieron 105,00\s€: cuenta 35,00\s€/.test((await compartidos.textContent()) ?? ""), "Movimientos propone juntar la cena con los 3 Bizums");
  await compartidos.screenshot({ path: path.join(capturas, "11-compartidos.png") });
  await compartidos.locator("button:has-text('Juntar')").click();
  await pagina.waitForURL(/ok=/);
  const cena = pagina.locator("tr", { has: pagina.locator("a:text-is('RESTAURANTE LA PEPICA')") });
  comprobar(/te devolvieron 105,00\s€: cuenta 35,00\s€/.test((await cena.textContent()) ?? ""), "en la lista, la cena cuenta solo tu parte");
  comprobar(/devolución de «RESTAURANTE LA PEPICA» \(no cuenta como ingreso\)/.test((await pagina.locator("tr", { hasText: "Marta;Ruiz" }).first().textContent()) ?? ""), "y cada Bizum dice que es su devolución");
  const quedaJuntos = await queda();
  comprobar(quedaJuntos - quedaAntes === 105, `y para ocio te quedan 105 € más (${quedaAntes} → ${quedaJuntos} €)`);
  const enOcio = (await pagina.locator("tr", { has: pagina.locator("td:text-is('RESTAURANTE LA PEPICA')") }).textContent()) ?? "";
  comprobar(/35,00\s€\s*pagaste 140,00\s€, te devolvieron 105,00\s€/.test(enOcio), "en la lista de Ocio, la cena enseña lo que cuenta: 35 €");

  await pagina.goto(`${base}/movimientos/${id("Bizum recibido · Nuria;Gil")}`, { waitUntil: "networkidle" });
  comprobar(/Es la devolución de RESTAURANTE LA PEPICA/.test((await pagina.textContent("#devoluciones")) ?? ""), "la ficha del Bizum dice de qué gasto es");
  await pagina.click("#devoluciones button:has-text('Separar de ese gasto')");
  await pagina.waitForURL(/ok=/);
  const quedaSeparado = await queda();
  comprobar(quedaJuntos - quedaSeparado === 35, `al separarlo, la cena vuelve a contar esos 35 € (${quedaJuntos} → ${quedaSeparado} €)`);
  comprobar(bd.uno("SELECT 1 FROM apuntes WHERE id = ?", id("Bizum recibido · Nuria;Gil")) !== undefined, "sin borrar nada");

  await pagina.goto(`${base}/movimientos`, { waitUntil: "networkidle" });
  const propuestas = pagina.locator("#categorias-propuestas");
  const textoPropuestas = (await propuestas.textContent()) ?? "";
  comprobar(/Fnac · 1 sin categoría[\s\S]*Compras[\s\S]*Si contiene «fnac» \(en pagos\)/.test(textoPropuestas), "propone «Compras» para la compra de Fnac sin categoría, con su regla para pagos");
  const medias = (await pagina.locator("#presupuesto").textContent()) ?? "";
  comprobar(/Frente a lo que sueles gastar[\s\S]*Compras\s*90\s€\s*34\s€\s*\+165 %/.test(medias), "el presupuesto compara cada categoría con lo que sueles gastar");
  await propuestas.screenshot({ path: path.join(capturas, "12-categorias.png") });
  await propuestas.locator("button:has-text('Poner las categorías marcadas')").click();
  await pagina.waitForURL(/ok=/);
  const fnac = id("COMPRA TARJ 4589 FNAC SAN AGUSTIN");
  comprobar(bd.uno<{ nombre: string }>("SELECT c.nombre FROM apuntes a JOIN categorias c ON c.id = a.categoria_id WHERE a.id = ?", fnac)?.nombre === "Compras", "al aceptarlo, la compra queda en «Compras»");
  comprobar(bd.uno<{ signo: string }>("SELECT signo FROM reglas_categoria WHERE patron = 'fnac'")?.signo === "gasto", "con una regla para las siguientes (solo pagos)");

  // Tu año en cifras: 2026 frente al octubre de 2025 que hay en los datos
  await pagina.goto(`${base}/`, { waitUntil: "networkidle" });
  await pagina.click("a:has-text('Tu 2026 en cifras')");
  await pagina.waitForURL(/\/anio\?anio=2026/);
  const anio = (await pagina.textContent("main")) ?? "";
  comprobar(/Entró[\s\S]*en octubre de 2025: 1\.900\s€/.test(anio) && /En qué se fue/.test(anio) && /Frente a 2025/.test(anio), "«Tu 2026 en cifras» compara con los mismos meses de 2025");
  // Se llega con htmx (hx-boost): el gráfico se pinta un momento después
  const pintado = await pagina.waitForSelector("#grafico-anio[data-pintado]", { timeout: 5000 }).then(() => true, () => false);
  comprobar(pintado, "con su gráfico mes a mes");
  await pagina.screenshot({ path: path.join(capturas, "15-anio.png"), fullPage: true });
  await pagina.click("a:has-text('← 2025')");
  await pagina.waitForURL(/anio=2025/);
  comprobar(/Antes de octubre de 2025 no hay movimientos/.test((await pagina.textContent("main")) ?? ""), "y 2025 empieza en el primer mes con movimientos");

  // Buscar en todos los meses
  await pagina.goto(`${base}/movimientos`, { waitUntil: "networkidle" });
  await pagina.fill("#campo-buscar", "consum");
  await pagina.check("#campo-todo");
  await pagina.click("button:has-text('Filtrar')");
  await pagina.waitForURL(/todo=1/);
  const busqueda = ((await pagina.textContent(".resumen-busqueda")) ?? "").replace(/\s+/g, " ");
  comprobar(/«consum» en todos los meses: 20 movimientos · salen 1\.060,00\s€/.test(busqueda), `buscar en todos los meses encuentra los 20 de Consum, con su total («${busqueda.trim()}»)`);
  comprobar((await pagina.locator(".tabla-movimientos td.m-fecha", { hasText: "/06/2026" }).count()) > 0, "también los de junio");

  // Tus suscripciones
  await pagina.goto(`${base}/gastos`, { waitUntil: "networkidle" });
  await pagina.click("a:has-text('Tus suscripciones')");
  await pagina.waitForURL(/\/gastos\/suscripciones/);
  const suscripciones = (await pagina.textContent("main")) ?? "";
  comprobar(/Netflix[\s\S]*Subió de 12,99\s€ a 13,99\s€ el 01\/03\/2026/.test(suscripciones), "«Tus suscripciones» enseña Netflix y su subida de marzo");
  comprobar(/HBO Max[\s\S]*69,90\s€\s*al año/.test(suscripciones), "y HBO Max, que se paga una vez al año");
  await pagina.screenshot({ path: path.join(capturas, "16-suscripciones.png"), fullPage: true });
  const alAnioAntes = euros(await pagina.locator(".cifra", { hasText: "Al año" }).locator(".cifra-valor").textContent());
  await pagina.locator("tr", { hasText: "Clases de yoga" }).locator("button:has-text('Es una suscripción')").click();
  await pagina.waitForURL(/ok=/);
  const alAnio = euros(await pagina.locator(".cifra", { hasText: "Al año" }).locator(".cifra-valor").textContent());
  comprobar(alAnio - alAnioAntes === 300, `al añadir las clases de yoga, 300 € más al año (${alAnioAntes} → ${alAnio} €)`);

  await pagina.goto(`${base}/ajustes?bruto=30000#irpf`, { waitUntil: "networkidle" });
  const irpf = pagina.locator("#irpf");
  // El perfil de ejemplo no dice comunidad: usa la escala estatal también para la parte autonómica
  comprobar(/IRPF al año\s*[\d.]+,\d\d\s€/.test((await irpf.textContent()) ?? ""), "con 30.000 € brutos, estima el IRPF del año");
  await irpf.screenshot({ path: path.join(capturas, "13-irpf.png") });
  const usar = irpf.locator("button:has-text('Usar')");
  const marginal = Number(/Usar ([\d,]+)/.exec((await usar.textContent()) ?? "")?.[1]?.replace(",", "."));
  comprobar(marginal > 25 && marginal < 35, `con un tipo marginal razonable (${marginal} %)`);
  await usar.click();
  await pagina.waitForURL(/ok=/);
  comprobar(Number(bd.uno<{ valor: string }>("SELECT valor FROM perfil WHERE clave = 'tipoMarginal'")?.valor) === marginal, "y «Usar» lo guarda en tu perfil");

  // La Calculadora: lo que apartas de verdad sale del ocio; y una prueba que se aplica
  await pagina.goto(`${base}/calculadora`, { waitUntil: "networkidle" });
  const [ahorroAntes] = await fila(pagina, "Toca ahorrar este mes");
  await cambiar(pagina, () => pagina.fill("#campo-ahorro_automatico", String(ahorroAntes + 200)));
  const ahorro = await fila(pagina, "Toca ahorrar este mes");
  const ocio = await fila(pagina, "Para ocio este mes");
  comprobar(ahorro[1] - ahorro[0] === 200 && ocio[0] - ocio[1] === 200, `si tu ahorro automático aparta 200 € más de lo que pide la regla, salen del ocio (${ocio[0]} → ${ocio[1]} €)`);
  await pagina.click(".calculadora-datos a:has-text('Volver a mis números')");
  await esperarHtmx(pagina);
  await cambiar(pagina, () => pagina.fill(`#importe-${ids.netflix}`, "17,99"));
  await pagina.click("#calculadora-resultado a:has-text('Aplicar estos cambios de verdad')");
  await pagina.waitForURL(/\/calculadora\/aplicar/);
  comprobar(/«Netflix»: de 13,99\s€ a 17,99\s€/.test((await pagina.textContent("#aplicar")) ?? ""), "«Aplicar estos cambios de verdad» enseña el cambio antes de guardarlo");
  await pagina.screenshot({ path: path.join(capturas, "14-aplicar.png"), fullPage: true });
  await pagina.click("button:has-text('Aplicar lo marcado')");
  await pagina.waitForURL(/ok=/);
  comprobar(/1 cambio aplicado/.test((await pagina.textContent("main")) ?? ""), "al confirmarlo, avisa de que lo ha aplicado");
  await pagina.goto(`${base}/gastos`, { waitUntil: "networkidle" });
  comprobar(/17,99/.test((await pagina.locator("tr", { hasText: "Netflix" }).first().textContent()) ?? ""), "y Netflix cuenta 17,99 € desde hoy");
  await contexto.close();
}

await navegador.close();
cerrar();
console.log(`\n${fallos.length ? `${fallos.length} fallos:\n${fallos.map((f) => `  · ${f}`).join("\n")}` : "Todo bien"} · capturas en ${capturas}`);
process.exitCode = fallos.length ? 1 : 0;
