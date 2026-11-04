// Carpetas de copias para los tests del móvil: una del disco (la misma que usa el PC) y un Google Drive falso.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArchivoCarpeta, Carpeta } from "../src/movil/sync/carpeta.ts";

/** La carpeta de copias del PC, vista como la ve el móvil: así los dos trabajan sobre los mismos archivos. */
export class CarpetaLocal implements Carpeta {
  readonly ruta: string;

  constructor(ruta: string) {
    this.ruta = ruta;
    mkdirSync(ruta, { recursive: true });
  }

  async listar(): Promise<ArchivoCarpeta[]> {
    return readdirSync(this.ruta)
      .filter((nombre) => !nombre.startsWith(".") && statSync(path.join(this.ruta, nombre)).isFile())
      .map((nombre) => ({ id: nombre, nombre }));
  }

  async leer(archivo: ArchivoCarpeta): Promise<Uint8Array> {
    return readFileSync(path.join(this.ruta, archivo.id));
  }

  async crear(nombre: string, bytes: Uint8Array): Promise<ArchivoCarpeta> {
    // Como Drive: el archivo aparece ya completo
    const temporal = path.join(this.ruta, `.${nombre}.tmp`);
    writeFileSync(temporal, bytes);
    renameSync(temporal, path.join(this.ruta, nombre));
    return { id: nombre, nombre };
  }

  async renombrar(archivo: ArchivoCarpeta, nombre: string): Promise<void> {
    renameSync(path.join(this.ruta, archivo.id), path.join(this.ruta, nombre));
  }

  async borrar(archivo: ArchivoCarpeta): Promise<void> {
    rmSync(path.join(this.ruta, archivo.id), { force: true });
  }
}

interface ArchivoDrive {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  trashed: boolean;
  bytes: Uint8Array;
}

const CARPETA = "application/vnd.google-apps.folder";

/** Separa una subida «multipart/related»: los datos del archivo (JSON) y su contenido, byte a byte. */
function partesMultipart(cuerpo: Uint8Array, limite: string): { metadatos: Record<string, unknown>; bytes: Uint8Array | null } {
  // latin1 de Node: un carácter por byte, sin cambiar ninguno (el de TextDecoder es windows-1252)
  const texto = Buffer.from(cuerpo).toString("latin1");
  const trozos = texto.split(`--${limite}`).slice(1, -1);
  const contenido = (trozo: string) => Buffer.from(trozo.slice(trozo.indexOf("\r\n\r\n") + 4, trozo.length - 2), "latin1");
  const metadatos = JSON.parse(contenido(trozos[0]!).toString("utf8"));
  return { metadatos, bytes: trozos[1] === undefined ? null : new Uint8Array(contenido(trozos[1])) };
}

/** Lo justo de la API de Google Drive v3 que usa el móvil, en memoria. El permiso bueno es «Bearer bueno». */
export function driveFalso() {
  const archivos = new Map<string, ArchivoDrive>();
  const peticiones: string[] = [];
  let siguiente = 0;
  const nuevo = (datos: Omit<ArchivoDrive, "id" | "trashed">) => {
    const archivo = { ...datos, id: `id${++siguiente}`, trashed: false };
    archivos.set(archivo.id, archivo);
    return archivo;
  };
  const cumple = (archivo: ArchivoDrive, q: string) =>
    q.split(" and ").every((condicion) => {
      let m: RegExpExecArray | null;
      if ((m = /^'([^']+)' in parents$/.exec(condicion))) return archivo.parents.includes(m[1]!);
      if (condicion === "trashed = false") return !archivo.trashed;
      if ((m = /^mimeType (=|!=) '([^']+)'$/.exec(condicion))) return (archivo.mimeType === m[2]) === (m[1] === "=");
      if ((m = /^name = '([^']+)'$/.exec(condicion))) return archivo.name === m[1];
      throw new Error(`Búsqueda que el Drive falso no entiende: ${condicion}`);
    });
  const json = (datos: unknown, status = 200) => new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json" } });
  const error = (status: number, message: string) => json({ error: { code: status, message } }, status);

  const pedir = async (entrada: RequestInfo | URL, opciones: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(entrada));
    const metodo = opciones.method ?? "GET";
    peticiones.push(`${metodo} ${url.pathname}`);
    if ((opciones.headers as Record<string, string>)?.Authorization !== "Bearer bueno") return error(401, "Invalid Credentials");
    const id = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (metodo === "GET" && url.pathname === "/drive/v3/files") {
      const encontrados = [...archivos.values()].filter((a) => cumple(a, url.searchParams.get("q") ?? ""));
      const desde = Number(url.searchParams.get("pageToken") ?? 0);
      const cuantos = Number(url.searchParams.get("pageSize") ?? 100);
      const pagina = encontrados.slice(desde, desde + Math.min(cuantos, 3));
      return json({ files: pagina.map((a) => ({ id: a.id, name: a.name, parents: a.parents })), ...(desde + 3 < encontrados.length && { nextPageToken: String(desde + 3) }) });
    }
    if (id && !archivos.has(id)) return error(404, "File not found");
    const archivo = id ? archivos.get(id)! : null;
    if (metodo === "GET" && archivo) return url.searchParams.get("alt") === "media" ? new Response(archivo.bytes as Uint8Array<ArrayBuffer>) : json({ id: archivo.id, name: archivo.name });
    if (metodo === "PATCH" && archivo) {
      const cambios = JSON.parse(String(opciones.body)) as { name?: string; trashed?: boolean };
      if (cambios.name !== undefined) archivo.name = cambios.name;
      if (cambios.trashed !== undefined) archivo.trashed = cambios.trashed;
      return json({ id: archivo.id });
    }
    if (metodo === "POST" && url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "multipart") {
      const limite = /boundary=(.+)$/.exec((opciones.headers as Record<string, string>)["Content-Type"] ?? "")?.[1]!;
      const { metadatos, bytes } = partesMultipart(new Uint8Array(await new Response(opciones.body).arrayBuffer()), limite);
      const creado = nuevo({ name: String(metadatos.name), parents: (metadatos.parents as string[]) ?? ["raiz"], mimeType: String(metadatos.mimeType ?? "application/octet-stream"), bytes: bytes ?? new Uint8Array() });
      return json({ id: creado.id, name: creado.name });
    }
    return error(404, `El Drive falso no sabe hacer ${metodo} ${url.pathname}`);
  };

  return {
    pedir: pedir as typeof fetch,
    archivos,
    peticiones,
    carpeta(nombre: string, padre = "raiz") {
      return nuevo({ name: nombre, parents: [padre], mimeType: CARPETA, bytes: new Uint8Array() }).id;
    },
    archivo(nombre: string, padre: string, bytes: Uint8Array = new Uint8Array()) {
      return nuevo({ name: nombre, parents: [padre], mimeType: "application/octet-stream", bytes }).id;
    },
    /** Los nombres de lo que hay en una carpeta (sin la papelera). */
    nombres(carpeta: string) {
      return [...archivos.values()].filter((a) => a.parents.includes(carpeta) && !a.trashed).map((a) => a.name).sort();
    },
  };
}
