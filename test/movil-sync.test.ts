// El móvil y el PC sobre la misma carpeta de copias: cada uno con su sincronización (la del móvil, asíncrona y
// contra Drive) y las mismas reglas. Lo que se apunta en uno llega al otro, y nada se pierde ni se pisa.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { leerNombre, type Copia } from "../src/datos/copias.ts";
import type { BaseDatos } from "../src/datos/db.ts";
import { Sincronizador } from "../src/datos/sync.ts";
import { arrancarSqlite } from "../src/movil/sqlite/motor.ts";
import type { ArchivoCarpeta } from "../src/movil/sync/carpeta.ts";
import { CarpetaDrive, ClienteDrive } from "../src/movil/sync/drive.ts";
import { SincronizadorMovil } from "../src/movil/sync/sincronizador.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { CarpetaLocal, driveFalso } from "./ayuda-carpetas.ts";

const raiz = mkdtempSync(path.join(os.tmpdir(), "calderilla-movil-sync-"));
process.env.CALDERILLA_CONFIG_DIR = raiz;
let sqlite3: Awaited<ReturnType<typeof arrancarSqlite>>;
before(async () => {
  sqlite3 = await arrancarSqlite();
});
after(() => rmSync(raiz, { recursive: true, force: true }));

const cuentas = (bd: BaseDatos) => bd.todos<{ nombre: string }>("SELECT nombre FROM cuentas ORDER BY nombre").map((c) => c.nombre);
const apuntar = (bd: BaseDatos, nombre: string) => bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES (?, 'corriente')", nombre);

/** Una carpeta de copias del disco con ganchos para hacer cosas mientras el móvil sube o descarga. */
class CarpetaConGanchos extends CarpetaLocal {
  alCrear: (() => void) | null = null;
  alLeer: (() => void) | null = null;

  override async crear(nombre: string, bytes: Uint8Array) {
    this.alCrear?.();
    this.alCrear = null;
    return super.crear(nombre, bytes);
  }

  override async leer(archivo: ArchivoCarpeta) {
    const bytes = await super.leer(archivo);
    this.alLeer?.();
    this.alLeer = null;
    return bytes;
  }
}

let escenarios = 0;
/** Un PC («Portátil») y un móvil sobre una carpeta nueva, con un reloj que solo avanza cuando se le pide. */
function escenario(opciones: { primeroElMovil?: boolean } = {}) {
  const carpeta = path.join(raiz, `escenario-${++escenarios}`);
  const copias = path.join(carpeta, "datos", "copias");
  let ahora = Date.parse("2026-01-05T09:00:00Z");
  const reloj = { ahora: () => new Date(ahora), avanzar: (minutos: number) => (ahora += minutos * 60_000) };
  const carpetaMovil = new CarpetaConGanchos(copias);
  const guardadas: Uint8Array[] = [];
  const movil = SincronizadorMovil.abrir(
    { carpeta: carpetaMovil, sqlite3, equipoId: "bbbbbbbb", equipoNombre: "Móvil", alAbrir: prepararBase, guardarLocal: async (bytes) => void guardadas.push(bytes), ahora: reloj.ahora },
    null,
  );
  const crearPc = () => new Sincronizador({ carpetaDatos: path.join(carpeta, "datos"), rutaTrabajo: path.join(carpeta, "pc.db"), equipoId: "aaaaaaaa", equipoNombre: "Portátil", alAbrir: prepararBase, ahora: reloj.ahora });
  return { movil, carpetaMovil, guardadas, reloj, copias, crearPc, archivos: () => readdirSync(copias).sort() };
}

/** Lo habitual: el PC empieza, el móvil se trae su copia. */
async function conectados() {
  const e = escenario();
  const pc = e.crearPc();
  pc.comprobar();
  await e.movil.comprobar();
  return { ...e, pc };
}

