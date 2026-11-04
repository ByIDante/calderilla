// Prueba de Calderilla en el móvil (fase 0): Hono y SQLite (WebAssembly) dentro del service worker, con la base
// guardada en IndexedDB. Sirve para comprobar en un iPhone y un Android de verdad lo que no se puede asegurar
// leyendo documentación. No es la app: se tira cuando acabe la prueba.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { euros, importeEditable, leerImporte } from "../src/dominio/dinero.ts";

declare const __VERSION__: string;
declare const self: any;

const VERSION = __VERSION__;
const CACHE = `prueba-${VERSION}`;
const ESTATICOS = ["/pagina.js", "/htmx.min.js", "/estilos.css", "/sqlite3.wasm", "/manifest.webmanifest", "/icono-180.png", "/icono-192.png", "/icono-512.png"];

// ── Ciclo de vida: guarda lo necesario para funcionar sin conexión ──
self.addEventListener("install", (e: any) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESTATICOS.map((u) => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", (e: any) => {
  e.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) if (nombre !== CACHE) await caches.delete(nombre);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (e: any) => {
  if (e.data?.tipo === "activar") self.skipWaiting();
});

// ── IndexedDB: los bytes de la base y algunos valores ──
function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((resolver, fallar) => {
    const peticion = indexedDB.open("calderilla-prueba", 1);
    peticion.onupgradeneeded = () => peticion.result.createObjectStore("kv");
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => fallar(peticion.error);
  });
}
async function idb<T>(modo: IDBTransactionMode, accion: (almacen: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrirIdb();
  return new Promise((resolver, fallar) => {
    const tx = db.transaction("kv", modo, { durability: "strict" } as any);
    const peticion = accion(tx.objectStore("kv"));
    tx.oncomplete = () => resolver(peticion.result as T);
    tx.onerror = () => fallar(tx.error);
  });
}
const leer = <T>(clave: string) => idb<T | undefined>("readonly", (a) => a.get(clave));
const guardar = (clave: string, valor: unknown) => idb<void>("readwrite", (a) => a.put(valor, clave));

// ── SQLite: se arranca la primera vez que hace falta y queda en memoria hasta que el sistema para el service worker ──
interface Motor {
  sqlite3: any;
  db: any;
  tiempos: Record<string, number>;
  arranques: number;
}
let listo: Promise<Motor> | null = null;
const motor = () => (listo ??= iniciar());

async function iniciar(): Promise<Motor> {
  const t0 = performance.now();
  // El wasm sale del almacén del service worker: sus propias peticiones no pasan por su fetch, y sin conexión fallarían
  const respuesta = (await (await caches.open(CACHE)).match("/sqlite3.wasm")) ?? (await fetch("/sqlite3.wasm"));
  const bytesWasm = await respuesta.arrayBuffer();
  const t1 = performance.now();
  const sqlite3 = await sqlite3InitModule({
    print: () => {},
    printErr: () => {},
    instantiateWasm(imports: WebAssembly.Imports, exito: (instancia: WebAssembly.Instance, modulo: WebAssembly.Module) => void) {
      WebAssembly.instantiate(bytesWasm, imports).then((r) => exito(r.instance, r.module));
      return {};
    },
  } as any);
  const t2 = performance.now();
  const db = new sqlite3.oo1.DB(":memory:");
  const guardada = await leer<Uint8Array>("base");
  if (guardada) {
    const p = sqlite3.wasm.allocFromTypedArray(guardada);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      p,
      guardada.byteLength,
      guardada.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    db.checkRc(rc);
  }
  db.exec("CREATE TABLE IF NOT EXISTS apuntes (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, importe INTEGER NOT NULL, concepto TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS relleno (id INTEGER PRIMARY KEY, texto TEXT)");
  const t3 = performance.now();
  const arranques = ((await leer<number>("arranques")) ?? 0) + 1;
  await guardar("arranques", arranques);
  return {
    sqlite3,
    db,
    arranques,
    tiempos: { "leer el wasm": t1 - t0, "arrancar SQLite": t2 - t1, "abrir la base": t3 - t2, total: t3 - t0, "bytes de la base": guardada?.byteLength ?? 0 },
  };
}

/** Guarda la base entera en IndexedDB (antes de responder) y dice cuánto tardó */
async function persistir(m: Motor): Promise<{ exportar: number; guardar: number; bytes: number }> {
  const t0 = performance.now();
  const bytes: Uint8Array = m.sqlite3.capi.sqlite3_js_db_export(m.db);
  const t1 = performance.now();
  await guardar("base", bytes);
  const t2 = performance.now();
  const medida = { exportar: t1 - t0, guardar: t2 - t1, bytes: bytes.byteLength };
  await guardar("ultimoGuardado", medida);
  return medida;
}

// ── La app ──
type Entorno = { original: Request; evento: any };
const app = new Hono<{ Bindings: Entorno }>();
const ms = (n: number) => `${n.toFixed(0)} ms`;
const bien = (cierto: boolean, si: unknown, no: unknown) => (cierto ? html`<p class="ok">✓ ${si}</p>` : html`<p class="mal">✗ ${no}</p>`);

// Las mismas cabeceras de seguridad que en el PC (src/servidor/seguridad.ts), para ver que htmx y la página funcionan con ellas
app.use(async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});

