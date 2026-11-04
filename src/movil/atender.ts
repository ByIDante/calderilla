import type { Hono } from "hono";
import { aviso, pagina } from "../servidor/vistas/comun.ts";
import { CABECERA_CRUDO, type DatosCrudo } from "./crudo.ts";
import type { EstadoMovil } from "./estado.ts";
import { CABECERAS_SEGURIDAD, motivoParaRechazar, type PeticionVista } from "./seguridad.ts";

/** Rehace el formulario de un archivo subido «en crudo» (crudo.ts), tal cual: la ruta no se entera. */
export async function desdeCrudo(peticion: Request): Promise<Request> {
  const cabecera = peticion.headers.get(CABECERA_CRUDO);
  if (!cabecera) return peticion;
  const datos = JSON.parse(decodeURIComponent(cabecera)) as DatosCrudo;
  const formulario = new FormData();
  for (const [nombre, valor] of datos.campos) formulario.append(nombre, valor);
  formulario.append(datos.campo, new File([await peticion.arrayBuffer()], datos.nombre, { type: datos.tipo }));
  const cabeceras = new Headers(peticion.headers);
  cabeceras.delete(CABECERA_CRUDO);
  // Sin content-type: lo pone el propio FormData, con su separador
  cabeceras.delete("content-type");
  return new Request(peticion.url, { method: peticion.method, headers: cabeceras, body: formulario });
}

export interface Contexto {
  origen: string;
  /** La app lista (la primera vez arranca SQLite y abre lo guardado). */
  preparar: () => Promise<{ app: Hono; estado: EstadoMovil }>;
  /** Para que el sistema no pare el service worker con algo a medias (FetchEvent.waitUntil). */
  esperar: (trabajo: Promise<unknown>) => void;
  /** Si hay conexión: sin ella no se intenta renovar el permiso de Google. */
  enLinea?: () => boolean;
}

/**
 * Al abrir una página con el permiso de Google caducado, se renueva sin preguntar: Google vuelve enseguida a la
 * misma página. Solo con conexión, con la carpeta ya elegida y si la última vez no falló.
 */
function hayQueRenovar(peticion: Request, original: PeticionVista, estado: EstadoMovil, enLinea: boolean): boolean {
  const ruta = new URL(peticion.url).pathname;
  const caducado = !estado.permiso || estado.permiso.caduca <= estado.ahora();
  return original.mode === "navigate" && peticion.method === "GET" && enLinea && caducado && Boolean(estado.sync) && !estado.renovacionFallida && !ruta.startsWith("/drive/");
}

/**
 * Todo el camino de una petición en el móvil: la seguridad, la app y guardar lo apuntado. `original` es la
 * petición tal como llegó al service worker (con su destino y su referrer); `peticion`, la copia que se atiende.
 */
export async function atender(peticion: Request, original: PeticionVista, contexto: Contexto): Promise<Response> {
  const motivo = motivoParaRechazar(original, contexto.origen);
  if (motivo) {
    const cuerpo = await pagina({ titulo: "No se ha hecho", seccion: "bienvenida" }, aviso("error", motivo));
    return new Response(String(cuerpo), { status: 403, headers: { ...CABECERAS_SEGURIDAD, "Content-Type": "text/html; charset=utf-8" } });
  }
  const { app, estado } = await contexto.preparar();
  if (hayQueRenovar(peticion, original, estado, contexto.enLinea?.() ?? true)) {
    const url = new URL(peticion.url);
    return Response.redirect(`${contexto.origen}/drive/conectar?silencioso=1&volver=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }
  const antes = estado.sync?.cambiosTotales();
  const respuesta = await app.fetch(await desdeCrudo(peticion));
  const sync = estado.sync;
  if (sync) {
    // Lo apuntado se guarda en el móvil antes de responder: si el sistema para la app justo después, sigue ahí
    if (sync.cambiosTotales() !== antes) await sync.guardarLocal();
    contexto.esperar(sync.pendiente());
  }
  return respuesta;
}
