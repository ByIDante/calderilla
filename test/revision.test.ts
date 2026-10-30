// Casos que encontró la revisión independiente del código (octubre de 2026), para que no vuelvan.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { interpretarMovimientos } from "../src/bancos/enablebanking.ts";
import { BaseDatos } from "../src/datos/db.ts";
import { leerNumero } from "../src/dominio/dinero.ts";
import { categoriaPorReglas } from "../src/importar/extracto.ts";
import { cuotaLiberada } from "../src/reglas/ocio.ts";
import { parametrosPorDefecto } from "../src/reglas/parametros.ts";
import type { Situacion } from "../src/reglas/tipos.ts";
import { cerrarMes } from "../src/servicios/cierres.ts";
import { guardarSaldo } from "../src/servicios/cuentas.ts";
import { crearRecurrente, leerRecurrentes } from "../src/servicios/finanzas.ts";
import { coincidencia } from "../src/servicios/importacion.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { ocioGastadoEn } from "../src/servicios/situacion.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-revision-"));
after(() => rmSync(carpeta, { recursive: true, force: true }));

function base(nombre: string): BaseDatos {
  const bd = new BaseDatos(path.join(carpeta, `${nombre}.db`));
  prepararBase(bd);
  return bd;
}
const categoria = (bd: BaseDatos, nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
const fijo = { fin: null, esencial: true, clase: "fijo" as const, nota: null, prestamo: null };

describe("revisión", () => {
  it("0.125 es un decimal, 1.234 son miles", () => {
    assert.equal(leerNumero("0.125"), 0.125);
    assert.equal(leerNumero("1.234"), 1234);
    assert.equal(leerNumero("12.345.678"), 12345678);
    assert.equal(leerNumero("3.125"), 3125, "sin cero delante sigue siendo ambiguo: se lee como miles (por eso la TAE tiene tope)");
  });

  it("la regla más concreta gana: «uber eats» es restaurante, no transporte", () => {
    const reglas = [
      { patron: "uber ", categoriaId: 1 },
      { patron: "uber eats", categoriaId: 2 },
    ];
    assert.equal(categoriaPorReglas("UBER EATS MADRID", reglas), 2);
    assert.equal(categoriaPorReglas("UBER BV TRIP", reglas), 1);
  });

  it("del banco: dos movimientos iguales sin referencia no se pisan y se respeta el signo", () => {
    const { movimientos } = interpretarMovimientos({
      transactions: [
        { transaction_amount: { amount: "1.50" }, credit_debit_indicator: "DBIT", booking_date: "2026-10-18", remittance_information: ["CAFE"] },
        { transaction_amount: { amount: "1.50" }, credit_debit_indicator: "DBIT", booking_date: "2026-10-18", remittance_information: ["CAFE"] },
        { transaction_amount: { amount: "-25.00" }, booking_date: "2026-10-19", remittance_information: ["SIN INDICADOR"] },
      ],
    });
    assert.notEqual(movimientos[0]?.idExterno, movimientos[1]?.idExterno);
    assert.equal(movimientos[2]?.importe, -2500);
  });

  it("la cuota de un préstamo se libera desde el mes siguiente a su último cargo", () => {
    const s = { hoy: "2026-10-06", prestamosTerminados: [{ nombre: "Coche", cuota: 25000, fin: "2026-10-05" }] } as Situacion;
    assert.equal(cuotaLiberada(s, parametrosPorDefecto()), 0, "en octubre la cuota aún está en los gastos");
    assert.equal(cuotaLiberada({ ...s, hoy: "2026-11-02" }, parametrosPorDefecto()), 25000);
    assert.equal(cuotaLiberada({ ...s, hoy: "2027-02-02" }, parametrosPorDefecto()), 0, "pasados 3 meses ya no");
  });

  it("emparejar con gastos fijos: una vez por cargo y sin contradecir a una regla", () => {
    const bd = base("emparejar");
    crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Móvil", categoriaId: categoria(bd, "Suministros"), frecuencia: "mensual", inicio: "2026-01-05", importe: 5000 });
    const recurrentes = leerRecurrentes(bd);
    const usados = new Map<number, string[]>();
    assert.equal(coincidencia({ fecha: "2026-10-03", importe: -4900 }, recurrentes, usados, categoria(bd, "Restaurantes")), null, "un restaurante no es la factura del móvil");
    assert.equal(coincidencia({ fecha: "2026-10-05", importe: -5000 }, recurrentes, usados)?.nombre, "Móvil");
    assert.equal(coincidencia({ fecha: "2026-10-06", importe: -5000 }, recurrentes, usados), null, "el cargo de octubre ya tiene su movimiento");
    bd.cerrar();
  });

  it("un gasto fijo de categoría ocio no se cuenta dos veces en el ocio del mes", () => {
    const bd = base("ocio");
    const ocio = categoria(bd, "Ocio");
    const id = crearRecurrente(bd, { ...fijo, esencial: false, tipo: "gasto", nombre: "Pádel", categoriaId: ocio, frecuencia: "mensual", inicio: "2026-01-02", importe: 6000 });
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, recurrente_id) VALUES ('2026-10-02', -6000, 'CLUB PADEL', ?, ?)", ocio, id);
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id) VALUES ('2026-10-10', -1500, 'CINE', ?)", ocio);
    assert.equal(ocioGastadoEn(bd, "2026-10-30"), 1500);
    bd.cerrar();
  });

  it("el ahorro real cuenta lo devuelto de un préstamo y reparte los gastos anuales como el presupuesto", () => {
    const bd = base("cierres");
    crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", categoriaId: null, frecuencia: "mensual", inicio: "2026-01-28", importe: 200000 });
    crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Seguro", categoriaId: null, frecuencia: "anual", inicio: "2026-03-15", importe: 72000 });
    const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
    // Febrero: 10.000 €. Marzo: cobra 2.000 y paga el seguro de 720, sin gastar nada más
    guardarSaldo(bd, cuenta, "2026-01-01", 0);
    cerrarMes(bd, "2026-02", [{ cuentaId: cuenta, saldo: 1_000_000 }]);
    const marzo = cerrarMes(bd, "2026-03", [{ cuentaId: cuenta, saldo: 1_128_000 }]);
    assert.equal(marzo.ahorro_real, 194_000, "2.000 − 60 al mes del seguro: lo mismo que pide el presupuesto");

    // Con un préstamo: pagar capital (aunque baje el saldo) no es «ahorrar menos»
    const bd2 = base("cierres-deuda");
    crearRecurrente(bd2, { ...fijo, tipo: "ingreso", nombre: "Nómina", categoriaId: null, frecuencia: "mensual", inicio: "2026-01-28", importe: 200000 });
    crearRecurrente(bd2, {
      ...fijo,
      tipo: "gasto",
      nombre: "Préstamo",
      categoriaId: null,
      frecuencia: "mensual",
      inicio: "2026-01-10",
      importe: 0,
      prestamo: { capital: 1_000_000, tin: 0, tae: null, plazoMeses: 10, comisionAmortizacion: 0, vinculado: false },
    });
    const c2 = bd2.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
    cerrarMes(bd2, "2026-02", [{ cuentaId: c2, saldo: 500_000 }]);
    // En marzo cobra 2.000 y paga la cuota de 1.000: el saldo sube 1.000, pero además debe 1.000 menos
    const conPrestamo = cerrarMes(bd2, "2026-03", [{ cuentaId: c2, saldo: 600_000 }]);
    assert.equal(conPrestamo.ahorro_real, 200_000);
    bd.cerrar();
    bd2.cerrar();
  });
});