describe("el móvil y el PC sobre la misma carpeta", () => {
  it("primero el PC y luego el móvil: el móvil se trae lo del PC y avisa", async () => {
    const e = escenario();
    const pc = e.crearPc();
    apuntar(pc.bd, "Cuenta del PC");
    pc.comprobar();
    e.reloj.avanzar(1);
    const decision = await e.movil.comprobar();
    assert.equal(decision?.tipo, "descargar");
    assert.deepEqual(cuentas(e.movil.bd), ["Cuenta del PC"]);
    assert.match(e.movil.aviso ?? "", /guardados en «Portátil»/);
    assert.equal(e.movil.bd.leerMeta("equipo_nombre"), "Móvil", "la base local lleva el nombre de este equipo");
    assert.ok(e.guardadas.length, "y se ha guardado en el móvil");
    pc.cerrar();
  });

  it("primero el móvil y luego el PC: el PC se trae lo apuntado en el móvil", async () => {
    const e = escenario();
    await e.movil.comprobar();
    apuntar(e.movil.bd, "Cuenta del móvil");
    e.reloj.avanzar(1);
    assert.equal((await e.movil.comprobar())?.tipo, "enviar");
    const pc = e.crearPc();
    assert.equal(pc.comprobar()?.tipo, "descargar");
    assert.deepEqual(cuentas(pc.bd), ["Cuenta del móvil"]);
    pc.cerrar();
  });

  it("los cambios van y vienen sin conflictos", async () => {
    const { pc, movil, reloj } = await conectados();
    apuntar(movil.bd, "Del móvil");
    reloj.avanzar(1);
    await movil.comprobar();
    assert.equal(pc.comprobar()?.tipo, "descargar");
    apuntar(pc.bd, "Del PC");
    reloj.avanzar(1);
    pc.comprobar();
    assert.equal((await movil.comprobar())?.tipo, "descargar");
    assert.deepEqual(cuentas(movil.bd), ["Del PC", "Del móvil"]);
    assert.deepEqual(cuentas(pc.bd), ["Del PC", "Del móvil"]);
    assert.equal(pc.estado.tipo, "ok");
    assert.equal(movil.estado.tipo, "ok");
    pc.cerrar();
  });

  async function enConflicto() {
    const c = await conectados();
    apuntar(c.pc.bd, "Del PC");
    c.reloj.avanzar(1);
    c.pc.comprobar();
    apuntar(c.movil.bd, "Del móvil");
    c.reloj.avanzar(1);
    const decision = await c.movil.comprobar();
    assert.equal(decision?.tipo, "conflicto");
    assert.deepEqual(c.movil.estado.tipo === "conflicto" && c.movil.estado.localConCambios, true);
    const versionPc = (c.movil.estado as { versiones: Copia[] }).versiones[0]!;
    return { ...c, versionPc };
  }

  it("guardar en los dos a la vez da conflicto, y el móvil enseña cada versión", async () => {
    const { pc, movil, versionPc } = await enConflicto();
    assert.equal(versionPc.equipo, "aaaaaaaa");
    const delPc = await movil.resumen(versionPc);
    const local = await movil.resumen(null);
    assert.ok(delPc.nombres.includes("Cuenta: Del PC") && !delPc.nombres.includes("Cuenta: Del móvil"));
    assert.ok(local.nombres.includes("Cuenta: Del móvil"));
    assert.equal(delPc.equipo, "Portátil");
    pc.cerrar();
  });

  it("resolverlo en el móvil quedándose con lo suyo: el PC se lo trae y su versión sigue en las copias", async () => {
    const { pc, movil, archivos, versionPc } = await enConflicto();
    await movil.resolver("local");
    assert.equal(movil.estado.tipo, "ok");
    assert.match(movil.aviso ?? "", /Conflicto resuelto/);
    assert.equal(pc.comprobar()?.tipo, "descargar");
    assert.deepEqual(cuentas(pc.bd), ["Del móvil"]);
    assert.equal(pc.estado.tipo, "ok");
    assert.equal((await movil.comprobar())?.tipo, "nada");
    // Como en el PC: lo del móvil sale de la versión del PC, que queda como copia anterior (se puede volver a ella)
    assert.ok(archivos().includes(versionPc.archivo), "la del PC sigue en la carpeta");
    pc.cerrar();
  });

  it("resolverlo en el móvil eligiendo la del PC: lo del móvil queda apartado", async () => {
    const { pc, movil, versionPc, archivos } = await enConflicto();
    await movil.resolver(versionPc.archivo);
    assert.deepEqual(cuentas(movil.bd), ["Del PC"]);
    assert.equal(movil.estado.tipo, "ok");
    assert.ok(archivos().some((a) => a.startsWith("000000-") && a.includes("bbbbbbbb") && a.includes(".descartada-")), "lo del móvil, apartado");
    assert.equal(pc.comprobar()?.tipo, "nada");
    pc.cerrar();
  });

  async function enConflictoEnElPc() {
    const c = await conectados();
    apuntar(c.movil.bd, "Del móvil");
    c.reloj.avanzar(1);
    await c.movil.comprobar();
    apuntar(c.pc.bd, "Del PC");
    c.reloj.avanzar(1);
    assert.equal(c.pc.comprobar()?.tipo, "conflicto");
    const versionMovil = (c.pc.estado as { versiones: Copia[] }).versiones[0]!;
    assert.equal(versionMovil.equipo, "bbbbbbbb");
    return { ...c, versionMovil };
  }

  it("resolverlo en el PC eligiendo la del móvil: el móvil sigue sin conflicto", async () => {
    const { pc, movil, versionMovil } = await enConflictoEnElPc();
    pc.resolver(versionMovil.archivo);
    assert.deepEqual(cuentas(pc.bd), ["Del móvil"]);
    assert.equal((await movil.comprobar())?.tipo, "nada");
    assert.equal(movil.estado.tipo, "ok");
    pc.cerrar();
  });

  it("resolverlo en el PC quedándose con lo suyo: el móvil se lo trae", async () => {
    const { pc, movil } = await enConflictoEnElPc();
    pc.resolver("local");
    assert.equal((await movil.comprobar())?.tipo, "descargar");
    assert.deepEqual(cuentas(movil.bd), ["Del PC"]);
    assert.equal(movil.estado.tipo, "ok");
    assert.equal(pc.comprobar()?.tipo, "nada");
    pc.cerrar();
  });

  it("un año apuntando un día en cada uno: sin conflictos falsos y con la carpeta podada", async () => {
    const { pc, movil, reloj, archivos } = await conectados();
    for (let dia = 1; dia <= 365; dia++) {
      reloj.avanzar(24 * 60);
      if (dia % 2) {
        await movil.comprobar();
        apuntar(movil.bd, `Día ${dia}`);
        await movil.comprobar();
      } else {
        pc.comprobar();
        apuntar(pc.bd, `Día ${dia}`);
        pc.comprobar();
      }
      assert.equal(pc.estado.tipo, "ok", `día ${dia} en el PC`);
      assert.equal(movil.estado.tipo, "ok", `día ${dia} en el móvil`);
    }
    pc.comprobar();
    await movil.comprobar();
    assert.equal(cuentas(pc.bd).length, 365);
    assert.deepEqual(cuentas(movil.bd), cuentas(pc.bd));
    const copias = archivos().filter((a) => leerNombre(a));
    assert.ok(copias.length < 60, `quedan ${copias.length} copias de 365`);
    pc.cerrar();
  });

  it("lo apuntado mientras se sube una copia sale en la siguiente", async () => {
    const { pc, movil, carpetaMovil, reloj } = await conectados();
    apuntar(movil.bd, "Antes de subir");
    carpetaMovil.alCrear = () => apuntar(movil.bd, "Mientras sube");
    reloj.avanzar(1);
    await movil.comprobar();
    assert.equal(movil.estadoLocal().sucio, true, "sigue con cambios");
    reloj.avanzar(1);
    await movil.pendiente(true);
    assert.equal(movil.estadoLocal().sucio, false);
    assert.equal(pc.comprobar()?.tipo, "descargar");
    assert.deepEqual(cuentas(pc.bd), ["Antes de subir", "Mientras sube"]);
    pc.cerrar();
  });

  it("lo apuntado mientras se descarga no se pierde: se tira la descarga y queda en conflicto", async () => {
    const { pc, movil, carpetaMovil, reloj } = await conectados();
    apuntar(pc.bd, "Del PC");
    reloj.avanzar(1);
    pc.comprobar();
    carpetaMovil.alLeer = () => apuntar(movil.bd, "Mientras descarga");
    const decision = await movil.comprobar();
    assert.equal(decision?.tipo, "conflicto");
    assert.deepEqual(cuentas(movil.bd), ["Mientras descarga"]);
    pc.cerrar();
  });

  it("una copia de una versión más nueva del programa no se carga: avisa y deja los datos como estaban", async () => {
    const { pc, movil, reloj } = await conectados();
    apuntar(movil.bd, "Del móvil");
    reloj.avanzar(1);
    await movil.comprobar();
    pc.comprobar();
    pc.bd.script("PRAGMA user_version = 99");
    apuntar(pc.bd, "De la versión nueva");
    reloj.avanzar(1);
    pc.comprobar();
    await movil.comprobar();
    assert.equal(movil.estado.tipo, "error");
    assert.match(movil.estado.tipo === "error" ? movil.estado.mensaje : "", /versión más nueva de Calderilla/);
    assert.deepEqual(cuentas(movil.bd), ["Del móvil"]);
    pc.cerrar();
  });

  it("restaurar una copia anterior en el móvil la sube como versión nueva, y lo de antes queda apartado", async () => {
    const { pc, movil, reloj, archivos } = await conectados();
    apuntar(movil.bd, "Primera");
    reloj.avanzar(1);
    await movil.comprobar();
    const primera = archivos().filter((a) => leerNombre(a)).at(-1)!;
    apuntar(movil.bd, "Segunda");
    reloj.avanzar(1);
    await movil.comprobar();
    reloj.avanzar(1);
    await movil.restaurar(primera);
    assert.deepEqual(cuentas(movil.bd), ["Primera"]);
    assert.equal(movil.estadoLocal().sucio, false, "y ya se ha subido");
    assert.ok(archivos().some((a) => a.includes(".descartada-")));
    assert.equal(pc.comprobar()?.tipo, "descargar");
    assert.deepEqual(cuentas(pc.bd), ["Primera"]);
    pc.cerrar();
  });
});

describe("a través de Google Drive", () => {
  const conPermiso = () => Promise.resolve("bueno");

  it("dos móviles se sincronizan a través de Drive", async () => {
    const drive = driveFalso();
    const copias = drive.carpeta("copias");
    const nuevo = (equipoId: string, equipoNombre: string) =>
      SincronizadorMovil.abrir({ carpeta: new CarpetaDrive(new ClienteDrive(conPermiso, drive.pedir), copias), sqlite3, equipoId, equipoNombre, alAbrir: prepararBase, guardarLocal: async () => {} }, null);
    const mio = nuevo("bbbbbbbb", "Mi móvil");
    await mio.comprobar();
    apuntar(mio.bd, "Apuntada en mi móvil");
    await mio.comprobar();
    const otro = nuevo("cccccccc", "Otro móvil");
    assert.equal((await otro.comprobar())?.tipo, "descargar");
    assert.deepEqual(cuentas(otro.bd), ["Apuntada en mi móvil"]);
    assert.equal(drive.nombres(copias).filter((n) => leerNombre(n)).length, 2);
  });
});