function pagina(titulo: string, cuerpo: unknown) {
  return html`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#c27a3c" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icono-180.png" />
        <title>${titulo} · Prueba de Calderilla</title>
        <link rel="stylesheet" href="/estilos.css" />
        <script src="/htmx.min.js" defer></script>
        <script src="/pagina.js" defer></script>
      </head>
      <body>
        <header><a href="/">Prueba de Calderilla</a> <span class="version">versión ${VERSION}</span></header>
        <main>
          <h1>${titulo}</h1>
          ${cuerpo}
        </main>
      </body>
    </html>`;
}

// Los importes se escriben y se leen con el mismo código que en el PC: se comprueba que el móvil da lo mismo que Node
const FORMATO: [number, string][] = [
  [123450, "1.234,50\u00a0€"],
  [-5430, "-54,30\u00a0€"],
  [1234567, "12.345,67\u00a0€"],
];

app.get("/", async (c) => {
  const m = await motor();
  const formatoIgual = FORMATO.every(([centimos, texto]) => euros(centimos) === texto);
  const filas = m.db.selectObjects("SELECT fecha, importe, concepto FROM apuntes ORDER BY id DESC LIMIT 10");
  const total = m.db.selectValue("SELECT count(*) FROM apuntes");
  return c.html(
    pagina(
      "Funciona en tu móvil",
      html`<p class="ok">Esta página la ha hecho el service worker con SQLite dentro del móvil.</p>
        <ul class="pasos">
          <li><a href="/tiempos">S2 · S4 · Tiempos y almacenamiento</a></li>
          <li><a href="/cabeceras">S3 · Guardar y redirigir, y lo que ve el service worker</a></li>
          <li><a href="/subir">S5 · Subir un archivo</a></li>
          <li><a href="/compartir">S6 · Compartir un archivo</a></li>
          <li><a href="/drive">S7 · Google Drive y precios</a></li>
          <li><a href="/version">S8 · Actualizar a una versión nueva</a></li>
        </ul>
        <h2>Apunta algo (${total} apuntes guardados)</h2>
        <form method="post" action="/apuntes">
          <input name="concepto" placeholder="Concepto" required />
          <input name="importe" inputmode="decimal" placeholder="Importe, por ejemplo 1.234,56" required />
          <button type="submit">Guardar (formulario normal)</button>
        </form>
        <ul>
          ${filas.map((f: any) => html`<li>${f.fecha} · ${f.concepto} · ${euros(f.importe)}</li>`)}
        </ul>
        <div data-formato>
          ${bien(formatoIgual, "Los importes salen como en el PC", html`Los importes no salen como en el PC: ${FORMATO.map(([centimos]) => euros(centimos)).join(" · ")}`)}
        </div>
        <p class="nota">Cierra la app del todo (deslizando hacia arriba), vuelve a abrirla y mira que siguen aquí. Prueba también sin conexión.</p>`,
    ),
  );
});

