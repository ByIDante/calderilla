import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, it } from "node:test";
import { eurosRedondos } from "../src/dominio/dinero.ts";
import { crearRecurrente } from "../src/servicios/finanzas.ts";
import { contexto } from "../src/servicios/situacion.ts";
import { appDePrueba } from "./ayuda-app.ts";

const { bd, pedir, carpeta, estado } = appDePrueba(5193);
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});
const categoria = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
const fijo = { fin: null, esencial: true, clase: "fijo" as const, nota: null, prestamo: null, frecuencia: "mensual" as const, inicio: "2026-01-01" };

it("el resumen dice en una frase cuánto toca ahorrar y cuánto hay para ocio", async () => {
  crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", categoriaId: categoria("Nómina"), importe: 200000 });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Alquiler", categoriaId: categoria("Vivienda"), importe: 80000 });
  const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
  bd.ejecutar("INSERT INTO saldos (cuenta_id, fecha, saldo, origen) VALUES (?, '2026-10-01', 50000, 'manual')", cuenta);
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id) VALUES ('2026-10-10', -3000, 'CINE', ?)", categoria("Ocio"));

  const p = contexto(bd, "2026-10-30").resultado.presupuesto;
  assert.ok(p.objetivoAhorro > 0 && p.ocio > 0);
  let pagina = await (await pedir("/")).text();
  assert.match(pagina, /Tu mes en claro/);
  assert.ok(pagina.includes(`Este mes toca ahorrar <b>${eurosRedondos(p.objetivoAhorro)}</b> y tienes <b>${eurosRedondos(p.ocio + p.ocioRemanente)}</b> para ocio.`));
  assert.ok(pagina.includes(`Ocio: te quedan ${eurosRedondos(p.ocioQueda)}`));
  assert.ok(pagina.includes(`${eurosRedondos(3000)} de ${eurosRedondos(p.ocio + p.ocioRemanente)}`), "lo ya gastado en ocio");
  assert.match(pagina, /transferencia periódica/, "sin ahorro automático, sugiere ponerlo");
  assert.match(pagina, /Cuando cierres un mes/);

  // Con ahorro automático, dice cuánto falta por apartar a mano
  bd.ejecutar("INSERT INTO aportaciones (nombre, cuenta_id, importe, dia, inicio) VALUES ('Traspaso', ?, 10000, 1, '2026-01-01')", cuenta);
  pagina = await (await pedir("/")).text();
  assert.ok(pagina.includes(`Tu ahorro automático ya aparta ${eurosRedondos(10000)}: aparta tú los otros ${eurosRedondos(p.objetivoAhorro - 10000)}.`));

  // Y lo que de verdad ahorraste en el último cierre
  bd.ejecutar(
    `INSERT INTO cierres_mes (mes, cerrado, ingresos, gastos_esenciales, gastos_no_esenciales, ahorro_plan, ahorro_real, patrimonio, liquidez_libre, fondo_objetivo, ocio_plan, ocio_gastado, ocio_sobrante, etapa)
     VALUES ('2026-09', '2026-10-01', 200000, 80000, 0, 60000, 45000, 50000, 50000, 240000, 10000, 8000, 0, 'colchon')`,
  );
  pagina = await (await pedir("/")).text();
  assert.match(pagina, /En septiembre de 2026 ahorraste de verdad/);
});

it("si gastas más de lo que ingresas, lo dice en vez de proponer ahorro", async () => {
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Coche", categoriaId: categoria("Transporte"), importe: 150000 });
  const pagina = await (await pedir("/")).text();
  assert.match(pagina, /más de lo que ingresas<\/b>: no queda nada para ahorrar ni para ocio/);
  assert.doesNotMatch(pagina, /Este mes toca ahorrar/);
});
