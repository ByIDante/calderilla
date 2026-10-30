import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { veredictoDeuda } from "../src/reglas/deuda.ts";
import { evaluar } from "../src/reglas/escalera.ts";
import { ocioSobrante } from "../src/reglas/ocio.ts";
import { parametrosPorDefecto } from "../src/reglas/parametros.ts";
import type { Situacion } from "../src/reglas/tipos.ts";

const p = parametrosPorDefecto();
const e = (euros: number) => Math.round(euros * 100);
// Intl separa el número del € con un espacio duro; en las comprobaciones da igual
const txt = (texto: string | undefined) => (texto ?? "").replace(/[\u00a0\u202f]/g, " ");

/** Una situación vacía a la que cada caso le cambia lo que necesita (importes en euros para leerlos mejor). */
function situacion(cambios: Partial<Situacion>): Situacion {
  return {
    hoy: "2026-10-30",
    ingresos: 0,
    esenciales: 0,
    noEsenciales: 0,
    liquidez: 0,
    provisiones: 0,
    apartadoMetas: 0,
    largoPlazo: 0,
    rentaVariable: 0,
    fondos: 0,
    especulativo: 0,
    mayorAccion: 0,
    pensiones: 0,
    deudas: [],
    metas: [],
    cierres: [],
    prestamosTerminados: [],
    prestamosPorTerminar: [],
    perfil: { estabilidad: "normal", riesgo: "moderado", tipoMarginal: null, tipoRescate: null, aportacionEmpresa: 0 },
    cuentasMercado: [
      { nombre: "Openbank", tae: 3.25, comprobado: "2026-10-30", finPromocion: null, nota: null },
      { nombre: "Trade Republic", tae: 3.04, comprobado: "2026-10-30", finPromocion: null, nota: null },
    ],
    letras: { nombre: "Letras 12 meses", tae: 3.0, comprobado: "2026-10-30", finPromocion: null, nota: null },
    etapaAnterior: null,
    ocioGastado: 0,
    ocioRemanente: 0,
    saldosPorEntidad: [],
    limiteFgd: e(100000),
    ...cambios,
  };
}

describe("regla de deudas", () => {
  const r = { sinRiesgoNeta: 3.25 * 0.81, bolsaNeta: 6 * 0.8 };
  const deuda = { nombre: "x", pendiente: e(3000), cuota: e(90), mesesRestantes: 36, comision: 0, vinculado: false };
  it("separa la deuda cara, la opcional y la que no compensa adelantar", () => {
    assert.equal(veredictoDeuda({ ...deuda, tae: 21 }, r, p).veredicto, "prioridad");
    assert.equal(veredictoDeuda({ ...deuda, tae: 7 }, r, p).veredicto, "prioridad", "la línea por defecto es el 7 %");
    assert.equal(veredictoDeuda({ ...deuda, tae: 3.56 }, r, p).veredicto, "opcional");
    assert.equal(veredictoDeuda({ ...deuda, tae: 1.5 }, r, p).veredicto, "no");
  });
  it("descuenta la comisión de amortización repartida entre los años que quedan", () => {
    const resultado = veredictoDeuda({ ...deuda, tae: 7.5, comision: 3, mesesRestantes: 24 }, r, p);
    assert.equal(resultado.taeEfectiva, 6);
    assert.equal(resultado.veredicto, "opcional");
  });
});

