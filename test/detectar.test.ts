import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, it } from "node:test";
import { leerRecurrentes } from "../src/servicios/finanzas.ts";
import { calcularPropuestas } from "../src/servicios/periodicos.ts";
import { appDePrueba } from "./ayuda-app.ts";
import { cargarEjemplo } from "./movimientos-ejemplo.ts";

const app = appDePrueba(5192);
const { bd, pedir, carpeta, estado } = app;
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});
const { tr } = cargarEjemplo(bd);
const destino = (r: Response) => decodeURIComponent(r.headers.get("location") ?? "").replace(/\+/g, " ");

it("la pantalla enseña lo que se repite y el resumen avisa", async () => {
  const pagina = await (await pedir("/gastos/detectar")).text();
  assert.match(pagina, /Gastos que se repiten/);
  assert.match(pagina, /Ingresos que se repiten/);
  assert.match(pagina, /Dinero que pasas a tus cuentas cada mes/);
  assert.match(pagina, /Lo que gastas cada mes en cosas que varían/);
  assert.match(pagina, /value="Netflix"/);
  assert.match(pagina, /nada se crea sin que lo confirmes/);
  assert.match(pagina, /form="aceptar-propuestas"/);
  assert.ok(bd.uno("SELECT 1 FROM apuntes WHERE traspaso = 1"), "al abrirla se marcan los traspasos");
  assert.match(await (await pedir("/")).text(), /cosas que se repiten en tus movimientos/);
  assert.match(await (await pedir("/gastos")).text(), /Buscar en mis movimientos/);
});

it("añade lo marcado con el nombre que le pongas, ignora y explica lo que falta", async () => {
  const p = calcularPropuestas(bd, estado.hoy());
  const netflix = p.gastos.find((x) => x.periodico.nombre === "Netflix")!;
  const alquiler = p.gastos.find((x) => x.periodico.nombre.startsWith("Juan"))!;
  const enviar = (campos: [string, string][]) => {
    const formulario = new FormData();
    for (const [nombre, valor] of campos) formulario.append(nombre, valor);
    return app.enviarArchivo("/gastos/detectar", formulario);
  };

  const sinNada = await enviar([]);
  assert.match(destino(sinNada), /Marca primero/);

  // El alquiler sale por transferencia: se puede decir que es ahorro, pero sin cuenta de destino no vale
  const respuesta = await enviar([
    ["ids", netflix.id],
    [`nombre_${netflix.id}`, "Netflix Premium"],
    ["ids", alquiler.id],
    [`como_${alquiler.id}`, "ahorro:999"],
  ]);
  assert.match(destino(respuesta), /1 añadido a ingresos y gastos/);
  assert.match(destino(respuesta), /elige a qué cuenta va/);
  const creado = leerRecurrentes(bd).find((r) => r.nombre === "Netflix Premium");
  assert.ok(creado, "con el nombre elegido");
  assert.equal(creado.esencial, false, "sin marcar «Esencial», no lo es");
  assert.ok(!leerRecurrentes(bd).some((r) => r.nombre.startsWith("Juan")));

  // Ahora sí: el alquiler como gasto normal
  await enviar([["ids", alquiler.id], [`esencial_${alquiler.id}`, "1"]]);
  assert.equal(leerRecurrentes(bd).find((r) => r.nombre.startsWith("Juan"))?.esencial, true);

  const ahorro = calcularPropuestas(bd, estado.hoy()).ahorros[0]!;
  const ignorar = new FormData();
  ignorar.set("id", ahorro.id);
  assert.match(destino(await app.enviarArchivo("/gastos/detectar/ignorar", ignorar)), /no volverá a salir/);
  assert.equal(calcularPropuestas(bd, estado.hoy()).ahorros.length, 0);
  assert.equal(bd.uno("SELECT 1 FROM aportaciones WHERE cuenta_id = ?", tr), undefined);
});

it("en un movimiento se puede deshacer un traspaso y unirlo a mano a un gasto fijo", async () => {
  const [salida] = bd.todos<{ id: number; traspaso_par: number }>("SELECT id, traspaso_par FROM apuntes WHERE traspaso = 1 AND importe < 0 ORDER BY fecha DESC LIMIT 1");
  const pagina = await (await pedir(`/movimientos/${salida!.id}`)).text();
  assert.match(pagina, /Es un traspaso entre mis cuentas/);
  await pedir(`/movimientos/${salida!.id}/vinculo`, { recurrente: "", volver: "/movimientos" });
  const ambos = bd.todos<{ traspaso: number }>("SELECT traspaso FROM apuntes WHERE id IN (?, ?)", salida!.id, salida!.traspaso_par);
  assert.deepEqual(ambos.map((x) => x.traspaso), [0, 0], "si no es un traspaso, su pareja tampoco");

  const netflix = leerRecurrentes(bd).find((r) => r.nombre === "Netflix Premium")!;
  const suelto = bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto) VALUES ('2026-10-20', -1599, 'PAGO VARIOS')").id;
  await pedir(`/movimientos/${suelto}/vinculo`, { recurrente: String(netflix.id), volver: "/movimientos" });
  assert.deepEqual({ ...bd.uno<{ recurrente_id: number; vinculo_manual: number }>("SELECT recurrente_id, vinculo_manual FROM apuntes WHERE id = ?", suelto) }, { recurrente_id: netflix.id, vinculo_manual: 1 });
});
