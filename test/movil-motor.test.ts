// SQLite en WebAssembly (el del móvil) frente a node:sqlite (el del PC): con los mismos datos tiene que dar
// exactamente lo mismo, también en las pantallas, y las copias de uno se tienen que abrir en el otro.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { HOY, sembrarEjemplo } from "../scripts/ejemplo.ts";
import { resumenDe, type Sincronia } from "../src/datos/copias.ts";
import { BaseDatos } from "../src/datos/db.ts";
import { arrancarSqlite, MotorWasm } from "../src/movil/sqlite/motor.ts";
import type { Estado } from "../src/servidor/estado.ts";
import { montar } from "../src/servidor/montar.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-motor-"));
process.env.CALDERILLA_CONFIG_DIR = carpeta;
let sqlite3: Awaited<ReturnType<typeof arrancarSqlite>>;
before(async () => {
  sqlite3 = await arrancarSqlite();
});
after(() => rmSync(carpeta, { recursive: true, force: true }));

const enWasm = () => new BaseDatos("en memoria", { motor: MotorWasm.vacio(sqlite3) });
const enNode = () => new BaseDatos(":memory:");

/** Todas las tablas con sus filas, salvo las horas de creación y del último cambio (salen del reloj). */
function volcado(bd: BaseDatos) {
  const tablas = bd.todos<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
  return {
    esquema: tablas,
    version: bd.version(),
    filas: Object.fromEntries(
      tablas
        .filter((t) => t.sql?.startsWith("CREATE TABLE"))
        .map((t) => [t.name, bd.todos(`SELECT * FROM "${t.name}" ${t.name === "meta" ? "WHERE clave NOT IN ('creada', 'modificado')" : ""} ORDER BY rowid`).map((fila) => ({ ...(fila as object) }))]),
    ),
  };
}

async function conEjemplo(bd: BaseDatos) {
  prepararBase(bd);
  await sembrarEjemplo(bd);
  return bd;
}

describe("SQLite en WebAssembly", () => {
  it("enlaza y devuelve los valores como node:sqlite", () => {
    const consulta = "SELECT typeof(?) AS a, ? / 2 AS b, typeof(?) AS c, ? AS d, typeof(?) AS e, ? AS f";
    const valores = [5, 5, 5.5, "texto con ñ y €", 2n ** 40n, null] as const;
    const node = enNode().uno(consulta, ...valores);
    const wasm = enWasm().uno(consulta, ...valores);
    assert.deepEqual(wasm, node);
    assert.equal(Object.getPrototypeOf(wasm), null, "filas sin prototipo, como en node:sqlite");
    assert.deepEqual(enWasm().ejecutar("SELECT 1"), { cambios: 0, id: 0 });
    assert.throws(() => enWasm().uno("SELECT ?", true as unknown as number), /cannot be bound/);
    assert.throws(() => enWasm().uno("SELECT * FROM no_existe"), (error: Error) => error.message === "no such table: no_existe");
  });

  it("las migraciones, las semillas y los datos de ejemplo dejan las mismas tablas", async () => {
    assert.deepEqual(volcado(await conEjemplo(enWasm())), volcado(await conEjemplo(enNode())));
  });

  it("las transacciones anidadas deshacen solo lo de dentro", () => {
    const bd = enWasm();
    prepararBase(bd);
    bd.transaccion(() => {
      bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Fuera', 'corriente')");
      assert.throws(() =>
        bd.transaccion(() => {
          bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Dentro', 'corriente')");
          throw new Error("falla");
        }),
      );
    });
    assert.deepEqual(
      bd.todos<{ nombre: string }>("SELECT nombre FROM cuentas").map((c) => c.nombre),
      ["Fuera"],
    );
  });

  it("una copia del PC se abre en el móvil, y la del móvil en el PC", async () => {
    const pc = await conEjemplo(new BaseDatos(path.join(carpeta, "pc.db")));
    pc.copiarA(path.join(carpeta, "copia-pc.db"));
    const enElMovil = new BaseDatos("copia", { motor: MotorWasm.desdeBytes(sqlite3, readFileSync(path.join(carpeta, "copia-pc.db"))) });
    assert.deepEqual(volcado(enElMovil), volcado(pc));

    const motor = MotorWasm.vacio(sqlite3);
    const movil = await conEjemplo(new BaseDatos("móvil", { motor }));
    movil.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Apuntada en el móvil', 'corriente')");
    writeFileSync(path.join(carpeta, "copia-movil.db"), motor.aBytes());
    const enElPc = new BaseDatos(path.join(carpeta, "copia-movil.db"), { soloLectura: true });
    assert.deepEqual(volcado(enElPc), volcado(movil));
    assert.ok(enElPc.uno("SELECT 1 FROM cuentas WHERE nombre = 'Apuntada en el móvil'"));
    for (const bd of [pc, enElMovil, movil, enElPc]) bd.cerrar();
  });

  it("cuenta los cambios: si no se mueve, no se ha tocado nada", () => {
    const motor = MotorWasm.vacio(sqlite3);
    const bd = new BaseDatos("móvil", { motor });
    prepararBase(bd);
    const antes = motor.cambiosTotales();
    bd.todos("SELECT * FROM cuentas");
    assert.equal(motor.cambiosTotales(), antes);
    bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nueva', 'corriente')");
    assert.ok(motor.cambiosTotales() > antes);
  });
});