describe("escalera: seis casos", () => {
  it("P1 gasta más de lo que ingresa", () => {
    const r = evaluar(situacion({ ingresos: e(1600), esenciales: e(1450), noEsenciales: e(250), liquidez: e(800) }), p);
    assert.equal(r.etapa, "deficit");
    assert.equal(r.presupuesto.sobrante, e(-100));
    assert.equal(r.presupuesto.ocio, 0);
    assert.match(txt(r.acciones[0]?.texto), /te faltan 100 €/);
  });

  it("P2 aún no tiene colchón", () => {
    const r = evaluar(situacion({ ingresos: e(1900), esenciales: e(1200), noEsenciales: e(100), liquidez: e(400) }), p);
    assert.equal(r.etapa, "colchon");
    assert.equal(r.colchonObjetivo, e(1200));
    assert.equal(r.presupuesto.objetivoAhorro, e(480));
    assert.equal(r.presupuesto.ocio, e(120));
    assert.deepEqual(r.progreso, { actual: e(400), objetivo: e(1200), falta: e(800), meses: 2 });
  });

  it("P3 tiene una tarjeta revolving al 21 %", () => {
    const r = evaluar(
      situacion({
        ingresos: e(2200),
        esenciales: e(1300),
        noEsenciales: e(100),
        liquidez: e(1500),
        deudas: [{ nombre: "Tarjeta", pendiente: e(3000), tae: 21, cuota: e(90), mesesRestantes: 40, comision: 0, vinculado: false }],
      }),
      p,
    );
    assert.equal(r.etapa, "deuda_cara");
    assert.equal(r.presupuesto.paraEtapa, e(640));
    assert.equal(r.presupuesto.ocio, e(160));
    assert.match(txt(r.acciones[0]?.texto), /Paga 640 € al mes de más a «Tarjeta».*unos 5 meses/);
  });

  it("P4 construye el fondo de emergencia y no debe adelantar el coche", () => {
    const r = evaluar(
      situacion({
        ingresos: e(2400),
        esenciales: e(1400),
        noEsenciales: e(150),
        liquidez: e(5000),
        deudas: [{ nombre: "Coche", pendiente: e(7000), tae: 3.56, cuota: e(250), mesesRestantes: 30, comision: 0, vinculado: true }],
      }),
      p,
    );
    assert.equal(r.etapa, "fondo_emergencia");
    assert.equal(r.fondoObjetivo, e(8400));
    assert.equal(r.presupuesto.paraEtapa, e(510));
    assert.equal(r.presupuesto.ocio, e(340));
    assert.equal(r.progreso?.meses, 7);
    const amortizar = r.desbloqueos.find((d) => d.id === "amortizar");
    assert.equal(amortizar?.disponible, false, "amortizar el coche es opcional y solo en la etapa Invertir");
    assert.match(txt(amortizar?.porque), /descuento/);
  });

  it("P5 empieza a invertir y aparta para una meta a 2 años", () => {
    const r = evaluar(
      situacion({
        ingresos: e(2800),
        esenciales: e(1500),
        noEsenciales: e(200),
        liquidez: e(11000),
        apartadoMetas: e(2000),
        metas: [{ nombre: "Viaje a Japón", objetivo: e(6000), ahorrado: e(2000), fecha: "2028-10-30" }],
      }),
      p,
    );
    assert.equal(r.etapa, "invertir");
    assert.equal(r.liquidezLibre, e(9000));
    assert.equal(r.presupuesto.objetivoAhorro, e(550));
    assert.equal(r.presupuesto.paraMetas, 16667);
    assert.equal(r.presupuesto.ocio, e(550));
    assert.match(txt(r.acciones[0]?.texto), /Invierte 383 € al mes.*50 % en bolsa/);
    assert.ok(r.acciones.some((a) => /Viaje a Japón/.test(txt(a.texto))));
    assert.equal(r.progreso?.objetivo, e(18000), "la siguiente opción: parte especulativa con 12 meses de gastos invertidos");
  });

  it("P6 invierte, debe reequilibrar y tiene demasiada cripto", () => {
    const r = evaluar(
      situacion({
        ingresos: e(3800),
        esenciales: e(2000),
        noEsenciales: e(300),
        liquidez: e(14000),
        largoPlazo: e(57000),
        rentaVariable: e(48000),
        fondos: 2,
        especulativo: e(4800),
        perfil: { estabilidad: "normal", riesgo: "dinamico", tipoMarginal: 37, tipoRescate: 25, aportacionEmpresa: 0 },
      }),
      p,
    );
    assert.equal(r.etapa, "invertir");
    const opcion = (id: string) => r.desbloqueos.find((d) => d.id === id);
    assert.equal(opcion("plan_pensiones")?.disponible, true);
    assert.match(txt(opcion("plan_pensiones")?.texto), /unos 180 € de IRPF/);
    assert.equal(opcion("especulativo")?.disponible, true);
    assert.ok(r.avisos.some((a) => /supera el tope/.test(txt(a.texto))));
    assert.equal(opcion("reequilibrar")?.disponible, true);
    assert.match(txt(opcion("reequilibrar")?.texto), /traspaso entre fondos de unos 8100 €/);
    assert.equal(opcion("letras")?.disponible, false, "solo 2.000 € de exceso");
  });
});

