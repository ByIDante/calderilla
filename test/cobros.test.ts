// Cobros cada semana, cada 2 semanas o dos veces al mes, y pagas extra repartidas entre los 12 meses.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import { sumarDias } from "../src/dominio/fechas.ts";
import {
  cobrosEnMes,
  cuotasRestantes,
  desgloseAnual,
  devengoAcumulado,
  finPorCuotas,
  mensualEn,
  ocurrencias,
  pagasEnMes,
  proximaOcurrencia,
  type Recurrente,
} from "../src/dominio/recurrencia.ts";
import { detectarPeriodicos, type ApunteDetectable } from "../src/importar/periodicos.ts";
import { cerrarMes } from "../src/servicios/cierres.ts";
import { guardarSaldo } from "../src/servicios/cuentas.ts";
import { actualizarRecurrente, crearRecurrente, ingresosDelMes, leerRecurrentes } from "../src/servicios/finanzas.ts";
import { coincidencia } from "../src/servicios/importacion.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-cobros-"));
after(() => rmSync(carpeta, { recursive: true, force: true }));

const ingreso = (cambios: Partial<Recurrente>): Recurrente => ({ id: 1, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2024-01-28", fin: null, esencial: false, ...cambios });
const desde = (importe: number, fecha = "2024-01-01") => [{ validoDesde: fecha, importe }];
const fijo = { fin: null, esencial: false, clase: "fijo" as const, nota: null, prestamo: null, categoriaId: null };

describe("cobros más de una vez al mes", () => {
  it("cada semana: 52 al año, unos meses 4 y otros 5", () => {
    const r = ingreso({ frecuencia: "semanal", inicio: "2026-10-02" });
    assert.deepEqual(ocurrencias(r, "2026-10-01", "2026-10-31"), ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    assert.equal(ocurrencias(r, "2026-11-01", "2026-11-30").length, 4);
    assert.equal(mensualEn(r, desde(10000), "2026-11"), Math.round((10000 * 52) / 12), "cuenta la media, no los 4 o 5 de cada mes");
    assert.equal(proximaOcurrencia(r, "2026-10-03"), "2026-10-09");
    assert.equal(finPorCuotas("2026-10-02", "semanal", 3), "2026-10-16");
  });

  it("cada 2 semanas: 26 al año y dos meses con 3 cobros", () => {
    const r = ingreso({ frecuencia: "catorcenal", inicio: "2026-01-02" });
    assert.equal(ocurrencias(r, "2026-01-01", "2026-12-31").length, 26);
    assert.deepEqual(ocurrencias(r, "2026-01-01", "2026-01-31"), ["2026-01-02", "2026-01-16", "2026-01-30"]);
    assert.equal(mensualEn(r, desde(90000), "2026-02"), 195000, "900 € × 26 ÷ 12");
    assert.equal(cobrosEnMes(r, desde(90000), "2026-01"), 270000, "en enero llegan 3 de verdad");
  });

  it("dos veces al mes: el día del primero y 15 días después, sin pasarse de fin de mes", () => {
    const r = ingreso({ frecuencia: "quincenal", inicio: "2026-01-15" });
    assert.deepEqual(ocurrencias(r, "2026-01-01", "2026-02-28"), ["2026-01-15", "2026-01-30", "2026-02-15", "2026-02-28"]);
    assert.deepEqual(ocurrencias(ingreso({ frecuencia: "quincenal", inicio: "2026-01-01" }), "2026-03-01", "2026-03-31"), ["2026-03-01", "2026-03-16"]);
    assert.equal(mensualEn(r, desde(80000), "2026-03"), 160000);
    assert.equal(mensualEn(r, desde(80000), "2025-12"), 0, "antes del primer cobro no cuenta");
    assert.equal(finPorCuotas("2026-01-15", "quincenal", 3), "2026-02-15");
    assert.equal(finPorCuotas("2026-01-15", "quincenal", 4), "2026-02-28");
    assert.equal(cuotasRestantes({ ...r, fin: "2026-02-28" }, "2026-01-20"), 3);
  });
});

describe("pagas extra", () => {
  const catorce = ingreso({ pagasExtra: [{ nombre: null, meses: [6, 12], importe: null }] });

  it("14 pagas de 1.500 € cuentan 1.750 € todos los meses", () => {
    for (const mes of ["2026-01", "2026-06", "2026-11"]) assert.equal(mensualEn(catorce, desde(150000), mes), 175000, mes);
    assert.equal(mensualEn(catorce, desde(150000), "2023-12"), 0, "antes de empezar a cobrar, nada");
    const d = desgloseAnual(catorce, desde(150000), "2026-10-30");
    assert.deepEqual([d.veces, d.normal, d.total, d.alMes], [12, 1_800_000, 2_100_000, 175000]);
  });

  it("sin importe propio siguen las subidas; con importe propio, no", () => {
    const subida = [...desde(150000), { validoDesde: "2026-07-01", importe: 160000 }];
    assert.equal(mensualEn(catorce, subida, "2026-08"), 160000 + Math.round((2 * 160000) / 12));
    const propia = ingreso({ pagasExtra: [{ nombre: "Beneficios", meses: [3], importe: 100000 }] });
    assert.equal(mensualEn(propia, subida, "2026-08"), Math.round(160000 + 100000 / 12));
  });

  it("una extra cada 2 meses, o varias pagas con su nombre", () => {
    const bimestral = ingreso({ pagasExtra: [{ nombre: null, meses: [2, 4, 6, 8, 10, 12], importe: 20000 }] });
    assert.equal(mensualEn(bimestral, desde(150000), "2026-05"), 150000 + 10000);
    const varias = ingreso({
      pagasExtra: [
        { nombre: "Verano", meses: [6], importe: null },
        { nombre: "Beneficios", meses: [3], importe: 80000 },
      ],
    });
    assert.deepEqual(pagasEnMes(varias, desde(150000), "2026-06"), [{ nombre: "Verano", fecha: "2026-06-28", importe: 150000 }]);
    assert.equal(cobrosEnMes(varias, desde(150000), "2026-03"), 230000);
    assert.equal(cobrosEnMes(varias, desde(150000), "2026-05"), 150000);
  });

  it("lo ya ganado y aún no cobrado: lo que contó el presupuesto menos lo cobrado", () => {
    assert.equal(devengoAcumulado(catorce, desde(150000), "2026-05-31"), 125000, "5/6 de la de junio");
    assert.equal(devengoAcumulado(catorce, desde(150000), "2026-06-30"), 0, "cobrada la de junio, a cero");
    assert.equal(devengoAcumulado(catorce, desde(150000), "2026-07-31"), 25000, "y vuelve a crecer 1/6 al mes");
    const nueva = ingreso({ inicio: "2026-10-28", pagasExtra: catorce.pagasExtra });
    assert.equal(devengoAcumulado(nueva, desde(150000), "2026-10-31"), 25000, "recién empezada: solo lo que ya ha contado el presupuesto");
    const eventos = ingreso({ frecuencia: "catorcenal", inicio: "2026-01-02" });
    assert.equal(devengoAcumulado(eventos, desde(90000), "2026-01-31"), 195000 - 270000, "en enero llegan 3: cobras más de lo que cuenta");
    assert.equal(devengoAcumulado(eventos, desde(90000), "2026-12-31"), 0, "al cabo del año, cuadra");
    assert.equal(devengoAcumulado({ ...catorce, tipo: "gasto" }, desde(150000), "2026-03-31"), 0);
  });
});

describe("pagas extra con la base de datos", () => {
  function base(nombre: string): BaseDatos {
    const bd = new BaseDatos(path.join(carpeta, `${nombre}.db`));
    prepararBase(bd);
    return bd;
  }

  it("se guardan, se cambian y se quitan con el ingreso", () => {
    const bd = base("guardar");
    const datos = { ...fijo, tipo: "ingreso" as const, nombre: "Nómina", frecuencia: "mensual" as const, inicio: "2024-01-28", importe: 150000 };
    const id = crearRecurrente(bd, { ...datos, pagasExtra: [{ nombre: "Verano", meses: [6], importe: null }] });
    assert.deepEqual(leerRecurrentes(bd, id)[0]?.pagasExtra, [{ nombre: "Verano", meses: [6], importe: null }]);
    actualizarRecurrente(bd, id, { ...datos, importe: 160000 }, "2026-10-01");
    assert.equal(leerRecurrentes(bd, id)[0]?.pagasExtra.length, 1, "sin decir nada, se conservan");
    actualizarRecurrente(bd, id, { ...datos, pagasExtra: [{ nombre: null, meses: [6, 12], importe: 90000 }] }, "2026-10-01");
    assert.deepEqual(leerRecurrentes(bd, id)[0]?.pagasExtra, [{ nombre: null, meses: [6, 12], importe: 90000 }]);
    actualizarRecurrente(bd, id, { ...datos, tipo: "gasto" }, "2026-10-01");
    assert.deepEqual(leerRecurrentes(bd, id)[0]?.pagasExtra, [], "un gasto no tiene pagas extra");
    bd.cerrar();
  });

  it("lo que cobras de verdad cada mes frente a lo que cuenta el presupuesto", () => {
    const bd = base("mes-a-mes");
    crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2024-01-28", importe: 150000, pagasExtra: [{ nombre: null, meses: [6, 12], importe: null }] });
    crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Eventos", frecuencia: "catorcenal", inicio: "2026-01-02", importe: 12000 });
    const recurrentes = leerRecurrentes(bd);
    const junio = ingresosDelMes(recurrentes, "2026-06");
    assert.equal(junio.real, 300000 + 2 * 12000);
    assert.equal(junio.presupuesto, 175000 + 26000);
    assert.deepEqual(junio.notas, ["Paga extra de Nómina"]);
    assert.deepEqual(ingresosDelMes(recurrentes, "2026-01").notas, ["3 cobros de Eventos"]);
    bd.cerrar();
  });

  it("con 14 pagas, el ahorro real de cada cierre es el del presupuesto, también el mes de la extra", () => {
    const bd = base("cierres");
    crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2026-01-28", importe: 200000, pagasExtra: [{ nombre: null, meses: [6, 12], importe: null }] });
    const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
    guardarSaldo(bd, cuenta, "2026-01-01", 0);
    // Sin gastos: cada mes entra la nómina (y en junio, la extra). El presupuesto cuenta 2.333,33 € al mes
    let saldo = 1_000_000;
    cerrarMes(bd, "2026-02", [{ cuentaId: cuenta, saldo }]);
    for (const [mes, cobrado] of [["2026-03", 200000], ["2026-04", 200000], ["2026-05", 200000], ["2026-06", 400000], ["2026-07", 200000]] as const) {
      saldo += cobrado;
      const cierre = cerrarMes(bd, mes, [{ cuentaId: cuenta, saldo }]);
      assert.ok(Math.abs((cierre.ahorro_real ?? 0) - 233333) <= 1, `${mes}: ${cierre.ahorro_real}`);
    }
    bd.cerrar();
  });

  it("el banco: la nómina de junio con la extra sumada, o la extra aparte", () => {
    const bd = base("emparejar");
    crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2026-01-28", importe: 150000, pagasExtra: [{ nombre: null, meses: [6, 12], importe: null }] });
    const recurrentes = leerRecurrentes(bd);
    assert.equal(coincidencia({ fecha: "2026-06-28", importe: 300000 }, recurrentes, new Map())?.nombre, "Nómina", "sumada");
    const usados = new Map<number, string[]>();
    assert.equal(coincidencia({ fecha: "2026-12-28", importe: 150000 }, recurrentes, usados)?.nombre, "Nómina");
    assert.equal(coincidencia({ fecha: "2026-12-29", importe: 150000 }, recurrentes, usados)?.nombre, "Nómina", "aparte: cabe un movimiento más el mes de la extra");
    assert.equal(coincidencia({ fecha: "2026-05-28", importe: 300000 }, recurrentes, new Map()), null, "en mayo no hay extra");
    bd.cerrar();
  });
});

describe("encontrar en los movimientos lo que se cobra varias veces al mes", () => {
  let id = 0;
  const apunte = (fecha: string, importe: number, concepto: string): ApunteDetectable => ({ id: ++id, fecha, importe, concepto, categoriaId: null, cuentaId: 1 });
  const hasta = new Map<number | null, string>([[1, "2026-10-30"]]);

  it("una nómina dos veces al mes y otra cada 2 semanas", () => {
    const apuntes: ApunteDetectable[] = [];
    for (const mes of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
      apuntes.push(apunte(`${mes}-01`, 90000, "TRANSFERENCIA NOMINA HOSTELERIA SUR"), apunte(`${mes}-16`, 90000, "TRANSFERENCIA NOMINA HOSTELERIA SUR"));
    }
    for (let fecha = "2026-06-05"; fecha <= "2026-10-30"; fecha = sumarDias(fecha, 14)) apuntes.push(apunte(fecha, 18000, "TRANSFERENCIA RECIBIDA EVENTOS LEVANTE"));
    const encontrados = detectarPeriodicos(apuntes, hasta);
    const quincenal = encontrados.find((p) => p.nombre.startsWith("Nomina"));
    assert.deepEqual([quincenal?.frecuencia, quincenal?.importe, quincenal?.mensual, quincenal?.inicio], ["quincenal", 90000, 180000, "2026-06-01"]);
    const eventos = encontrados.find((p) => p.nombre.startsWith("Eventos"));
    assert.deepEqual([eventos?.frecuencia, eventos?.mensual], ["catorcenal", 39000]);
  });

  it("dos suscripciones del mismo comercio no son algo quincenal", () => {
    const apuntes: ApunteDetectable[] = [];
    for (const mes of ["2026-06", "2026-07", "2026-08", "2026-09"]) apuntes.push(apunte(`${mes}-03`, -299, "APPLE.COM BILL"), apunte(`${mes}-18`, -1099, "APPLE.COM BILL"));
    assert.ok(detectarPeriodicos(apuntes, hasta).every((p) => p.frecuencia === "mensual"));
  });
});

describe("migración a la versión 6", () => {
  it("rehace la tabla de ingresos y gastos sin perder importes, préstamos ni movimientos unidos", () => {
    const ruta = path.join(carpeta, "v5.db");
    const bd = new BaseDatos(ruta);
    const migraciones = path.join(import.meta.dirname, "..", "src", "datos", "migraciones");
    for (const archivo of readdirSync(migraciones).filter((a) => a < "006").sort()) bd.script(readFileSync(path.join(migraciones, archivo), "utf8"));
    bd.script("PRAGMA user_version = 5");
    bd.ejecutar("INSERT INTO recurrentes (id, tipo, nombre, frecuencia, inicio, esencial, patron) VALUES (7, 'gasto', 'Coche', 'mensual', '2024-03-05', 1, 'financiera')");
    bd.ejecutar("INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (7, '2024-03-05', 28652)");
    bd.ejecutar("INSERT INTO prestamos (recurrente_id, capital, tin, plazo_meses, primera_cuota) VALUES (7, 1500000, 5.5, 60, '2024-03-05')");
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, recurrente_id) VALUES ('2026-10-05', -28652, 'FINANCIERA COCHE', 7)");

    bd.migrar();
    assert.equal(bd.version(), 6);
    assert.deepEqual({ ...bd.uno<{ nombre: string; patron: string }>("SELECT nombre, patron FROM recurrentes WHERE id = 7") }, { nombre: "Coche", patron: "financiera" });
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM recurrentes_importes WHERE recurrente_id = 7")?.n, 1);
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM prestamos WHERE recurrente_id = 7")?.n, 1);
    assert.equal(bd.uno<{ id: number | null }>("SELECT recurrente_id AS id FROM apuntes")?.id, 7);
    assert.equal(bd.uno<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys, 1, "las claves ajenas vuelven a estar activas");

    bd.ejecutar("INSERT INTO recurrentes (id, tipo, nombre, frecuencia, inicio) VALUES (8, 'ingreso', 'Clases', 'quincenal', '2026-01-01')");
    bd.ejecutar("INSERT INTO pagas_extra (recurrente_id, meses) VALUES (8, '6,12')");
    bd.ejecutar("DELETE FROM recurrentes WHERE id = 8");
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM pagas_extra")?.n, 0, "al borrar el ingreso se van sus pagas");
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE name = 'cambio_recurrentes_insert'")?.n, 1, "y sigue avisando de los cambios");
    bd.cerrar();
  });
});