/** Las pantallas comunes (las del móvil) sobre una base, con una sincronización que no hace nada. */
function pantallas(bd: BaseDatos) {
  const sync: Sincronia = {
    bd,
    estado: { tipo: "ok" },
    aviso: null,
    estadoLocal: () => ({ base: null, sucio: false }),
    comprobar: () => null,
    comprobarSiToca: () => {},
    programarEnvio: () => {},
    copiaDeSeguridad: () => {},
    restaurar: () => {},
    resolver: () => {},
    resumen: (copia) => resumenDe(bd, copia),
    cerrar: () => {},
  };
  const estado: Estado = { ajustes: { equipoId: "aaaaaaaa", equipoNombre: "Pruebas", coingeckoClave: null }, sync, hoy: () => HOY, errorFatal: null };
  const app = new Hono();
  montar(app, estado, { tarjetasEquipo: () => html`` });
  return (ruta: string) => app.request(`http://movil${ruta}`, { redirect: "manual" });
}

describe("las pantallas con SQLite en WebAssembly", () => {
  it("salen iguales que con node:sqlite", async () => {
    const node = await conEjemplo(enNode());
    const wasm = await conEjemplo(enWasm());
    const ids = { gasto: 1, apunte: node.uno<{ id: number }>("SELECT id FROM apuntes ORDER BY fecha DESC LIMIT 1")!.id, activo: 1 };
    const rutas = [
      "/", "/?mes=2026-09", "/anio", "/anio?anio=2025", "/gastos", "/gastos/detectar", "/gastos/suscripciones", "/gastos/nuevo", `/gastos/${ids.gasto}`, "/gastos/al-mes",
      "/ocio", "/movimientos", "/movimientos?buscar=consum&todo=1", `/movimientos/${ids.apunte}`, "/cuentas", "/cierre", "/inversiones", `/activos/${ids.activo}`, "/metas",
      "/calculadora", "/ajustes", "/ajustes?bruto=30000", "/ajustes/mercado", "/ajustes/parametros", "/ajustes/cuestionario", "/importar",
    ];
    const pedirNode = pantallas(node);
    const pedirWasm = pantallas(wasm);
    for (const ruta of rutas) {
      const [a, b] = [await pedirNode(ruta), await pedirWasm(ruta)];
      assert.equal(b.status, a.status, ruta);
      assert.equal(await b.text(), await a.text(), ruta);
    }
  });
});
