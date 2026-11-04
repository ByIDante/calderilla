// La app del móvil entera, como la ve el service worker, contra un Google Drive falso: la bienvenida, el permiso
// de Google, la seguridad sin cookies, guardar lo apuntado, subir archivos y que no quede ningún enlace roto.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { HOY, sembrarEjemplo } from "../scripts/ejemplo.ts";
import { leerNombre, nombreCopia } from "../src/datos/copias.ts";
import { BaseDatos } from "../src/datos/db.ts";
import { almacenEnMemoria } from "../src/movil/almacen.ts";
import { crearAppMovil } from "../src/movil/app.ts";
import { atender, CABECERA_CRUDO, type DatosCrudo } from "../src/movil/atender.ts";
import { arrancar, type EstadoMovil } from "../src/movil/estado.ts";
import { CLIENTE_GOOGLE, PERMISO_DRIVE } from "../src/movil/google.ts";
import { arrancarSqlite, MotorWasm } from "../src/movil/sqlite/motor.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { driveFalso } from "./ayuda-carpetas.ts";

const ORIGEN = "https://calderilla-app.pages.dev";
const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-movil-app-"));
process.env.CALDERILLA_CONFIG_DIR = carpeta;
after(() => rmSync(carpeta, { recursive: true, force: true }));

let sqlite3: Awaited<ReturnType<typeof arrancarSqlite>>;
let estado: EstadoMovil;
let esperando: Promise<unknown>[] = [];
const drive = driveFalso();
const copias = drive.carpeta("copias", drive.carpeta("Calderilla"));
drive.carpeta("copias", drive.carpeta("Fotos"));

before(async () => {
  sqlite3 = await arrancarSqlite();
  // La copia que dejó el PC en la carpeta de Drive
  const pc = new BaseDatos(path.join(carpeta, "pc.db"));
  prepararBase(pc);
  await sembrarEjemplo(pc);
  pc.escribirMeta("equipo_nombre", "Portátil");
  pc.copiarA(path.join(carpeta, "copia.db"));
  pc.cerrar();
  drive.archivo(nombreCopia(1, "20261029100000", "aaaaaaaa", null), copias, readFileSync(path.join(carpeta, "copia.db")));
  estado = await arrancar({ almacen: almacenEnMemoria(), sqlite3, origen: ORIGEN, pedir: drive.pedir, hoy: () => HOY });
  app = crearAppMovil(estado);
});
let app: ReturnType<typeof crearAppMovil>;

interface Opciones {
  cuerpo?: Record<string, string> | string | Uint8Array;
  cabeceras?: Record<string, string>;
  /** De dónde dice venir: por defecto, de una página de la app. */
  referrer?: string;
  destination?: string;
}

