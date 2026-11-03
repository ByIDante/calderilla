// Tus suscripciones y la búsqueda en todos los meses de Movimientos.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, describe, it } from "node:test";
import { crearRecurrente, type DatosRecurrente } from "../src/servicios/finanzas.ts";
import { leerSuscripciones, marcarSuscripcion, pareceSuscripcion } from "../src/servicios/suscripciones.ts";
import { appDePrueba } from "./ayuda-app.ts";

const HOY = "2026-10-30";
const { bd, pedir, carpeta, estado } = appDePrueba(4741, HOY);
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});
const categoria = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
const gasto = (nombre: string, importe: number, extra: Partial<DatosRecurrente> = {}) =>
  crearRecurrente(bd, { tipo: "gasto", nombre, categoriaId: null, frecuencia: "mensual", inicio: "2025-01-05", fin: null, esencial: false, clase: "fijo", nota: null, importe, prestamo: null, ...extra });

describe("tus suscripciones", () => {
  it("reconoce las conocidas por su nombre y las de la categoría Suscripciones", () => {
    const de = (nombre: string, categoria: string | null = null, patron: string | null = null) => pareceSuscripcion({ nombre, categoria, patron });
    assert.ok(de("Netflix"));
    assert.ok(de("MovistarPlus"), "pegado a «plus»");
    assert.ok(de("Prime Video"));
    assert.ok(de("Cuota mensual", null, "spotify"), "por el texto con el que sale en el banco");
    assert.ok(de("Revista de fotografía", "Suscripciones"));
    assert.ok(!de("Gimnasio"));
    assert.ok(!de("Primera comunión de Lucía"));
  });

  const netflix = gasto("Netflix", 1299, { categoriaId: categoria("Ocio") });
  bd.ejecutar("INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, '2026-03-01', 1399)", netflix);
  const hbo = gasto("HBO Max", 6990, { frecuencia: "anual", inicio: "2025-12-15" });
  const spotify = gasto("Spotify", 1099);
  bd.ejecutar("INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, '2025-06-01', 1199)", spotify);
  const yoga = gasto("Clases de yoga", 2500);
  gasto("Alquiler", 75000, { esencial: true });
  gasto("Filmin", 999, { fin: "2026-05-05" });

  it("cuánto cuestan al año, cuándo se cobran y la última subida del último año", () => {
    const s = leerSuscripciones(bd, HOY);
    assert.deepEqual(s.lista.map((x) => x.nombre), ["Netflix", "Spotify", "HBO Max"], "de más a menos al año; la que terminó no sale");
    const n = s.lista.find((x) => x.id === netflix)!;
    assert.equal(n.alAnio, 16788);
    assert.equal(n.proximo, "2026-11-05");
    assert.deepEqual(n.subida, { antes: 1299, ahora: 1399, fecha: "2026-03-01" });
    assert.equal(s.lista.find((x) => x.id === spotify)!.subida, null, "subió hace más de un año");
    assert.equal(s.lista.find((x) => x.id === hbo)!.alAnio, 6990);
    assert.equal(s.alAnio, 16788 + 1199 * 12 + 6990);
    assert.deepEqual(s.posibles.map((x) => x.id), [yoga], "las pequeñas que no son esenciales, por si acaso; el alquiler no");
  });

  it("lo que dices tú manda: añadir una y quitar otra", async () => {
    const respuesta = await pedir(`/gastos/${yoga}/suscripcion`, { es: "1" });
    assert.equal(respuesta.status, 303);
    marcarSuscripcion(bd, hbo, false);
    const s = leerSuscripciones(bd, HOY);
    assert.ok(s.lista.some((x) => x.id === yoga && !x.automatica));
    assert.ok(!s.lista.some((x) => x.id === hbo) && !s.posibles.some((x) => x.id === hbo), "HBO Max ya no sale, ni como posible");
    const pagina = await (await pedir("/gastos/suscripciones")).text();
    assert.match(pagina, /Subió de 12,99\s€ a 13,99\s€ el 01\/03\/2026 \(\+12\s€ al año\)/);
    assert.match(pagina, /Clases de yoga/);
    assert.match(await (await pedir("/gastos")).text(), /href="\/gastos\/suscripciones"/);
  });
});

describe("buscar en todos los meses", () => {
  const ocio = categoria("Ocio");
  const apunte = (fecha: string, importe: number, concepto: string) =>
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, origen) VALUES (?, ?, ?, ?, 'manual')", fecha, importe, concepto, ocio).id;
  apunte("2026-08-03", -1500, "Bizum enviado · Jordi;Puig Serra");
  apunte("2026-09-03", -2000, "Bizum enviado · Jordi;Puig Serra");
  apunte("2026-10-03", -1000, "Bizum enviado · Jordi;Puig Serra");
  apunte("2026-10-10", 500, "Bizum recibido · Jordi;Puig Serra");
  const otro = apunte("2026-10-12", -800, "CINE");

  it("sin marcarlo busca en el mes que ves y ofrece buscar en todos", async () => {
    const pagina = await (await pedir("/movimientos?buscar=jordi")).text();
    assert.match(pagina, /«jordi» en octubre de 2026: <b>2 movimientos<\/b>/);
    assert.match(pagina, /href="\/movimientos\?mes=2026-10&amp;buscar=jordi&amp;todo=1">Buscar en todos los meses/);
  });

  it("en todos los meses, con cuánto sale y entra en total", async () => {
    const pagina = await (await pedir("/movimientos?buscar=jordi&todo=1")).text();
    assert.match(pagina, /<h1>Movimientos de todos los meses<\/h1>/);
    assert.match(pagina, /«jordi» en todos los meses: <b>4 movimientos<\/b>\s*· salen <b>45,00\s€<\/b>\s*· entran <b class="positivo">5,00\s€<\/b>/);
    assert.match(pagina, /03\/08\/2026/, "también los de agosto");
    assert.doesNotMatch(pagina, /href="\/movimientos\/\d+\?volver=[^"]*">CINE</, "lo que no casa no sale");
    assert.match(pagina, /name="todo" value="1" checked/);
  });

  it("en la ficha de cada movimiento se puede borrar (en el móvil la lista no lo enseña)", async () => {
    assert.match(await (await pedir(`/movimientos/${otro}`)).text(), new RegExp(`action="/movimientos/${otro}/borrar"`));
  });
});
