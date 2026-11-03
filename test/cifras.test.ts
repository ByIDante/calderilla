// Tu año en cifras, lo que sueles gastar en cada categoría, las reglas que valen solo para pagos o cobros y lo que
// cuenta de verdad un gasto compartido en Ocio.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import { categoriaPorReglas } from "../src/importar/extracto.ts";
import { resumenAnual } from "../src/servicios/anual.ts";
import { aplicarCategorias, proponerCategorias } from "../src/servicios/categorias.ts";
import { unirDevoluciones } from "../src/servicios/compartidos.ts";
import { crearRecurrente } from "../src/servicios/finanzas.ts";
import { importarDelBanco } from "../src/servicios/importacion.ts";
import { avisosPresupuesto, presupuestoPorCategoria } from "../src/servicios/presupuesto.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { appDePrueba } from "./ayuda-app.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-cifras-"));
const abiertas: BaseDatos[] = [];
after(() => {
  for (const bd of abiertas) bd.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});

function base(nombre: string): BaseDatos {
  const bd = new BaseDatos(path.join(carpeta, `${nombre}.db`));
  abiertas.push(bd);
  prepararBase(bd);
  return bd;
}
const categoria = (bd: BaseDatos, nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
const apunte = (bd: BaseDatos, fecha: string, importe: number, concepto: string, categoriaId: number | null = null) =>
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, origen) VALUES (?, ?, ?, ?, 'banco')", fecha, importe, concepto, categoriaId).id;

describe("reglas de categoría por signo", () => {
  it("una regla de pagos no categoriza lo que te llega, y la concreta gana a la de todos", () => {
    const reglas = [
      { patron: "jordi;puig", categoriaId: 1, signo: "gasto" as const },
      { patron: "jordi;puig", categoriaId: 2, signo: "ingreso" as const },
      { patron: "jordi", categoriaId: 3 },
    ];
    assert.equal(categoriaPorReglas("Bizum enviado · Jordi;Puig Serra", reglas, -1500), 1);
    assert.equal(categoriaPorReglas("Bizum recibido · Jordi;Puig Serra", reglas, 1500), 2);
    assert.equal(categoriaPorReglas("Bizum · Jordi;Puig", reglas), 3, "sin importe, solo las de todos");
    assert.equal(categoriaPorReglas("Bizum enviado · Jordi;Puig", [{ patron: "jordi;puig", categoriaId: 2, signo: "ingreso" }], -1500), null);
  });

  it("la regla de una propuesta vale solo para pagos (o cobros), también al traer del banco", () => {
    const bd = base("signo");
    const ocio = categoria(bd, "Ocio");
    const regalos = categoria(bd, "Regalos");
    for (const fecha of ["2026-07-02", "2026-08-02"]) apunte(bd, fecha, -1500, "Bizum enviado · Jordi;Puig Serra", ocio);
    apunte(bd, "2026-09-02", -2200, "Bizum enviado · Jordi;Puig Serra");
    const [p] = proponerCategorias(bd, "2026-10-20");
    assert.equal(p?.signo, "gasto");
    aplicarCategorias(bd, "2026-10-20", [{ clave: p!.clave, categoriaId: ocio, regla: true }]);
    // Para lo que te devuelve, otra regla con el mismo texto: las dos conviven
    bd.ejecutar("INSERT INTO reglas_categoria (patron, categoria_id, signo) VALUES (?, ?, 'ingreso')", p!.regla, regalos);
    const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
    importarDelBanco(
      bd,
      [
        { idExterno: "1", fecha: "2026-10-05", importe: -1800, concepto: "Bizum enviado · Jordi;Puig Serra" },
        { idExterno: "2", fecha: "2026-10-06", importe: 900, concepto: "Bizum recibido · Jordi;Puig Serra" },
      ],
      cuenta,
      "2026-10-20",
    );
    const de = (importe: number) => bd.uno<{ categoria_id: number }>("SELECT categoria_id FROM apuntes WHERE importe = ?", importe)!.categoria_id;
    assert.equal(de(-1800), ocio);
    assert.equal(de(900), regalos);
  });
});

