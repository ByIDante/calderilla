import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import { cuadroAmortizacion, finPrestamo, interesesTotales, pendienteEn, type Prestamo } from "../src/dominio/prestamo.ts";
import { adivinar, firma, huellas, interpretar, leerArchivo, leerFecha } from "../src/importar/extracto.ts";
import { interpretarBce, interpretarBusquedaCoingecko, interpretarBusquedaYahoo, interpretarFrankfurter, interpretarGraficoYahoo, interpretarPrecioCoingecko } from "../src/precios/fuentes.ts";
import { puntuar } from "../src/reglas/cuestionario.ts";
import { amortizar, crearRecurrente, leerRecurrentes } from "../src/servicios/finanzas.ts";
import { importar, perfilPorFirma, proponer } from "../src/servicios/importacion.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import * as XLSX from "xlsx";

const fixture = (nombre: string) => readFileSync(path.join(import.meta.dirname, "fixtures", nombre));
const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-fase2-"));
after(() => rmSync(carpeta, { recursive: true, force: true }));

describe("fuentes de precios (respuestas grabadas, sin red)", () => {
  it("Yahoo: resultados de búsqueda y último cierre", () => {
    const resultados = interpretarBusquedaYahoo([
      { symbol: "0P00000RQC.F", shortname: "Vanguard Global Stock Index", quoteType: "MUTUALFUND", exchange: "FRA" },
      { symbol: "VWCE.DE", longname: "Vanguard FTSE All-World UCITS ETF", quoteType: "ETF", exchDisp: "XETRA" },
      { symbol: "noticia", quoteType: "NEWS" },
    ]);
    assert.deepEqual(
      resultados.map((r) => [r.simbolo, r.tipo, r.mercado]),
      [
        ["0P00000RQC.F", "Fondo", "FRA"],
        ["VWCE.DE", "ETF", "XETRA"],
      ],
    );
    const cotizacion = interpretarGraficoYahoo({
      meta: { currency: "EUR" },
      quotes: [
        { date: new Date("2026-10-29T08:00:00Z"), close: 168.9 },
        { date: new Date("2026-10-30T08:00:00Z"), close: null },
      ],
    });
    assert.deepEqual(cotizacion, { fecha: "2026-10-29", precio: 168.9, moneda: "EUR" });
    assert.equal(interpretarGraficoYahoo({ meta: { currency: "GBp" }, quotes: [{ date: new Date("2026-10-29"), close: 7520 }] })?.precio, 75.2, "peniques a libras");
  });

  it("CoinGecko: búsqueda y precio en euros", () => {
    assert.deepEqual(interpretarBusquedaCoingecko({ coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "btc" }] })[0]?.nombre, "Bitcoin (BTC)");
    assert.deepEqual(interpretarPrecioCoingecko({ bitcoin: { eur: 69533 } }, "bitcoin", "2026-10-30"), { fecha: "2026-10-30", precio: 69533, moneda: "EUR" });
    assert.equal(interpretarPrecioCoingecko({}, "bitcoin", "2026-10-30"), null);
  });

  it("tipos de cambio del BCE (CSV con comas dentro de comillas) y de Frankfurter", () => {
    const bce = interpretarBce(fixture("bce.csv").toString("utf8"));
    assert.deepEqual(bce.get("USD"), { fecha: "2026-10-29", porEuro: 1.113 });
    assert.deepEqual(bce.get("CHF"), { fecha: "2026-10-29", porEuro: 0.9222 });
    assert.deepEqual(interpretarFrankfurter({ amount: 1, base: "EUR", date: "2026-10-29", rates: { USD: 1.113 } }).get("USD"), { fecha: "2026-10-29", porEuro: 1.113 });
  });
});