app.post("/apuntes", async (c) => {
  const m = await motor();
  const f = await c.req.parseBody();
  const importe = leerImporte(String(f.importe ?? "")) ?? 0;
  m.db.exec({ sql: "INSERT INTO apuntes (fecha, importe, concepto) VALUES (?, ?, ?)", bind: [new Date().toISOString().slice(0, 16).replace("T", " "), importe, String(f.concepto ?? "")] });
  await persistir(m);
  return c.redirect("/?guardado=1", 303);
});

app.get("/tiempos", async (c) => {
  const m = await motor();
  const ultimo = await leer<Record<string, number>>("ultimoGuardado");
  const estimado = await (self.navigator.storage?.estimate?.() ?? Promise.resolve(null));
  const persistente = await (self.navigator.storage?.persisted?.() ?? Promise.resolve(null));
  return c.html(
    pagina(
      "Tiempos y almacenamiento",
      html`<p>Arranques del service worker con esta instalación: <b>${m.arranques}</b> (sube cada vez que el sistema lo para y lo vuelve a arrancar).</p>
        <table>
          ${Object.entries(m.tiempos).map(([k, v]) => html`<tr><td>${k}</td><td>${k.startsWith("bytes") ? `${v} B` : ms(v)}</td></tr>`)}
        </table>
        <h2>Último guardado</h2>
        ${ultimo ? html`<p>Exportar ${ms(ultimo.exportar!)} · guardar en IndexedDB ${ms(ultimo.guardar!)} · ${ultimo.bytes} bytes</p>` : html`<p>Aún nada.</p>`}
        <form method="post" action="/tiempos/llenar"><button type="submit">Llenar hasta unos 300 KB (como tu base) y medir</button></form>
        <h2>Almacenamiento</h2>
        <p>Persistente: <b data-persistente>${String(persistente)}</b> · Usado: ${estimado ? `${Math.round(estimado.usage / 1024)} KB de ${Math.round(estimado.quota / 1024 / 1024)} MB` : "no se sabe"}</p>
        <p class="nota">Desde el service worker no se puede pedir que sea persistente: lo pide la página al abrirse (el resultado sale abajo).</p>
        <p data-persistir></p>`,
    ),
  );
});

app.post("/tiempos/llenar", async (c) => {
  const m = await motor();
  const texto = "x".repeat(200);
  m.db.exec("BEGIN");
  for (let i = 0; i < 1400; i++) m.db.exec({ sql: "INSERT INTO relleno (texto) VALUES (?)", bind: [texto] });
  m.db.exec("COMMIT");
  await persistir(m);
  return c.redirect("/tiempos", 303);
});

// S3: guardar y redirigir, sin htmx y con él, y lo que ve el service worker de cada petición (para protegerse sin cookies)
function cabecerasDe(original: Request) {
  const filas: [string, string][] = [
    ["método", original.method],
    ["mode", original.mode],
    ["destination", original.destination],
    ["referrer", original.referrer],
    ["credentials", original.credentials],
    ...[...original.headers.entries()].map(([k, v]) => [`cabecera ${k}`, v] as [string, string]),
  ];
  return html`<details>
    <summary>Ver lo que vio el service worker</summary>
    <table>${filas.map(([k, v]) => html`<tr><td>${k}</td><td>${v || "—"}</td></tr>`)}</table>
  </details>`;
}
const deLaApp = (original: Request) => original.referrer.startsWith(`${self.location.origin}/`);
const hora = () => new Date().toLocaleTimeString("es-ES");

