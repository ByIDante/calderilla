// Revisa todas las pantallas de Calderilla con Playwright (usa el Chrome instalado) en varios tamaños, de
// móvil a monitor grande: busca desplazamiento lateral, cosas que se salen de su tarjeta, textos que bajan de
// línea antes de tiempo, tablas que necesitan desplazarse y controles pequeños en el móvil. Saca capturas.
//
//   npm run revisar-pantallas [-- carpeta-de-capturas]
//
// Trabaja con datos de ejemplo en una carpeta temporal: no toca tus datos.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { chromium } from "playwright-core";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-pantallas-"));
process.env.CALDERILLA_CONFIG_DIR = carpeta;
const capturas = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "calderilla-capturas"));
mkdirSync(capturas, { recursive: true });

const { Sincronizador } = await import("../src/datos/sync.ts");
const { crearApp } = await import("../src/servidor/app.ts");
const { prepararBase } = await import("../src/servicios/semillas.ts");
const { crearRecurrente } = await import("../src/servicios/finanzas.ts");
const { guardarSaldo } = await import("../src/servicios/cuentas.ts");
const { guardarPerfil } = await import("../src/servicios/configuracion.ts");

const PUERTO = 5190;
const HOY = "2026-10-30";
const estado = {
  ajustes: { carpetaDatos: path.join(carpeta, "datos"), equipoId: "aaaaaaaa", equipoNombre: "Revisión", puerto: PUERTO, abrirNavegador: false, coingeckoClave: null },
  sync: null as InstanceType<typeof Sincronizador> | null,
  token: "revision",
  hoy: () => HOY,
  errorFatal: null,
  usarCarpeta: () => {},
  guardarAjustes: () => {},
};
estado.sync = new Sincronizador({ carpetaDatos: estado.ajustes.carpetaDatos, rutaTrabajo: path.join(carpeta, "trabajo.db"), equipoId: "aaaaaaaa", equipoNombre: "Revisión", alAbrir: prepararBase });
const bd = estado.sync.bd;

