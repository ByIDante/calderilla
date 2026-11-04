// El service worker: la app entera vive aquí. Guarda lo estático para funcionar sin conexión, arranca SQLite y la
// app la primera vez que hace falta, y atiende cada petición de la propia web (atender.ts). Es lo único que usa
// las APIs del service worker; todo lo demás se prueba en Node.
import type { Hono } from "hono";
import { raw } from "hono/html";
import { usarPlataforma } from "../../servidor/vistas/comun.ts";
import { almacenIndexedDb } from "../almacen.ts";
import { crearAppMovil } from "../app.ts";
import { atender } from "../atender.ts";
import { arrancar, type EstadoMovil } from "../estado.ts";
import { arrancarSqlite } from "../sqlite/motor.ts";

declare const __VERSION__: string;
/** Lo que se guarda al instalar (lo pone la construcción): estilos, scripts, iconos y sqlite3.wasm. */
declare const __ESTATICOS__: string[];

interface EventoExtensible extends Event {
  waitUntil(trabajo: Promise<unknown>): void;
}
interface EventoFetch extends EventoExtensible {
  request: Request;
  respondWith(respuesta: Promise<Response>): void;
}
interface EventoMensaje extends EventoExtensible {
  data: { tipo?: string } | null;
}
declare const self: {
  location: Location;
  navigator: Navigator;
  registration: ServiceWorkerRegistration;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(tipo: "install" | "activate", oyente: (evento: EventoExtensible) => void): void;
  addEventListener(tipo: "fetch", oyente: (evento: EventoFetch) => void): void;
  addEventListener(tipo: "message", oyente: (evento: EventoMensaje) => void): void;
};

const CACHE = `calderilla-${__VERSION__}`;
const ESTATICOS = new Set(__ESTATICOS__);
/** Las páginas sueltas (la política de privacidad y las condiciones): las sirve Cloudflare tal cual. */
const SUELTAS = new Set(["/privacidad", "/privacidad.html", "/condiciones", "/condiciones.html", "/legal.css"]);

usarPlataforma({
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
  cabecera: raw(
    '<link rel="manifest" href="/manifest.webmanifest" /><meta name="theme-color" content="#f6f4ef" /><link rel="apple-touch-icon" href="/icono-180.png" /><link rel="stylesheet" href="/estatico/movil.css" /><script src="/estatico/movil.js" defer></script>',
  ),
});

self.addEventListener("install", (evento) => {
  // «reload»: lo de esta versión, no lo que tenga guardado el navegador
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...ESTATICOS].map((ruta) => new Request(ruta, { cache: "reload" })))));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) if (nombre.startsWith("calderilla-") && nombre !== CACHE) await caches.delete(nombre);
      await self.clients.claim();
    })(),
  );
});

let lista: Promise<{ app: Hono; estado: EstadoMovil }> | null = null;

/** La app, arrancada una vez (hasta que el sistema pare el service worker). Si falla, se vuelve a intentar. */
function preparar() {
  lista ??= (async () => {
    const cache = await caches.open(CACHE);
    // Las peticiones del propio service worker no pasan por él: el wasm sale del almacén para funcionar sin conexión
    const wasm = await ((await cache.match("/sqlite3.wasm")) ?? (await fetch("/sqlite3.wasm"))).arrayBuffer();
    const estado = await arrancar({ almacen: almacenIndexedDb(), sqlite3: await arrancarSqlite(wasm), origen: self.location.origin });
    estado.version = __VERSION__;
    vigilarVersiones(estado);
    return { app: crearAppMovil(estado), estado };
  })();
  lista.catch(() => (lista = null));
  return lista;
}

/** Cuando se ha instalado una versión nueva, la banda lo avisa; al aceptar, pasa a ser la que responde. */
function vigilarVersiones(estado: EstadoMovil) {
  const registro = self.registration;
  const mirar = () => {
    if (registro.waiting) estado.versionNueva = "disponible";
  };
  mirar();
  registro.addEventListener("updatefound", () => registro.installing?.addEventListener("statechange", mirar));
  estado.activarVersion = () => registro.waiting?.postMessage({ tipo: "activar" });
}

self.addEventListener("message", (evento) => {
  const tipo = evento.data?.tipo;
  if (tipo === "activar") void self.skipWaiting();
  // Al pasar la app a segundo plano se sube ya lo pendiente; al volver, se mira si hay cambios de otro equipo
  if (tipo === "guardar-ya") evento.waitUntil(preparar().then(({ estado }) => estado.sync?.pendiente(true)));
  if (tipo === "mirar") evento.waitUntil(preparar().then(({ estado }) => estado.sync?.comprobarSiToca(0)));
});

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin || url.pathname === "/sw.js" || SUELTAS.has(url.pathname)) return;
  if (ESTATICOS.has(url.pathname)) {
    evento.respondWith(caches.match(url.pathname).then((guardado) => guardado ?? fetch(peticion)));
    return;
  }
  evento.respondWith(responder(evento));
});

async function responder(evento: EventoFetch): Promise<Response> {
  const peticion = evento.request;
  try {
    // Una copia sencilla: la original trae «navigate», que no se puede volver a usar para construir otra
    const cuerpo = peticion.method === "GET" || peticion.method === "HEAD" ? undefined : await peticion.arrayBuffer();
    const copia = new Request(peticion.url, { method: peticion.method, headers: peticion.headers, body: cuerpo });
    return await atender(copia, peticion, { origen: self.location.origin, preparar, esperar: (trabajo) => evento.waitUntil(trabajo), enLinea: () => self.navigator.onLine });
  } catch (error) {
    return new Response(`Calderilla no ha podido arrancar: ${String(error)}`, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