app.get("/cabeceras", (c) =>
  c.html(
    pagina(
      "Guardar y redirigir",
      html`<p>Tres formas de guardar un formulario. Cada una dice debajo si ha funcionado.</p>
        <h2>A · Formulario normal</h2>
        <p class="nota">Cambia de página y dice si el service worker sabe que viene de la app.</p>
        <form method="post" action="/cabeceras/enviado"><input name="dato" value="hola" /><button type="submit">Enviar (formulario normal)</button></form>
        <h2>B · Con htmx, cambiando solo un trozo</h2>
        <p class="nota">No cambia de página: debajo del botón tiene que salir un ✓ con la hora.</p>
        <form hx-post="/cabeceras/htmx" hx-target="#resultado-htmx"><input name="dato" value="hola" /><button type="submit">Enviar con htmx</button></form>
        <div id="resultado-htmx"></div>
        <h2>C · Con htmx, como guarda la app</h2>
        <p class="nota">Guarda y lleva a otra página sin recargar, como al guardar un gasto en el PC.</p>
        <div hx-boost="true">
          <form method="post" action="/cabeceras/guardar"><input name="dato" value="hola" /><button type="submit">Guardar con htmx</button></form>
        </div>`,
    ),
  ),
);
app.post("/cabeceras/enviado", (c) =>
  c.html(
    pagina(
      "A · Formulario normal",
      html`${bien(c.env.original.mode === "navigate", "Ha llegado como un formulario normal", `Ha llegado como «${c.env.original.mode}»`)}
        ${bien(deLaApp(c.env.original), "El service worker sabe que viene de una página de la app", "El service worker no sabe de dónde viene")}
        ${cabecerasDe(c.env.original)}
        <p><a href="/cabeceras/redirigir">Probar ahora una redirección</a> · <a href="/cabeceras">Volver</a></p>`,
    ),
  ),
);
app.post("/cabeceras/htmx", (c) =>
  c.html(
    html`${bien(c.req.header("hx-request") === "true", `htmx funciona: el service worker ha contestado sin recargar la página (${hora()})`, "Ha llegado, pero no como htmx")}
    ${bien(deLaApp(c.env.original), "El service worker sabe que viene de una página de la app", "El service worker no sabe de dónde viene")}
    ${cabecerasDe(c.env.original)}`,
  ),
);
app.post("/cabeceras/guardar", (c) => c.redirect("/cabeceras/llegada?desde=htmx", 303));
app.get("/cabeceras/redirigir", (c) => c.redirect("/cabeceras/llegada?desde=redireccion", 303));
app.get("/cabeceras/llegada", (c) => {
  const desde = c.req.query("desde");
  const conHtmx = c.req.header("hx-request") === "true";
  return c.html(
    pagina(
      "Has llegado",
      html`${desde === "htmx"
          ? bien(conHtmx, "Guardado con htmx y redirigido sin recargar la página", "Has llegado, pero recargando la página entera")
          : bien(true, "La redirección funciona", "")}
        <div data-direccion data-esperada="/cabeceras/llegada?desde=${desde}"></div>
        <p><a href="/cabeceras">Volver</a></p>`,
    ),
  );
});

