// La Calculadora: sin cambios da tus números de verdad, cada cambio se nota donde debe y nunca guarda nada.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import { evaluar } from "../src/reglas/escalera.ts";
import { aplicarRapido } from "../src/servidor/rutas/calculadora.ts";
import { mesesSinIngresos, proyectar, simular, sinCambios, type Prueba } from "../src/servicios/calculadora.ts";
import { guardarSaldo } from "../src/servicios/cuentas.ts";
import { amortizar, crearRecurrente, type DatosRecurrente } from "../src/servicios/finanzas.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { construir, contexto } from "../src/servicios/situacion.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-calculadora-"));
after(() => rmSync(carpeta, { recursive: true, force: true }));

const HOY = "2026-10-30";
const fijo = { fin: null, esencial: true, clase: "fijo" as const, nota: null, prestamo: null, categoriaId: null };

const bd = new BaseDatos(path.join(carpeta, "datos.db"));
prepararBase(bd);
const nomina = crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2024-01-28", importe: 200000, pagasExtra: [{ nombre: null, meses: [6, 12], importe: null }] });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Alquiler", frecuencia: "mensual", inicio: "2024-01-01", importe: 80000 });
const netflix = crearRecurrente(bd, { ...fijo, esencial: false, tipo: "gasto", nombre: "Netflix", frecuencia: "mensual", inicio: "2024-01-01", importe: 1500 });
crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Seguro", frecuencia: "anual", inicio: "2027-03-01", importe: 60000 });
const prestamoCoche: DatosRecurrente = {
  ...fijo,
  tipo: "gasto",
  nombre: "Coche",
  frecuencia: "mensual",
  inicio: "2026-01-10",
  importe: 0,
  prestamo: { capital: 1_000_000, tin: 5, tae: null, plazoMeses: 48, comisionAmortizacion: 0.5, vinculado: false },
};
const coche = crearRecurrente(bd, prestamoCoche);
const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
guardarSaldo(bd, cuenta, "2026-10-01", 150000);
const meta = bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES ('Viaje', 300000, '2027-10-01', 0)").id;

const base = construir(bd, HOY);
const real = simular(base, sinCambios());
const con = (cambios: Partial<Prueba>) => simular(base, { ...sinCambios(), ...cambios }).resultado.presupuesto;

