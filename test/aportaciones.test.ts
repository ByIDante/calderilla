import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import { activaEn, leerAportaciones, registrarMes, totalMensual } from "../src/servicios/aportaciones.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-aportaciones-"));
after(() => rmSync(carpeta, { recursive: true, force: true }));

it("apunta lo aportado cada mes y, si el destino es un fondo, la compra", () => {
  const bd = new BaseDatos(path.join(carpeta, "a.db"));
  prepararBase(bd);
  const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad, tae) VALUES ('Ahorro', 'remunerada', 'Trade Republic', 2.25)").id;
  const fondo = bd.ejecutar("INSERT INTO activos (nombre, tipo) VALUES ('Fondo mundial', 'fondo')").id;
  bd.ejecutar("INSERT INTO precios (activo_id, fecha, precio, fuente) VALUES (?, '2026-10-01', 50, 'manual')", fondo);
  const traspaso = bd.ejecutar("INSERT INTO aportaciones (nombre, cuenta_id, importe, dia, inicio) VALUES ('Traspaso', ?, 30000, 1, '2026-01-01')", cuenta).id;
  const compra = bd.ejecutar("INSERT INTO aportaciones (nombre, activo_id, importe, dia, inicio, fin) VALUES ('Fondo', ?, 10000, 31, '2026-01-01', '2026-12-31')", fondo).id;

  const lista = leerAportaciones(bd);
  assert.equal(totalMensual(lista, "2026-10"), 40000);
  assert.equal(totalMensual(lista, "2027-01"), 30000, "la del fondo terminó en diciembre");
  assert.ok(!activaEn(lista.find((a) => a.id === compra)!, "2025-12"));

  // Octubre: el traspaso no se hizo; el fondo sí
  const octubre = registrarMes(bd, "2026-10", [
    { id: traspaso, importe: 0, cantidad: null },
    { id: compra, importe: 10000, cantidad: null },
  ]);
  assert.deepEqual(octubre.omitidas.map((a) => a.nombre), ["Traspaso"]);
  const movimiento = bd.uno<{ fecha: string; cantidad: number; importe: number }>("SELECT fecha, cantidad, importe FROM movimientos_cartera WHERE activo_id = ?", fondo);
  assert.deepEqual({ ...movimiento }, { fecha: "2026-10-31", cantidad: 2, importe: 10000 }, "100 € a 50 € la participación, el día 31");

  // Volver a cerrar el mes corrige, no duplica
  registrarMes(bd, "2026-10", [{ id: compra, importe: 15000, cantidad: 2.9 }]);
  const compras = bd.todos<{ cantidad: number }>("SELECT cantidad FROM movimientos_cartera WHERE activo_id = ?", fondo);
  assert.deepEqual(compras.map((c) => c.cantidad), [2.9]);
  bd.cerrar();
});