describe("nombres de las categorías propuestas", () => {
  it("una persona con nombre y apellido; una tienda por su marca si solo sale en ella; si no, con dos palabras", () => {
    const bd = base("nombres");
    const [compras, restaurantes, ocio] = [categoria(bd, "Compras"), categoria(bd, "Restaurantes"), categoria(bd, "Ocio")];
    for (const fecha of ["2026-07-19", "2026-09-02"]) apunte(bd, fecha, -2599, "COMPRA TARJ 4589 FNAC SAN AGUSTIN", compras);
    apunte(bd, "2026-10-02", -1999, "COMPRA TARJ 4589 FNAC SAN AGUSTIN");
    for (const fecha of ["2026-07-10", "2026-08-10"]) apunte(bd, fecha, -4000, "RESTAURANTE LA MARINA", restaurantes);
    apunte(bd, "2026-10-10", -3500, "RESTAURANTE LA MARINA");
    apunte(bd, "2026-08-15", -2500, "RESTAURANTE CASA PEPE", restaurantes);
    for (const fecha of ["2026-07-02", "2026-08-02"]) apunte(bd, fecha, -1500, "Bizum enviado · Jordi;Puig Serra", ocio);
    apunte(bd, "2026-10-02", -2200, "Bizum enviado · Jordi;Puig Serra");
    apunte(bd, "2026-10-03", 1000, "Bizum recibido · Jordi;Puig Serra");
    apunte(bd, "2026-09-03", 1000, "Bizum recibido · Jordi;Puig Serra", ocio);
    const nombres = new Map(proponerCategorias(bd, "2026-10-20").map((p) => [p.nombre, p.regla]));
    assert.equal(nombres.get("Fnac"), "fnac", "la tienda es la marca, no «Fnac San»");
    assert.equal(nombres.get("Restaurante Marina"), "restaurante la marina", "«restaurante» solo no basta: también es Casa Pepe");
    assert.equal(nombres.get("Jordi Puig"), "jordi;puig");
    assert.ok(nombres.has("Jordi Puig (lo que te llega)"), [...nombres.keys()].join(", "));
  });
});

describe("lo que sueles gastar", () => {
  it("la media sale de los meses completos importados y avisa si este mes ya vas muy por encima", () => {
    const bd = base("media");
    const [restaurantes, alimentacion] = [categoria(bd, "Restaurantes"), categoria(bd, "Alimentación")];
    // Junio empieza a mitad de mes: no cuenta (estaría a medias)
    apunte(bd, "2026-06-20", -90000, "RESTAURANTE CARO", restaurantes);
    for (const [mes, importe] of [["2026-07", 3000], ["2026-08", 5000], ["2026-09", 4000]] as const) {
      apunte(bd, `${mes}-12`, -importe, "RESTAURANTE LA MARINA", restaurantes);
      for (const dia of ["03", "10", "17"]) apunte(bd, `${mes}-${dia}`, -2500, "CONSUM", alimentacion);
    }
    apunte(bd, "2026-10-04", -9000, "RESTAURANTE LA MARINA", restaurantes);
    const lineas = presupuestoPorCategoria(bd, "2026-10", "2026-10-20");
    const r = lineas.find((l) => l.categoriaId === restaurantes)!;
    assert.equal(r.mesesMedia, 3, "julio, agosto y septiembre");
    assert.equal(r.media, 4000);
    const avisos = avisosPresupuesto(lineas).map((a) => a.texto);
    assert.ok(avisos.some((t) => /En Restaurantes llevas 90\s€ este mes: un 125 % más/.test(t)), avisos.join("\n"));
    assert.ok(!avisos.some((t) => /Alimentación/.test(t)), "lo que va normal no avisa");
  });

  it("con menos de 2 meses no hay media", () => {
    const bd = base("sin-media");
    apunte(bd, "2026-10-04", -9000, "RESTAURANTE LA MARINA", categoria(bd, "Restaurantes"));
    assert.ok(presupuestoPorCategoria(bd, "2026-10", "2026-10-20").every((l) => l.media === null));
  });
});