describe("Calculadora", () => {
  it("sin cambios da exactamente lo mismo que las pantallas de verdad", () => {
    assert.deepEqual(real.resultado, evaluar(base.situacion, base.parametros));
    assert.deepEqual(real.resultado.presupuesto, contexto(bd, HOY).resultado.presupuesto);
    assert.equal(real.presupuesto.ingresos, 233333, "con las pagas extra repartidas");
  });

  it("subir la nómina 100 €: sobran 100 € más y se reparten entre ahorro y ocio según la etapa", () => {
    const p = con({ importes: new Map([[nomina, 210000]]) });
    const antes = real.resultado.presupuesto;
    assert.equal(p.ingresos - antes.ingresos, 11667, "100 € al mes y sus pagas extra: 100 × 14 ÷ 12");
    assert.equal(p.sobrante - antes.sobrante, 11667);
    assert.equal(p.objetivoAhorro - antes.objetivoAhorro + (p.ocioPlan - antes.ocioPlan), 11667, "lo que sobra de más va a ahorro o a ocio");
  });

  it("quitar un gasto, añadir uno de prueba y cambiar lo gastado en ocio", () => {
    assert.equal(con({ quitados: new Set([netflix]) }).noEsenciales, real.resultado.presupuesto.noEsenciales - 1500);
    const gimnasio = con({ nuevos: [{ fila: 1, tipo: "gasto", esencial: false, nombre: "Gimnasio", importe: 4000, frecuencia: "mensual" }] });
    assert.equal(gimnasio.noEsenciales, real.resultado.presupuesto.noEsenciales + 4000);
    const clases = con({ nuevos: [{ fila: 2, tipo: "ingreso", esencial: false, nombre: "Clases", importe: 10000, frecuencia: "quincenal" }] });
    assert.equal(clases.ingresos, real.resultado.presupuesto.ingresos + 20000, "dos veces al mes");
    assert.equal(con({ ocioGastado: 5000 }).ocioQueda, real.resultado.presupuesto.ocioQueda - 5000);
  });

  it("las metas y las reglas también se pueden probar", () => {
    const antes = real.resultado.presupuesto;
    assert.ok(con({ metas: new Map([[meta, { objetivo: 600000 }]]) }).paraMetas > antes.paraMetas, "el doble de objetivo, más al mes");
    assert.equal(con({ metasQuitadas: new Set([meta]) }).paraMetas, 0);
    const nueva = con({ metaNueva: { nombre: "Coche", objetivo: 120000, ahorrado: 0, fecha: "2027-10-30" } });
    assert.ok(nueva.paraMetas >= antes.paraMetas + 10000, "1.200 € en 12 meses: 100 € más al mes");
    const etapa = real.resultado.etapa;
    const clave = ({ colchon: "proporcionColchon", deuda_cara: "proporcionDeuda", fondo_emergencia: "proporcionFondo", metas_corto: "proporcionMetas", invertir: "proporcionInvertir" } as const)[
      etapa as "colchon"
    ];
    assert.ok(clave, `la etapa del ejemplo (${etapa}) tiene proporción`);
    assert.ok(con({ parametros: { [clave]: 100 } }).ocioPlan <= antes.ocioPlan, "ahorrar todo lo que sobra deja el ocio en el mínimo");
  });

  it("con más dinero en las cuentas se avanza en la escalera", () => {
    const rico = simular(base, { ...sinCambios(), liquidez: 10_000_000 }).resultado;
    assert.ok(rico.numero > real.resultado.numero, `de ${real.resultado.etapa} a ${rico.etapa}`);
  });

  it("botones rápidos: se aplican sobre lo que hay en el formulario", () => {
    const valores: Record<string, string> = {};
    aplicarRapido(valores, "sueldo", base);
    assert.equal(valores[`importe_${nomina}`], "2100", "2.000 € + 5 %");
    aplicarRapido(valores, "sueldo", base);
    assert.equal(valores[`importe_${nomina}`], "2205", "se suman: otro 5 % sobre lo que ya había");
    aplicarRapido(valores, "precios", base);
    assert.equal(valores[`importe_${coche}`], undefined, "la cuota del préstamo no sube");
    assert.equal(valores[`importe_${netflix}`], "16,50", "15 € + 10 %");
    aplicarRapido(valores, "no_esenciales", base);
    assert.equal(valores[`quitar_${netflix}`], "1");
    aplicarRapido(valores, "sin_ingresos", base);
    assert.equal(valores[`quitar_${nomina}`], "1");
  });

  it("si dejaras de cobrar: meses que aguantas con lo de tus cuentas pagando lo esencial", () => {
    assert.equal(mesesSinIngresos(real), base.situacion.liquidez / real.situacion.esenciales);
    const sinCuentas = simular(base, { ...sinCambios(), liquidez: 0 });
    assert.equal(mesesSinIngresos(sinCuentas), 0);
  });

  it("adelantar el préstamo: reducir plazo o cuota, y lo mismo que al amortizar de verdad", () => {
    const plazo = simular(base, { ...sinCambios(), adelantos: new Map([[coche, { importe: 200000, modo: "plazo" as const }]]) });
    const [a] = plazo.adelantos;
    assert.ok(a && a.interesesAhorrados > 0 && a.finDespues < a.finAntes && a.cuotaDespues === a.cuotaAntes, "misma cuota, acaba antes");
    assert.equal(a.comision, 1000, "0,5 % de 2.000 €");
    assert.equal(plazo.situacion.liquidez, base.situacion.liquidez - 201000, "sale de tus cuentas con la comisión");
    const deuda = (x: typeof real) => x.situacion.deudas.find((d) => d.nombre === "Coche")!.pendiente;
    assert.equal(deuda(real) - deuda(plazo), 200000);

    const cuota = simular(base, { ...sinCambios(), adelantos: new Map([[coche, { importe: 200000, modo: "cuota" as const }]]) }).adelantos[0]!;
    assert.ok(cuota.cuotaDespues < cuota.cuotaAntes && cuota.finDespues === cuota.finAntes, "misma fecha, cuota más baja");
    assert.ok(a.interesesAhorrados > cuota.interesesAhorrados, "reducir plazo ahorra más intereses");

    const otra = new BaseDatos(path.join(carpeta, "amortizar.db"));
    prepararBase(otra);
    const deVerdad = amortizar(otra, crearRecurrente(otra, prestamoCoche), { fecha: HOY, importe: 200000, modo: "plazo" });
    assert.deepEqual([deVerdad.interesesAntes - deVerdad.interesesDespues, deVerdad.fin], [a.interesesAhorrados, a.finDespues]);
    otra.cerrar();
  });

  it("proyección: cada mes crece lo que toca ahorrar, y dice cuándo llegas a cada cosa", () => {
    const { puntos, hitos } = proyectar(real);
    assert.equal(puntos.length, 25, "hoy y los próximos 24 meses");
    assert.equal(puntos[0]!.ahorrado, base.situacion.liquidez - base.situacion.provisiones + base.situacion.largoPlazo);
    assert.equal(puntos[1]!.ahorrado - puntos[0]!.ahorrado, real.resultado.presupuesto.objetivoAhorro);
    assert.ok(hitos.some((h) => h.clave === `meta-${meta}`), "también las metas");
    const rico = proyectar(simular(base, { ...sinCambios(), liquidez: 10_000_000 })).hitos;
    assert.equal(rico.find((h) => h.clave === "fondo")?.ya, true, "con mucho dinero, el fondo ya está");
    const sinNomina = proyectar(simular(base, { ...sinCambios(), quitados: new Set([nomina]) }));
    assert.ok(sinNomina.puntos[3]!.ahorrado < sinNomina.puntos[0]!.ahorrado, "sin ingresos, lo ahorrado baja");
    assert.ok(sinNomina.hitos.find((h) => h.clave === "sin-dinero")?.mes, "y dice cuándo te quedarías sin dinero");
  });

  it("no guarda nada", () => {
    bd.escribirMeta("sucio", "0");
    const etapas = bd.uno<{ n: number }>("SELECT count(*) AS n FROM historial_etapas")?.n;
    simular(construir(bd, HOY), { ...sinCambios(), liquidez: 10_000_000, quitados: new Set([nomina]) });
    assert.equal(bd.leerMeta("sucio"), "0");
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM historial_etapas")?.n, etapas, "ni apunta cambios de etapa");
    bd.cerrar();
  });
});