// S5: subir un archivo, en multipart (lo normal) y en crudo (leído en la página). A usa el filtro del PC; Android a veces
// da a los CSV otro tipo («text/comma-separated-values») y los deja sin poder elegir, así que B prueba un filtro con los
// tipos además de las extensiones, y C ninguno
const ACEPTA_PC = ".csv,.txt,.xls,.xlsx,.ods";
const ACEPTA_AMPLIO = [
  ACEPTA_PC,
  "text/csv,text/comma-separated-values,application/csv,text/plain",
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet",
].join(",");
app.get("/subir", (c) =>
  c.html(
    pagina(
      "Subir un archivo",
      html`<p>Elige el extracto que descargas de la web de tu banco (.xls, .xlsx o .csv). Si no tienes ninguno, en <a href="/compartir">S6 · Compartir</a> pulsa «Descargar en CSV» y te queda uno en Descargas.</p>
        <p class="nota">El archivo no sale del móvil: la prueba solo mira que llega entero y no lo guarda.</p>
        <p>Prueba las tres y apunta en cuáles <b>te deja elegir el archivo</b>: es lo que más me interesa.</p>
        <h2>A · Formulario normal, con el filtro del PC</h2>
        <p class="nota">En iPhone puede fallar al subir: por eso están la B y la C, que son como lo hará la app.</p>
        <form method="post" action="/subir/multipart" enctype="multipart/form-data">
          <input type="file" name="archivo" accept="${ACEPTA_PC}" required data-medir />
          <input type="hidden" name="tamano" />
          <button type="submit">Subir</button>
        </form>
        <h2>B · Como lo hará la app, con un filtro más amplio</h2>
        <p class="nota">Se sube nada más elegirlo.</p>
        <input type="file" data-subir-crudo="amplio" accept="${ACEPTA_AMPLIO}" />
        <div data-resultado-crudo="amplio"></div>
        <h2>C · Como lo hará la app, sin filtro</h2>
        <p class="nota">Deja elegir cualquier archivo.</p>
        <input type="file" data-subir-crudo="todo" />
        <div data-resultado-crudo="todo"></div>`,
    ),
  ),
);
app.post("/subir/multipart", async (c) => {
  try {
    const f = await c.req.parseBody();
    const archivo = f.archivo as File | undefined;
    const llego = archivo && typeof archivo !== "string" ? archivo : null;
    const tamano = Number(f.tamano);
    return c.html(
      pagina(
        "A · Formulario normal",
        html`${bien(Boolean(llego) && llego!.size === tamano, `Ha llegado entero: «${llego?.name}», ${llego?.size} bytes`, llego ? `Ha llegado «${llego.name}» con ${llego.size} bytes, y pesaba ${tamano}` : "No ha llegado el archivo")}
          <p><a href="/subir">Volver</a></p>`,
      ),
    );
  } catch (error) {
    return c.html(pagina("A · Formulario normal", html`<p class="mal">✗ Falló al leer el formulario: ${String(error)}</p><p><a href="/subir">Volver</a></p>`));
  }
});
app.post("/subir/crudo", async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const nombre = decodeURIComponent(c.req.header("x-archivo") ?? "");
  return c.json({ nombre, bytes: bytes.byteLength });
});

// S6: sacar un archivo del móvil (como «Exportar a JSON»): compartirlo en JSON o en CSV, o descargarlo como en el PC
app.get("/compartir", (c) =>
  c.html(
    pagina(
      "Compartir un archivo",
      html`<p>Prueba los cuatro botones. Al compartir tiene que salir el menú del móvil (Drive, WhatsApp, «Guardar en Archivos»…); si lo cierras sin elegir nada también vale.</p>
        <p data-preparado class="nota">Preparando el archivo…</p>
        <p><button type="button" data-compartir="json" disabled>Compartir el JSON</button></p>
        <p data-resultado-compartir="json"></p>
        <p><button type="button" data-compartir="csv" disabled>Compartir en CSV</button></p>
        <p data-resultado-compartir="csv"></p>
        <p><a class="boton" href="/compartir/archivo?descargar=1">Descargar el JSON (como «Exportar» en el PC)</a></p>
        <p><a class="boton" href="/compartir/archivo.csv?descargar=1">Descargar en CSV</a></p>
        <p class="nota">Al descargar, mira si aparece en Descargas o en la app Archivos. El JSON es una copia de lo apuntado, no un extracto: para probar «Subir» usa el CSV.</p>`,
    ),
  ),
);
async function apuntesExportados() {
  return (await motor()).db.selectObjects("SELECT fecha, importe, concepto FROM apuntes ORDER BY id") as { fecha: string; importe: number; concepto: string }[];
}
app.get("/compartir/archivo", async (c) => {
  if (c.req.query("descargar")) c.header("Content-Disposition", `attachment; filename="calderilla-prueba.json"`);
  return c.json({ exportado: new Date().toISOString(), apuntes: await apuntesExportados() });
});
app.get("/compartir/archivo.csv", async (c) => {
  if (c.req.query("descargar")) c.header("Content-Disposition", `attachment; filename="calderilla-prueba.csv"`);
  const lineas = (await apuntesExportados()).map((a) => [a.fecha, a.concepto.replaceAll(";", ","), importeEditable(a.importe)].join(";"));
  return c.body(["fecha;concepto;importe", ...lineas].join("\n"), 200, { "Content-Type": "text/csv; charset=utf-8" });
});