describe("tu año en cifras", () => {
  it("lo que entró y salió cada mes, sin traspasos ni devoluciones, y frente a los mismos meses del año anterior", () => {
    const bd = base("anio");
    const [restaurantes, ocio, nomina] = [categoria(bd, "Restaurantes"), categoria(bd, "Ocio"), categoria(bd, "Nómina")];
    apunte(bd, "2025-03-28", 100000, "NOMINA", nomina);
    apunte(bd, "2025-03-15", -5000, "RESTAURANTE LA MARINA", restaurantes);
    apunte(bd, "2026-03-28", 120000, "NOMINA", nomina);
    apunte(bd, "2026-03-15", -8000, "RESTAURANTE LA MARINA", restaurantes);
    apunte(bd, "2026-04-28", 120000, "NOMINA", nomina);
    apunte(bd, "2026-04-10", -2000, "CINE", ocio);
    const cena = apunte(bd, "2026-04-18", -6000, "BRASERIA LA PLACA", restaurantes);
    unirDevoluciones(bd, cena, [apunte(bd, "2026-04-19", 4000, "Bizum recibido · Marta;Ruiz Vidal")]);
    bd.ejecutar("UPDATE apuntes SET traspaso = 1 WHERE id = ?", apunte(bd, "2026-04-02", -50000, "TRASPASO A MI CUENTA DE AHORRO"));
    const cierre = (mes: string, patrimonio: number) =>
      bd.ejecutar(
        `INSERT INTO cierres_mes (mes, cerrado, ingresos, gastos_esenciales, gastos_no_esenciales, ahorro_plan, ahorro_real, patrimonio, liquidez_libre, fondo_objetivo, ocio_plan, ocio_gastado, ocio_sobrante, etapa)
         VALUES (?, '2026-05-01', 0, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, 'colchon')`,
        mes,
        patrimonio,
      );
    cierre("2026-03", 300000);
    cierre("2026-04", 410000);

    const a = resumenAnual(bd, 2026, "2026-05-10");
    assert.deepEqual(
      a.meses.map((m) => m.mes),
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"],
      "hasta el mes en curso",
    );
    assert.equal(a.mesesConDatos, 2);
    assert.equal(a.ingresos, 240000, "lo que te devolvieron de la cena no es un ingreso");
    assert.equal(a.gastos, 12000, "el traspaso no cuenta y la cena cuenta solo lo tuyo");
    assert.equal(a.ocio, 12000, "restaurantes y cine son ocio");
    assert.deepEqual(a.comparacion, { meses: ["2025-03"], ahora: { ingresos: 120000, gastos: 8000 }, antes: { ingresos: 100000, gastos: 5000 } }, "solo marzo tiene datos en los dos años");
    const r = a.categorias.find((c) => c.nombre === "Restaurantes")!;
    assert.deepEqual({ ...r }, { nombre: "Restaurantes", total: 10000, comparable: 8000, anterior: 5000 });
    assert.deepEqual(a.patrimonio, { desde: "2026-03", inicio: 300000, hasta: "2026-04", fin: 410000 });
    assert.equal(a.primerAnio, 2025);
    assert.equal(resumenAnual(bd, 2024, "2026-05-10").mesesConDatos, 0);
  });
});

describe("pantallas", () => {
  const HOY = "2026-10-30";
  const { bd, pedir, carpeta: carpetaApp, estado } = appDePrueba(4733, HOY);
  after(() => {
    estado.sync?.cerrar();
    rmSync(carpetaApp, { recursive: true, force: true });
  });

  it("Ocio enseña lo que cuenta de una cena compartida, y su devolución ya restada", async () => {
    const cena = apunte(bd, "2026-10-24", -14000, "BRASERIA LA PLACA", categoria(bd, "Restaurantes"));
    unirDevoluciones(bd, cena, [apunte(bd, "2026-10-25", 10500, "Bizum recibido · Marta;Ruiz Vidal")]);
    const pagina = await (await pedir("/ocio")).text();
    assert.match(pagina, /35,00\s€\s*<span class="apagado pequeno nota-cambio">pagaste 140,00\s€, te devolvieron 105,00\s€/);
    assert.match(pagina, /ya restado de «BRASERIA LA PLACA»/);
    assert.match(await (await pedir("/ocio?mes=2026-09")).text(), /Ocio de septiembre/);
  });

  it("la lista de gastos dice cuándo toca la cuota final", async () => {
    crearRecurrente(bd, {
      tipo: "gasto",
      nombre: "Moto",
      categoriaId: null,
      frecuencia: "mensual",
      inicio: "2024-01-05",
      fin: null,
      esencial: true,
      clase: "fijo",
      nota: null,
      importe: 0,
      prestamo: { capital: 520000, tin: 6.25, tae: null, plazoMeses: 36, comisionAmortizacion: 0, vinculado: false, cuotaFinal: 290000 },
    });
    assert.match(await (await pedir("/gastos")).text(), /y la cuota final de 2\.900,00\s€ el 05\/01\/2027/);
  });

  it("tu año en cifras y lo que sueles gastar", async () => {
    const pagina = await (await pedir("/anio")).text();
    assert.match(pagina, /Tu 2026 en cifras/);
    assert.match(pagina, /En qué se fue/);
    assert.match(await (await pedir("/anio?anio=1999")).text(), /Tu 2026 en cifras/, "un año que no vale lleva al actual");
    assert.match(await (await pedir("/")).text(), /href="\/anio\?anio=2026"/);
  });
});