describe("extractos bancarios", () => {
  const filas = leerArchivo("extracto.csv", new Uint8Array(fixture("extracto-banco.csv")));

  it("lee un CSV en Windows-1252 con punto y coma y adivina las columnas", () => {
    const cfg = adivinar(filas);
    assert.equal(cfg.filaCabecera, 1, "salta la línea de título del banco");
    assert.equal(filas[cfg.filaCabecera]?.[cfg.concepto], "Concepto");
    assert.equal(filas[cfg.filaCabecera]?.[cfg.importe ?? -1], "Importe");
    assert.equal(cfg.formatoFecha, "dmy");
    const { movimientos, errores } = interpretar(filas, cfg);
    assert.equal(errores, 0);
    assert.equal(movimientos.length, 7);
    assert.deepEqual(movimientos.at(-1), { fila: 8, fecha: "2026-10-28", importe: 200000, concepto: "NÓMINA OCTUBRE EMPRESA SL" });
  });

  it("Excel: importes con la moneda en el texto o en el formato de la celda", () => {
    const hoja = XLSX.utils.aoa_to_sheet([
      ["Fecha", "Concepto", "Importe"],
      ["03/10/2026", "MERCADONA", "-200 EUR"],
      ["05/10/2026", "NOMINA", 1234],
      ["06/10/2026", "GASOLINA", -45.678],
      ["07/10/2026", "BIZUM", "1.234,56 EUR"],
      ["", "Saldo final", "988,88 EUR"],
    ]);
    // Formatos de celda que, leídos como texto, saldrían «1,234 EUR» y «-45.678»
    hoja["C3"]!.z = '#,##0 "EUR"';
    hoja["C4"]!.z = "0.000";
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Movimientos");
    const filas = leerArchivo("extracto.xlsx", XLSX.write(libro, { type: "buffer", bookType: "xlsx" }));
    const lectura = interpretar(filas, adivinar(filas));
    assert.deepEqual(
      lectura.movimientos.map((m) => [m.fecha, m.importe]),
      [
        ["2026-10-03", -20000],
        ["2026-10-05", 123400],
        ["2026-10-06", -4568],
        ["2026-10-07", 123456],
      ],
    );
    assert.deepEqual([lectura.errores, lectura.sinFecha, lectura.sinImporte], [1, 1, 0]);
    assert.deepEqual(lectura.ejemplo, { fila: 6, campo: "fecha", valor: "" }, "la fila del saldo no tiene fecha");
  });

  it("entiende fechas y columnas de cargo y abono", () => {
    assert.equal(leerFecha("5/3/26", "dmy"), "2026-03-05");
    assert.equal(leerFecha("2026-03-05", "dmy"), "2026-03-05");
    assert.equal(leerFecha("03/05/2026", "mdy"), "2026-03-05");
    assert.equal(leerFecha("31/02/2026", "dmy"), null);
    const separadas = [["Fecha", "Concepto", "Cargo", "Abono"], ["01/10/2026", "Recibo", "700,00", ""], ["28/10/2026", "Nómina", "", "2.000,00"]];
    const cfg = adivinar(separadas);
    assert.deepEqual([cfg.importe, cfg.cargo, cfg.abono], [null, 2, 3]);
    assert.deepEqual(interpretar(separadas, cfg).movimientos.map((m) => m.importe), [-70000, 200000]);
  });

  it("dos cafés iguales el mismo día no se toman por duplicados", () => {
    const { movimientos } = interpretar(filas, adivinar(filas));
    const lista = huellas(movimientos, 1);
    assert.equal(new Set(lista).size, lista.length);
    assert.deepEqual(huellas(movimientos, 1), lista, "la huella es estable: reimportar no duplica");
  });

  it("reconoce los gastos fijos, categoriza y no importa dos veces", () => {
    const bd = new BaseDatos(path.join(carpeta, "importar.db"));
    prepararBase(bd);
    const categoria = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
    crearRecurrente(bd, { tipo: "gasto", nombre: "Alquiler", categoriaId: categoria("Vivienda"), frecuencia: "mensual", inicio: "2024-01-01", fin: null, esencial: true, clase: "fijo", nota: null, importe: 70000, prestamo: null });
    crearRecurrente(bd, { tipo: "ingreso", nombre: "Nómina", categoriaId: categoria("Nómina"), frecuencia: "mensual", inicio: "2024-01-28", fin: null, esencial: false, clase: "fijo", nota: null, importe: 200000, prestamo: null });

    const cfg = adivinar(filas);
    const { movimientos } = interpretar(filas, cfg);
    const propuestas = proponer(bd, movimientos, null);
    const porConcepto = (texto: string) => propuestas.find((p) => p.concepto.includes(texto))!;
    assert.equal(porConcepto("ALQUILER").recurrente, "Alquiler");
    assert.equal(porConcepto("NÓMINA").recurrente, "Nómina");
    assert.equal(porConcepto("MERCADONA").categoriaId, categoria("Alimentación"));
    assert.equal(porConcepto("CINESA").categoriaId, categoria("Ocio"), "«cine» está en «cinesa»");

    const perfil = { nombre: "Mi banco", firma: firma(filas, cfg.filaCabecera), configuracion: cfg };
    assert.deepEqual(importar(bd, propuestas, { cuentaId: null, archivo: "extracto.csv", hoy: "2026-10-30", perfil }), { nuevas: 7, duplicadas: 0 });
    assert.equal(perfilPorFirma(bd, perfil.firma)?.nombre, "Mi banco");
    const otraVez = proponer(bd, movimientos, null);
    assert.ok(otraVez.every((p) => p.duplicado));
    bd.cerrar();
  });
});