// S7: Google Drive (el ID de cliente se escribe aquí durante la prueba) y precios
app.get("/drive", async (c) => {
  const cliente = (await leer<string>("cliente")) ?? "";
  const token = await leer<{ valor: string; caduca: number }>("token");
  const vigente = token && token.caduca > Date.now();
  return c.html(
    pagina(
      "Google Drive y precios",
      html`<form method="post" action="/drive/cliente">
          <label>ID de cliente de Google <input name="cliente" value="${cliente}" size="40" /></label>
          <button type="submit">Guardar</button>
        </form>
        ${cliente
          ? html`<p><a class="boton" href="/drive/conectar">${vigente ? "Volver a conectar" : "Conectar con Google Drive"}</a></p>
              <p>${vigente ? html`<span class="ok">Conectado (caduca a las ${new Date(token!.caduca).toLocaleTimeString("es-ES")})</span>` : "Sin conectar"}</p>`
          : html`<p class="nota">Pon primero el ID de cliente de Google.</p>`}
        ${vigente
          ? html`<form method="post" action="/drive/probar" data-una-vez><button type="submit">Buscar mis carpetas «copias» y probar leer, subir, renombrar y borrar</button></form>`
          : ""}
        <h2>Precios desde el móvil</h2>
        <form method="post" action="/drive/precios"><button type="submit">Probar CoinGecko, BCE y Frankfurter</button></form>`,
    ),
  );
});
app.post("/drive/cliente", async (c) => {
  await guardar("cliente", String((await c.req.parseBody()).cliente ?? "").trim());
  return c.redirect("/drive", 303);
});
app.get("/drive/conectar", async (c) => {
  const cliente = (await leer<string>("cliente")) ?? "";
  const estado = crypto.randomUUID();
  await guardar("estadoOauth", estado);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: cliente,
    redirect_uri: `${self.location.origin}/drive/vuelta`,
    response_type: "token",
    scope: "https://www.googleapis.com/auth/drive",
    state: estado,
    include_granted_scopes: "true",
    prompt: "consent",
  }).toString();
  return c.redirect(url.toString(), 302);
});
app.get("/drive/vuelta", (c) =>
  c.html(pagina("Volviendo de Google", html`<p data-vuelta-google>Guardando el permiso…</p><p class="nota">Si se queda aquí, la página no ha podido leer la respuesta de Google.</p>`)),
);
app.post("/drive/token", async (c) => {
  const datos = await c.req.json<{ access_token?: string; expires_in?: string; state?: string; error?: string }>();
  if (datos.error) return c.json({ ok: false, error: datos.error });
  if (!datos.state || datos.state !== (await leer<string>("estadoOauth"))) return c.json({ ok: false, error: "estado distinto" }, 400);
  await guardar("estadoOauth", null);
  await guardar("token", { valor: datos.access_token, caduca: Date.now() + Number(datos.expires_in ?? 3600) * 1000 });
  return c.json({ ok: true });
});

async function drive(ruta: string, opciones: RequestInit = {}): Promise<Response> {
  const token = await leer<{ valor: string }>("token");
  return fetch(`https://www.googleapis.com${ruta}`, { ...opciones, headers: { ...(opciones.headers as Record<string, string>), Authorization: `Bearer ${token?.valor}` } });
}
const enJson = async (r: Response) => ({ ok: r.ok, estado: r.status, datos: await r.json().catch(() => ({})) });
const esPrueba = (nombre: string) => nombre.startsWith("prueba-movil-");