// ── Datos de ejemplo: lo justo para que cada pantalla tenga de todo, con textos largos y cortos ──
const cat = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
const fijo = { fin: null, esencial: true, clase: "fijo" as const, nota: null, prestamo: null };
guardarPerfil(bd, { estabilidad: "normal", riesgo: "moderado", tipoMarginal: 30, tipoRescate: 21, aportacionEmpresa: 0 });
crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", categoriaId: cat("Nómina"), frecuencia: "mensual", inicio: "2024-01-28", importe: 215000 });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Alquiler", categoriaId: cat("Vivienda"), frecuencia: "mensual", inicio: "2024-01-01", importe: 75000 });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Luz y gas", categoriaId: cat("Suministros"), frecuencia: "mensual", inicio: "2024-01-10", importe: 6500 });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Comida", categoriaId: cat("Alimentación"), frecuencia: "mensual", inicio: "2024-01-01", importe: 32000, clase: "estimacion" });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Seguro de hogar multirriesgo con cobertura ampliada", categoriaId: cat("Seguros"), frecuencia: "anual", inicio: "2027-02-01", importe: 41235 });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Netflix", categoriaId: cat("Suscripciones"), frecuencia: "mensual", inicio: "2024-01-01", importe: 1399, esencial: false });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Gimnasio", categoriaId: cat("Ocio"), frecuencia: "mensual", inicio: "2025-01-10", fin: "2026-09-10", importe: 3900, esencial: false });
const coche = crearRecurrente(bd, {
  ...fijo,
  tipo: "gasto",
  nombre: "Coche",
  categoriaId: cat("Transporte"),
  frecuencia: "mensual",
  inicio: "2024-03-05",
  importe: 0,
  prestamo: { capital: 1_500_000, tin: 5.5, tae: null, plazoMeses: 60, comisionAmortizacion: 0.5, vinculado: true },
});
const cuenta = (nombre: string, tipo: string, entidad: string | null, saldo: number, tae: number | null = null) => {
  const id = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad, tae) VALUES (?, ?, ?, ?)", nombre, tipo, entidad, tae).id;
  guardarSaldo(bd, id, "2026-10-01", saldo);
  return id;
};
const nomina = cuenta("Nómina", "corriente", "BBVA", 234000);
const ahorro = cuenta("Ahorro", "remunerada", "Trade Republic", 620000, 2.25);
const viaje = cuenta("Cuenta remunerada para el viaje y el fondo de emergencia", "remunerada", "Openbank", 300000, 3.25);
cuenta("Plan de pensiones", "plan_pensiones", "Indexa Capital", 450000);
const gastos: [string, number, string, number | null, string | null][] = [
  ["2026-10-02", -5430, "COMPRA MERCADONA VALENCIA AV DEL PUERTO", nomina, "Alimentación"],
  ["2026-10-05", -2800, "GLOVO", nomina, "Restaurantes"],
  ["2026-10-09", -1500, "CINESA DIAGONAL", nomina, "Ocio"],
  ["2026-10-12", -8999, "AMAZON MARKETPLACE EU SARL PAGO CON TARJETA 4589", ahorro, "Compras"],
  ["2026-10-15", -4200, "REPSOL ESTACION DE SERVICIO", nomina, "Transporte"],
  ["2026-10-18", -350, "BIZUM A JUAN", null, null],
  ["2026-10-28", 215000, "NOMINA OCTUBRE EMPRESA SL", nomina, "Nómina"],
  ["2026-09-03", -6120, "MERCADONA", nomina, "Alimentación"],
  ["2026-09-14", -4500, "RESTAURANTE CASA PEPE", nomina, "Restaurantes"],
  ["2026-09-20", -3000, "TICKETMASTER ENTRADAS CONCIERTO", viaje, "Ocio"],
  ["2026-08-10", -5800, "LIDL", nomina, "Alimentación"],
  ["2026-08-22", -12000, "RYANAIR", nomina, "Viajes"],
];
for (const [fecha, importe, concepto, cuentaId, categoria] of gastos) {
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, cuenta_id, categoria_id) VALUES (?, ?, ?, ?, ?)", fecha, importe, concepto, cuentaId, categoria ? cat(categoria) : null);
}
const fondo = bd.ejecutar("INSERT INTO activos (nombre, isin, tipo, renta) VALUES ('Fondo indexado mundial', 'IE00B03HCZ61', 'fondo', 'variable')").id;
bd.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, '2026-01-15', 'compra', 50, 150000)", fondo);
bd.ejecutar("INSERT INTO precios (activo_id, fecha, precio, fuente) VALUES (?, '2026-10-29', 34.5, 'manual')", fondo);
const btc = bd.ejecutar("INSERT INTO activos (nombre, tipo, especulativo) VALUES ('Bitcoin', 'cripto', 1)").id;
bd.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, '2026-02-01', 'compra', 0.01, 80000)", btc);
bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado, cuenta_id) VALUES ('Viaje a Japón', 400000, '2028-06-01', 0, ?)", viaje);
bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES ('Entrada del piso en Valencia (20 % más gastos de notaría)', 4500000, '2030-06-01', 120000)");
bd.ejecutar("INSERT INTO aportaciones (nombre, cuenta_id, importe, dia, inicio) VALUES ('Traspaso a Trade Republic', ?, 30000, 1, '2026-06-01')", ahorro);
bd.ejecutar("INSERT INTO limites_categoria (categoria_id, limite) VALUES (?, 30000), (?, 6000)", cat("Alimentación"), cat("Restaurantes"));

const servidor = serve({ fetch: crearApp(estado).fetch, hostname: "127.0.0.1", port: PUERTO });
const base = `http://127.0.0.1:${PUERTO}`;

const PAGINAS = [
  "/",
  "/?mes=2026-09",
  "/gastos",
  "/gastos/nuevo",
  `/gastos/${coche}`,
  `/gastos/${coche}/cuadro`,
  "/ocio",
  "/movimientos",
  "/movimientos/1",
  "/cuentas",
  "/cierre",
  "/inversiones",
  `/activos/${fondo}`,
  "/metas",
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
const CON_CAPTURA = new Set(["/", "/ocio", "/movimientos", "/cuentas", "/inversiones", "/gastos", "/ajustes"]);

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
servidor.close();
estado.sync.cerrar();
rmSync(carpeta, { recursive: true, force: true });
console.log(`\n${total ? `${total} problemas` : "Sin problemas"} · capturas en ${capturas}`);
