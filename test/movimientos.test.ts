import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, it } from "node:test";
import { appDePrueba } from "./ayuda-app.ts";

const app = appDePrueba(5197);
const { bd, pedir, carpeta, estado } = app;
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

it("meses anteriores y gasto por categoría mes a mes", async () => {
  const { gastoPorCategoriaMeses } = await import("../src/servicios/presupuesto.ts");
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id) VALUES ('2026-09-10', -4000, 'CINE', ?), ('2026-09-12', -20000, 'SUPER', ?)", categoria("Ocio"), categoria("Alimentación"));
  const datos = gastoPorCategoriaMeses(bd, "2026-10", 3);
  assert.deepEqual(datos.meses, ["2026-08", "2026-09", "2026-10"]);
  const alimentacion = datos.series.find((s) => s.nombre === "Alimentación");
  assert.deepEqual(alimentacion?.valores, [0, 20000, 32000], "incluye también los cargos de gastos fijos: es lo que salió de verdad");

  const septiembre = await (await pedir("/?mes=2026-09")).text();
  assert.match(septiembre, /Así fue septiembre de 2026/);
  assert.match(septiembre, /Este mes no se cerró/);
  assert.match(await (await pedir("/ocio?mes=2026-09")).text(), /CINE/);
  const actual = await (await pedir("/")).text();
  assert.match(actual, /grafico-gasto-meses/, "con dos meses de movimientos ya sale el gráfico");
  assert.match(actual, /href="\/\?mes=2026-09"/);
  assert.match(await (await pedir("/?mes=2027-01")).text(), /Resumen de octubre de 2026/, "un mes futuro muestra el actual");
});

it("pestañas por banco: cada una muestra solo sus movimientos y su saldo", async () => {
  const bbva = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad) VALUES ('Nómina', 'corriente', 'BBVA')").id;
  const tr = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad) VALUES ('Ahorro', 'remunerada', 'Trade Republic')").id;
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, cuenta_id) VALUES ('2026-10-21', -1111, 'SOLO BBVA', ?), ('2026-10-22', 2222, 'SOLO TR', ?)", bbva, tr);
  const todos = await (await pedir("/movimientos?mes=2026-10")).text();
  assert.match(todos, /aria-label="Elegir banco"/);
  assert.match(todos, /SOLO BBVA/);
  assert.match(todos, /SOLO TR/);
  const soloBbva = await (await pedir("/movimientos?mes=2026-10&banco=BBVA")).text();
  assert.match(soloBbva, /SOLO BBVA/);
  assert.doesNotMatch(soloBbva, /SOLO TR/);
  assert.match(soloBbva, /Saldo en BBVA/);
  assert.match(soloBbva, /href="\/movimientos\?mes=2026-09&amp;banco=BBVA"/, "al cambiar de mes se mantiene el banco elegido");
  const sinBanco = await (await pedir("/movimientos?mes=2026-10&banco=sin")).text();
  assert.doesNotMatch(sinBanco, /SOLO BBVA/);
  assert.match(sinBanco, /CINE|MERCADONA|Cena con amigos/);
});

it("mostrar solo gastos o solo ingresos, y las cifras de arriba filtran", async () => {
  const gastos = await (await pedir("/movimientos?mes=2026-10&tipo=gastos")).text();
  assert.match(gastos, /SOLO BBVA/);
  assert.doesNotMatch(gastos, /SOLO TR/, "un ingreso no sale entre los gastos");
  assert.match(gastos, /Solo ingresos/);
  const ingresos = await (await pedir("/movimientos?mes=2026-10&tipo=ingresos")).text();
  assert.match(ingresos, /SOLO TR/);
  assert.doesNotMatch(ingresos, /SOLO BBVA/);
  assert.match(ingresos, /Entradas<\/div><div class="cifra-valor positivo">/, "las cifras siguen mostrando el total del mes");

  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto) VALUES ('2026-10-25', -700, 'SIN CATEGORIA')");
  const todos = await (await pedir("/movimientos?mes=2026-10")).text();
  assert.match(todos, /href="\/movimientos\?mes=2026-10&amp;categoria=sin"/, "«Sin categoría» se puede pulsar");
  const sinCategoria = await (await pedir("/movimientos?mes=2026-10&categoria=sin")).text();
  assert.match(sinCategoria, /SIN CATEGORIA/);
  assert.doesNotMatch(sinCategoria, /Cena con amigos/, "los que ya tienen categoría no salen");
  assert.match(todos, /<details class="tarjeta" id="presupuesto" open data-recordar-plegado/, "el presupuesto se puede plegar");
});

it("al importar un Excel dice qué filas no entiende y enseña un ejemplo", async () => {
  const XLSX = await import("xlsx");
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    libro,
    XLSX.utils.aoa_to_sheet([
      ["Fecha", "Concepto", "Importe"],
      ["03/10/2026", "MERCADONA", "-200 EUR"],
      ["04/10/2026", "CINE", "pendiente"],
    ]),
    "Hoja",
  );
  const formulario = new FormData();
  formulario.set("archivo", new File([XLSX.write(libro, { type: "buffer", bookType: "xlsx" })], "extracto.xlsx"));
  const subida = await app.enviarArchivo("/importar", formulario);
  assert.equal(subida.status, 303);
  const revision = await (await pedir(subida.headers.get("location")!)).text();
  assert.match(revision, /1 movimientos/);
  assert.match(revision, /-200,00|−200,00/);
  assert.match(revision, /1 fila no tiene un importe que se entienda/);
  assert.match(revision, /en la fila 3 el importe es «pendiente»/);
});
