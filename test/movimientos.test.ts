import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, it } from "node:test";
import { appDePrueba } from "./ayuda-app.ts";

const { bd, pedir, carpeta, estado } = appDePrueba(5197);
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});
const categoria = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;

it("se apuntan, recategorizan y editan movimientos, y una regla se aplica a los que ya había", async () => {
  assert.equal((await pedir("/movimientos", { tipo: "gasto", importe: "12,50", fecha: "2026-10-12", concepto: "PAGO TPV BAR PEPE", categoria: "" })).status, 303);
  await pedir("/movimientos", { tipo: "gasto", importe: "9", fecha: "2026-10-20", concepto: "PAGO TPV BAR PEPE", categoria: "" });
  await pedir("/movimientos", { tipo: "ingreso", importe: "2000", fecha: "2026-10-28", concepto: "NOMINA", categoria: String(categoria("Nómina")) });

  const pagina = await (await pedir("/movimientos?mes=2026-10")).text();
  assert.match(pagina, /PAGO TPV BAR PEPE/);
  assert.match(pagina, /data-enviar-al-cambiar/);

  const [primero] = bd.todos<{ id: number }>("SELECT id FROM apuntes WHERE concepto = 'PAGO TPV BAR PEPE' ORDER BY id");
  await pedir(`/movimientos/${primero!.id}/categoria`, { categoria: String(categoria("Restaurantes")), volver: "/movimientos?mes=2026-10" });
  assert.equal(bd.uno<{ c: number }>("SELECT categoria_id AS c FROM apuntes WHERE id = ?", primero!.id)?.c, categoria("Restaurantes"));

  const edicion = await (await pedir(`/movimientos/${primero!.id}`)).text();
  assert.match(edicion, /value="tpv bar"/, "propone una regla a partir del concepto");
  const regla = await pedir("/movimientos/reglas", { patron: "bar pepe", categoria: String(categoria("Restaurantes")), aplicar: "1", volver: "/movimientos?mes=2026-10" });
  assert.match(decodeURIComponent(regla.headers.get("location") ?? "").replace(/\+/g, " "), /aplicada a 2 movimientos/);
  assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE categoria_id = ?", categoria("Restaurantes"))?.n, 2);

  await pedir(`/movimientos/${primero!.id}?volver=/movimientos`, { tipo: "gasto", importe: "15", fecha: "2026-10-12", concepto: "Cena con amigos", categoria: String(categoria("Restaurantes")), cuenta: "" });
  assert.deepEqual({ ...bd.uno<{ importe: number; concepto: string }>("SELECT importe, concepto FROM apuntes WHERE id = ?", primero!.id) }, { importe: -1500, concepto: "Cena con amigos" });
  assert.equal((await pedir("/movimientos/9999/categoria", { categoria: "999999", volver: "https://otra.web" })).headers.get("location")?.startsWith("/movimientos"), true, "no redirige fuera");
});

it("presupuesto por categorías: límites, lo gastado sin los gastos fijos y avisos", async () => {
  const { avisosPresupuesto, presupuestoPorCategoria } = await import("../src/servicios/presupuesto.ts");
  const comida = categoria("Alimentación");
  bd.ejecutar("INSERT INTO recurrentes (tipo, nombre, categoria_id, frecuencia, inicio, esencial, clase) VALUES ('gasto', 'Comida', ?, 'mensual', '2026-01-01', 1, 'estimacion')", comida);
  const estimacion = bd.uno<{ id: number }>("SELECT id FROM recurrentes WHERE nombre = 'Comida'")!.id;
  bd.ejecutar("INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, '2026-01-01', 30000)", estimacion);
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id) VALUES ('2026-10-05', -18000, 'MERCADONA', ?), ('2026-10-15', -9000, 'LIDL', ?)", comida, comida);
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, recurrente_id) VALUES ('2026-10-01', -5000, 'CARGO FIJO', ?, ?)", comida, estimacion);

  const respuesta = await pedir("/presupuesto", { [`limite_${comida}`]: "250", volver: "/movimientos?mes=2026-10" });
  assert.equal(respuesta.status, 303);
  const linea = presupuestoPorCategoria(bd, "2026-10", "2026-10-20").find((l) => l.categoriaId === comida)!;
  assert.equal(linea.limite, 25000);
  assert.equal(linea.gastado, 27000, "los cargos de gastos fijos no cuentan");
  assert.equal(linea.sugerido, 30000, "propone lo que ya estimas en tus gastos");
  assert.match(avisosPresupuesto([linea])[0]?.texto ?? "", /Te has pasado del presupuesto de Alimentación/);
  assert.match(await (await pedir("/")).text(), /Presupuesto por categorías/);
  await pedir("/presupuesto", { [`limite_${comida}`]: "", volver: "/movimientos" });
  assert.equal(presupuestoPorCategoria(bd, "2026-10", "2026-10-20").find((l) => l.categoriaId === comida)?.limite, null, "vacío quita el límite");
});