/** Una petición como la recibe el service worker. Sin cuerpo es un GET. */
async function pedir(ruta: string, opciones: Opciones = {}): Promise<Response> {
  const metodo = opciones.cuerpo === undefined ? "GET" : "POST";
  const cabeceras = new Headers(opciones.cabeceras);
  let cuerpo: BodyInit | undefined;
  if (typeof opciones.cuerpo === "object" && !(opciones.cuerpo instanceof Uint8Array)) {
    cuerpo = new URLSearchParams(opciones.cuerpo);
    cabeceras.set("content-type", "application/x-www-form-urlencoded");
  } else if (opciones.cuerpo !== undefined) {
    cuerpo = opciones.cuerpo as BodyInit;
  }
  const peticion = new Request(`${ORIGEN}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo, redirect: "manual" });
  const original = { method: metodo, destination: opciones.destination ?? "document", referrer: opciones.referrer ?? `${ORIGEN}/`, headers: cabeceras };
  return atender(peticion, original, { origen: ORIGEN, preparar: async () => ({ app, estado }), esperar: (trabajo) => esperando.push(trabajo) });
}
const texto = async (ruta: string, opciones?: Opciones) => (await pedir(ruta, opciones)).text();
/** El mensaje que lleva una redirección (?ok=… o ?error=…). */
const mensaje = (respuesta: Response) => {
  const consulta = new URL(respuesta.headers.get("location") ?? "/", ORIGEN).searchParams;
  return consulta.get("ok") ?? consulta.get("error") ?? "";
};
async function terminar() {
  await Promise.all(esperando);
  esperando = [];
}

async function conectarGoogle(datos: (estado: string) => Record<string, string>) {
  const respuesta = await pedir("/drive/conectar?volver=/bienvenida");
  const url = new URL(respuesta.headers.get("location")!);
  return pedir("/drive/token", { cuerpo: JSON.stringify(datos(url.searchParams.get("state")!)), cabeceras: { "content-type": "application/json" } });
}
const permisoBueno = (state: string) => ({ access_token: "bueno", expires_in: "3599", scope: `${PERMISO_DRIVE} openid`, state });

describe("la primera vez en el móvil", () => {
  it("sin carpeta todo lleva a la bienvenida, que empieza por conectar Drive", async () => {
    assert.equal((await pedir("/ocio")).headers.get("location"), "/bienvenida");
    const bienvenida = await texto("/bienvenida");
    assert.match(bienvenida, /Conecta tu Google Drive/);
    assert.match(bienvenida, /href="\/drive\/conectar\?volver=\/bienvenida"/);
  });

  it("«Conectar» lleva a Google con el cliente de Calderilla y vuelve a esta misma dirección", async () => {
    const respuesta = await pedir("/drive/conectar?volver=/bienvenida");
    assert.equal(respuesta.status, 302);
    const url = new URL(respuesta.headers.get("location")!);
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), CLIENTE_GOOGLE);
    assert.equal(url.searchParams.get("redirect_uri"), `${ORIGEN}/drive/vuelta`);
    assert.equal(url.searchParams.get("response_type"), "token");
    assert.equal(url.searchParams.get("scope"), PERMISO_DRIVE);
    assert.ok(url.searchParams.get("state"));
    assert.match(await texto("/drive/vuelta"), /data-vuelta-google/);
  });

  it("solo acepta el permiso de su propia petición y con Drive marcado", async () => {
    const otro = await (await conectarGoogle((state) => ({ ...permisoBueno(state), state: "otro" }))).json();
    assert.equal(otro.ok, false);
    const sinDrive = await (await conectarGoogle((state) => ({ ...permisoBueno(state), scope: "openid" }))).json();
    assert.match(sinDrive.error, /marca la casilla/);
    const negado = await (await conectarGoogle((state) => ({ error: "access_denied", state }))).json();
    assert.match(negado.error, /No has dado permiso/);
    assert.equal(estado.permiso, null);
    const bueno = await (await conectarGoogle(permisoBueno)).json();
    assert.deepEqual(bueno, { ok: true, volver: "/bienvenida" });
    assert.equal((estado as EstadoMovil).permiso?.token, "bueno");
    assert.equal((await estado.almacen.leer<{ token: string }>("permiso"))?.token, "bueno", "y se guarda en el móvil");
  });

  it("enseña las carpetas «copias» de tu Drive y, al elegir, se trae los datos del PC", async () => {
    const bienvenida = await texto("/bienvenida");
    assert.match(bienvenida, /Calderilla\/copias<\/b> <span class="apagado pequeno">1 copias · la última, del 29\/10\/2026/);
    assert.doesNotMatch(bienvenida, /Fotos\/copias/, "la que no tiene copias no sale");
    assert.match(bienvenida, /No tengo Calderilla en ningún ordenador/);
    const respuesta = await pedir("/bienvenida", { cuerpo: { carpeta: copias, nombre: "Móvil de pruebas" } });
    assert.equal(respuesta.status, 303);
    assert.equal(mensaje(respuesta), "Datos cargados desde «Calderilla/copias».");
    assert.ok(estado.sync);
    assert.equal(estado.ajustes.equipoNombre, "Móvil de pruebas");
    assert.match(await texto("/gastos"), /Nómina/);
    const guardada = await estado.almacen.leer<Uint8Array>("base");
    assert.ok(guardada && new BaseDatos("guardada", { motor: MotorWasm.desdeBytes(sqlite3, guardada) }).uno("SELECT 1 FROM recurrentes WHERE nombre = 'Nómina'"), "la base ya está guardada en el móvil");
  });
});

describe("la app en el móvil", () => {
  it("lo apuntado se guarda en el móvil antes de responder y luego sube a Drive", async () => {
    const respuesta = await pedir("/ocio/apunte", { cuerpo: { importe: "12,50", concepto: "Cine con amigos" } });
    assert.equal(respuesta.status, 303);
    const guardada = await estado.almacen.leer<Uint8Array>("base");
    const enElMovil = new BaseDatos("guardada", { motor: MotorWasm.desdeBytes(sqlite3, guardada!) });
    assert.ok(enElMovil.uno("SELECT 1 FROM apuntes WHERE concepto = 'Cine con amigos'"));
    await terminar();
    const subidas = drive.nombres(copias).map(leerNombre).filter((c) => c?.equipo === estado.ajustes.equipoId);
    assert.equal(subidas.length, 1, "una copia nueva, de este móvil");
    assert.equal(estado.sync!.estadoLocal().sucio, false);
  });

  it("sin cookies: rechaza los cambios que no vienen de sus páginas y que la abran dentro de otra", async () => {
    const de = (referrer: string, cabeceras: Record<string, string> = {}) => pedir("/ocio/apunte", { cuerpo: { importe: "1" }, referrer, cabeceras });
    assert.equal((await de("")).status, 403, "sin referrer ni origen");
    assert.equal((await de("https://otra-web.example/")).status, 403);
    assert.equal((await de("", { origin: "null" })).status, 403, "desde un marco aislado");
    assert.equal((await de("https://calderilla-app.pages.dev.otra-web.example/")).status, 403, "que solo empiece igual no vale");
    assert.equal((await de("", { origin: ORIGEN })).status, 303, "con su origen sí");
    assert.equal((await pedir("/", { destination: "iframe" })).status, 403);
    const pagina = await pedir("/");
    assert.equal(pagina.headers.get("x-frame-options"), "DENY");
    assert.match(pagina.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    await terminar();
  });

  it("los formularios con archivo llegan aunque el archivo venga «en crudo»", async () => {
    const exportado = await texto("/ajustes/exportar");
    const datos: DatosCrudo = { campo: "archivo", nombre: "calderilla.json", tipo: "application/json", campos: [] };
    const respuesta = await pedir("/ajustes/copias/importar", {
      cuerpo: new TextEncoder().encode(exportado),
      cabeceras: { [CABECERA_CRUDO]: encodeURIComponent(JSON.stringify(datos)), "content-type": "application/octet-stream" },
    });
    assert.equal(respuesta.status, 303);
    assert.match(mensaje(respuesta), /^Importado: \d+ registros/);
    const csv = "Fecha;Concepto;Importe\n02/10/2026;COMPRA SUPERMERCADO;-54,30\n";
    const extracto = await pedir("/importar", {
      cuerpo: new TextEncoder().encode(csv),
      cabeceras: { [CABECERA_CRUDO]: encodeURIComponent(JSON.stringify({ ...datos, nombre: "extracto.csv", tipo: "text/csv" })) },
    });
    assert.equal(extracto.status, 303);
    assert.match(extracto.headers.get("location") ?? "", /^\/importar\/[0-9a-f]{24}/, "pasa a elegir las columnas");
    await terminar();
  });

  it("Ajustes enseña «Este móvil» y nada de lo que solo tiene el PC", async () => {
    const ajustes = await texto("/ajustes");
    assert.match(ajustes, /<h2>Este móvil<\/h2>/);
    assert.match(ajustes, /Calderilla\/copias/);
    assert.match(ajustes, /conectado hasta las/);
    assert.doesNotMatch(ajustes, /Este ordenador|Cerrar Calderilla|\/bancos|Cambiar la carpeta de datos/);
    assert.match(await texto("/ajustes/copias"), /este móvil/);
    assert.equal((await pedir("/ajustes/movil", { cuerpo: { nombre: "Móvil de Laura" } })).status, 303);
    assert.equal(estado.sync!.bd.leerMeta("equipo_nombre"), "Móvil de Laura");
    await terminar();
  });

  it("ninguna página lleva a un enlace roto", async () => {
    const vistas = new Set<string>();
    const pendientes = ["/"];
    const fallos: string[] = [];
    while (pendientes.length && vistas.size < 400) {
      const ruta = pendientes.shift()!;
      if (vistas.has(ruta)) continue;
      vistas.add(ruta);
      const respuesta = await pedir(ruta);
      if (![200, 302, 303].includes(respuesta.status)) fallos.push(`${ruta} → ${respuesta.status}`);
      const tipo = respuesta.headers.get("content-type") ?? "";
      if (!tipo.includes("text/html")) continue;
      for (const [, enlace] of (await respuesta.text()).matchAll(/href="(\/[^"#]*)/g)) {
        const limpio = enlace!.replaceAll("&amp;", "&");
        // Los estáticos y la salida a Google no son páginas de la app
        if (!limpio.startsWith("/estatico/") && !limpio.startsWith("/drive/conectar") && !vistas.has(limpio)) pendientes.push(limpio);
      }
    }
    await terminar();
    assert.deepEqual(fallos, []);
    assert.ok(vistas.size > 30, `recorridas ${vistas.size} páginas`);
  });

  it("si el permiso de Google caduca, lo avisa y deja seguir apuntando", async () => {
    estado.permiso = { token: "bueno", caduca: estado.ahora() - 1 };
    await estado.sync!.comprobar();
    assert.match(await texto("/"), /Hay que volver a conectar Google Drive/);
    assert.equal((await pedir("/ocio/apunte", { cuerpo: { importe: "3", concepto: "Café sin conexión" } })).status, 303);
    await terminar();
    assert.equal(estado.sync!.estadoLocal().sucio, true, "queda pendiente de subir");
    const vuelta = await (await conectarGoogle((state) => permisoBueno(state))).json();
    assert.equal(vuelta.ok, true);
    await estado.sync!.pendiente(true);
    assert.equal(estado.sync!.estado.tipo, "ok");
    assert.equal(estado.sync!.estadoLocal().sucio, false, "y al volver a conectar se sube");
  });
});