describe("escalera: casos límite", () => {
  const base = { ingresos: e(2400), esenciales: e(1400), noEsenciales: e(150) };

  it("un mes flojo no te devuelve a la etapa anterior, pero una caída grande sí", () => {
    const fondo = 6 * 1400;
    assert.equal(evaluar(situacion({ ...base, liquidez: e(fondo * 0.9), etapaAnterior: "invertir" }), p).etapa, "invertir");
    assert.equal(evaluar(situacion({ ...base, liquidez: e(fondo * 0.9), etapaAnterior: null }), p).etapa, "fondo_emergencia");
    assert.equal(evaluar(situacion({ ...base, liquidez: e(fondo * 0.7), etapaAnterior: "invertir" }), p).etapa, "fondo_emergencia");
  });

  it("los gastos anuales ya provisionados no cuentan como liquidez libre", () => {
    const r = evaluar(situacion({ ...base, liquidez: e(9000), provisiones: e(1000) }), p);
    assert.equal(r.liquidezLibre, e(8000));
    assert.equal(r.etapa, "fondo_emergencia");
  });

  it("si no llega a una meta cercana, propone cambiar la fecha o el importe", () => {
    const r = evaluar(situacion({ ...base, liquidez: e(9000), metas: [{ nombre: "Entrada piso", objetivo: e(20000), ahorrado: 0, fecha: "2027-10-30" }] }), p);
    assert.equal(r.etapa, "metas_corto");
    assert.match(txt(r.acciones[0]?.texto), /No llegas a «Entrada piso»/);
  });

  it("la cuota de un préstamo recién terminado va entera a ahorro", () => {
    const sin = evaluar(situacion({ ...base, liquidez: e(9000) }), p);
    const con = evaluar(situacion({ ...base, liquidez: e(9000), prestamosTerminados: [{ nombre: "Coche", cuota: e(250), fin: "2026-09-05" }] }), p);
    assert.equal(con.presupuesto.objetivoAhorro, Math.round(0.5 * (sin.presupuesto.sobrante - e(250))) + e(250));
    assert.ok(con.avisos.some((a) => /Has terminado «Coche»/.test(a.texto)));
  });

  it("si en los cierres ahorras menos de lo previsto, baja el ocio", () => {
    const cierres = [
      { mes: "2026-09", ahorroPlan: e(400), ahorroReal: e(200), liquidezLibre: 0, fondoObjetivo: 0 },
      { mes: "2026-08", ahorroPlan: e(400), ahorroReal: e(300), liquidezLibre: 0, fondoObjetivo: 0 },
      { mes: "2026-07", ahorroPlan: e(400), ahorroReal: e(500), liquidezLibre: 0, fondoObjetivo: 0 },
    ];
    const r = evaluar(situacion({ ...base, liquidez: e(9000), cierres }), p);
    assert.equal(r.presupuesto.correccion, e(150));
    assert.equal(r.presupuesto.ocio, r.presupuesto.ocioPlan - e(150));
    assert.equal(ocioSobrante(e(300), e(100), p), e(100));
  });

  it("un dato de mercado viejo no se usa y pide verificarlo", () => {
    const r = evaluar(
      situacion({ ...base, liquidez: e(1000), cuentasMercado: [{ nombre: "Banco Viejo", tae: 4, comprobado: "2026-01-01", finPromocion: null, nota: null }] }),
      p,
    );
    assert.ok(r.avisos.some((a) => /Verifica.*Banco Viejo/.test(a.texto)));
    assert.doesNotMatch(r.acciones.map((a) => a.porque).join(" "), /Banco Viejo/);
  });
});