describe("amortizaciones anticipadas", () => {
  const prestamo: Prestamo = { capital: 1_000_000, tin: 5, tae: null, plazoMeses: 48, primeraCuota: "2026-01-10", comisionAmortizacion: 0, vinculado: false };

  it("reducir plazo: misma cuota, se acaba antes y se pagan menos intereses", () => {
    const con: Prestamo = { ...prestamo, amortizaciones: [{ fecha: "2027-01-01", importe: 300_000, modo: "plazo" }] };
    const cuadro = cuadroAmortizacion(con);
    assert.ok(finPrestamo(con) < finPrestamo(prestamo));
    assert.equal(cuadro.reduce((s, f) => s + f.amortizacion + f.anticipado, 0), 1_000_000);
    assert.equal(cuadro[13]?.cuota, 23029, "la cuota no cambia");
    assert.ok(interesesTotales(con) < interesesTotales(prestamo));
  });

  it("reducir cuota: mismo plazo, cuota más baja", () => {
    const con: Prestamo = { ...prestamo, amortizaciones: [{ fecha: "2027-01-01", importe: 300_000, modo: "cuota" }] };
    const cuadro = cuadroAmortizacion(con);
    assert.equal(finPrestamo(con), finPrestamo(prestamo));
    assert.ok((cuadro[12]?.cuota ?? 0) < 23029);
    assert.equal(cuadro.at(-1)?.pendiente, 0);
    assert.equal(pendienteEn(con, "2027-01-05"), pendienteEn(prestamo, "2027-01-05") - 300_000, "lo amortizado cuenta desde su fecha");
  });

  it("al amortizar se actualizan la fecha de fin y la cuota del gasto", () => {
    const bd = new BaseDatos(path.join(carpeta, "amortizar.db"));
    prepararBase(bd);
    const id = crearRecurrente(bd, { tipo: "gasto", nombre: "Coche", categoriaId: null, frecuencia: "mensual", inicio: "2026-01-10", fin: null, esencial: true, clase: "fijo", nota: null, importe: 0, prestamo });
    const resultado = amortizar(bd, id, { fecha: "2027-01-01", importe: 300_000, modo: "cuota" });
    assert.ok(resultado.interesesDespues < resultado.interesesAntes);
    const [r] = leerRecurrentes(bd, id);
    assert.equal(r?.versiones.length, 2, "nueva cuota desde la siguiente");
    assert.ok((r?.versiones[1]?.importe ?? 0) < 23029);
    bd.cerrar();
  });
});

describe("cuestionario de riesgo", () => {
  it("el perfil es el menor entre lo que aguantas y lo que te puedes permitir", () => {
    assert.equal(puntuar([3, 3, 2, 3, 3]).perfil, "agresivo");
    assert.equal(puntuar([0, 3, 2, 3, 3]).perfil, "dinamico", "valiente, pero con poco plazo");
    assert.equal(puntuar([3, 0, 2, 0, 0]).perfil, "conservador");
    assert.equal(puntuar([2, 2, 1, 1, 2]).perfil, "dinamico");
    assert.equal(puntuar([1, 1, 1, 1, 1]).perfil, "moderado");
    assert.equal(puntuar([3, 3, 0, 3, 3]).estabilidad, "inestable");
  });
});