app.post("/drive/probar", async (c) => {
  const pasos: [boolean, string, string][] = [];
  const paso = (ok: boolean, que: string, resultado: string) => pasos.push([ok, que, resultado]);
  const tabla = () =>
    c.html(
      pagina(
        "Prueba de Drive",
        html`<table>${pasos.map(([ok, k, v]) => html`<tr><td class="${ok ? "ok" : "mal"}">${ok ? "✓" : "✗"} ${k}</td><td>${v}</td></tr>`)}</table><p><a href="/drive">Volver</a></p>`,
      ),
    );
  try {
    // Cada carpeta «copias», con el nombre de la carpeta que la contiene y sus copias: se elige la que tiene la copia más nueva
    const q = encodeURIComponent("name = 'copias' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const carpetas = await enJson(await drive(`/drive/v3/files?q=${q}&fields=files(id,parents)&pageSize=20`));
    if (!carpetas.ok) return (paso(false, "Buscar carpetas «copias»", `${carpetas.estado} · ${JSON.stringify(carpetas.datos)}`), tabla());
    const encontradas: { id: string; ruta: string; copias: { id: string; name: string; size: string }[]; pruebas: { id: string; name: string }[] }[] = [];
    for (const carpeta of carpetas.datos.files ?? []) {
      const padre = carpeta.parents?.[0] ? (await enJson(await drive(`/drive/v3/files/${carpeta.parents[0]}?fields=name`))).datos.name : null;
      const q2 = encodeURIComponent(`'${carpeta.id}' in parents and trashed = false`);
      const archivos = (await enJson(await drive(`/drive/v3/files?q=${q2}&fields=files(id,name,size)&orderBy=name desc&pageSize=200`))).datos.files ?? [];
      encontradas.push({ id: carpeta.id, ruta: `${padre ?? "?"}/copias`, copias: archivos.filter((f: any) => f.name.endsWith(".db")), pruebas: archivos.filter((f: any) => esPrueba(f.name)) });
    }
    paso(encontradas.length > 0, "Carpetas «copias»", encontradas.map((f) => `${f.ruta} (${f.copias.length} ${f.copias.length === 1 ? "copia" : "copias"})`).join(" · ") || "ninguna");
    const carpeta = encontradas.filter((f) => f.copias.length).sort((x, y) => y.copias[0]!.name.localeCompare(x.copias[0]!.name))[0];
    if (!carpeta) return tabla();
    paso(true, "La que se usa", `${carpeta.ruta}: la última es ${carpeta.copias[0]!.name}`);

    // Los archivos de prueba que quedaron de otras veces (por ejemplo, si se tocó el botón dos veces) van a la papelera
    if (carpeta.pruebas.length) {
      const limpias = await Promise.all(carpeta.pruebas.map(async (f) => (await drive(`/drive/v3/files/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) })).ok));
      paso(limpias.every(Boolean), "Limpiar pruebas anteriores", `${limpias.filter(Boolean).length} de ${limpias.length} archivos a la papelera`);
    }

    const ultima = carpeta.copias[0]!;
    const t0 = performance.now();
    const bytes = new Uint8Array(await (await drive(`/drive/v3/files/${ultima.id}?alt=media`)).arrayBuffer());
    const cabecera = new TextDecoder().decode(bytes.slice(0, 15));
    paso(cabecera === "SQLite format 3", "Descargar la última", `${bytes.byteLength} bytes en ${ms(performance.now() - t0)}`);
    // Se abre con SQLite para ver que se lee (sin tocar la base de la prueba)
    const m = await motor();
    const otra = new m.sqlite3.oo1.DB(":memory:");
    const p = m.sqlite3.wasm.allocFromTypedArray(bytes);
    otra.checkRc(m.sqlite3.capi.sqlite3_deserialize(otra.pointer, "main", p, bytes.byteLength, bytes.byteLength, m.sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE));
    paso(true, "Abrirla con SQLite", `${otra.selectValue("SELECT count(*) FROM apuntes")} apuntes, esquema ${otra.selectValue("PRAGMA user_version")}`);
    otra.close();

    // Subir, renombrar y mandar a la papelera un archivo de prueba (no toca las copias)
    const limite = "calderilla" + Math.random().toString(36).slice(2);
    const meta = { name: `prueba-movil-${Date.now()}.txt`, parents: [carpeta.id] };
    const cuerpo = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${limite}\r\nContent-Type: text/plain\r\n\r\nPrueba de Calderilla desde el móvil\r\n--${limite}--`;
    const subido = await enJson(await drive("/upload/drive/v3/files?uploadType=multipart&fields=id,name", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body: cuerpo }));
    paso(subido.ok, "Subir un archivo de prueba", subido.ok ? subido.datos.name : `${subido.estado} · ${JSON.stringify(subido.datos)}`);
    if (!subido.ok) return tabla();
    const renombrado = await enJson(await drive(`/drive/v3/files/${subido.datos.id}?fields=name`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${meta.name}.renombrado` }) }));
    paso(renombrado.datos.name === `${meta.name}.renombrado`, "Renombrarlo", renombrado.ok ? renombrado.datos.name : `${renombrado.estado} · ${JSON.stringify(renombrado.datos)}`);
    const papelera = await enJson(await drive(`/drive/v3/files/${subido.datos.id}?fields=trashed`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }));
    paso(papelera.datos.trashed === true, "Mandarlo a la papelera", papelera.datos.trashed === true ? "hecho" : `${papelera.estado} · ${JSON.stringify(papelera.datos)}`);
  } catch (error) {
    paso(false, "Error", String(error));
  }
  return tabla();
});
app.post("/drive/precios", async (c) => {
  const probar = async (nombre: string, url: string) => {
    try {
      const r = await fetch(url);
      return [nombre, r.ok, `${r.status} · ${(await r.text()).slice(0, 120)}`] as const;
    } catch (error) {
      return [nombre, false, `falló: ${String(error)}`] as const;
    }
  };
  const filas = await Promise.all([
    probar("CoinGecko", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur"),
    probar("BCE", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata"),
    // Las mismas direcciones que usa el PC (src/precios/fuentes.ts)
    probar("Frankfurter", "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD"),
  ]);
  return c.html(
    pagina("Precios desde el móvil", html`<table>${filas.map(([k, ok, v]) => html`<tr><td class="${ok ? "ok" : "mal"}">${ok ? "✓" : "✗"} ${k}</td><td>${v}</td></tr>`)}</table><p><a href="/drive">Volver</a></p>`),
  );
});

// S8: versión nueva
app.get("/version", (c) =>
  c.html(
    pagina(
      "Actualizar",
      html`<p>Esta es la versión <b>${VERSION}</b>.</p>
        <p data-version-nueva>Buscando si hay una versión nueva…</p>
        <button type="button" data-activar-version hidden>Usar la versión nueva</button>`,
    ),
  ),
);

app.notFound((c) => c.html(pagina("No existe", html`<p>Esa página no está en la prueba. <a href="/">Volver</a></p>`), 404));
app.onError((error, c) => c.html(pagina("Algo falló", html`<p class="mal">${String(error)}</p><pre>${raw(String((error as Error).stack ?? "").replace(/</g, "&lt;"))}</pre>`), 500));

// ── Peticiones: solo las de esta misma web; lo estático sale del almacén ──
self.addEventListener("fetch", (evento: any) => {
  const peticion: Request = evento.request;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (ESTATICOS.includes(url.pathname)) {
    evento.respondWith(caches.match(url.pathname).then((r) => r ?? fetch(peticion)));
    return;
  }
  if (url.pathname === "/sw.js") return;
  evento.respondWith(
    (async () => {
      // Un Request nuevo y sencillo (el original trae modo «navigate», que no se puede reutilizar)
      const cuerpo = peticion.method === "GET" || peticion.method === "HEAD" ? undefined : await peticion.arrayBuffer();
      const copia = new Request(url.toString(), { method: peticion.method, headers: peticion.headers, body: cuerpo });
      return app.fetch(copia, { original: peticion, evento });
    })(),
  );
});
