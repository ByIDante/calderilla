import { ArchivoQueNoEsta, type ArchivoCarpeta, type Carpeta } from "./carpeta.ts";

const API = "https://www.googleapis.com";
const CARPETA = "application/vnd.google-apps.folder";

/** El permiso de Google ha caducado o se ha retirado: hay que volver a conectar Drive. */
export class SinPermisoDrive extends Error {
  constructor() {
    super("Hay que volver a conectar Google Drive.");
  }
}

/** Las peticiones a la API de Google Drive, con el permiso de esta sesión. */
export class ClienteDrive {
  readonly #token: () => Promise<string>;
  readonly #pedir: typeof fetch;

  constructor(token: () => Promise<string>, pedir: typeof fetch = (...args) => fetch(...args)) {
    this.#token = token;
    this.#pedir = pedir;
  }

  async #respuesta(ruta: string, opciones: RequestInit = {}): Promise<Response> {
    const respuesta = await this.#pedir(`${API}${ruta}`, { ...opciones, headers: { ...(opciones.headers as Record<string, string>), Authorization: `Bearer ${await this.#token()}` } });
    if (respuesta.ok) return respuesta;
    if (respuesta.status === 401) throw new SinPermisoDrive();
    if (respuesta.status === 404) throw new ArchivoQueNoEsta("Ese archivo ya no está en Google Drive.");
    const detalle = ((await respuesta.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(`Google Drive ha respondido ${respuesta.status}${detalle ? `: ${detalle}` : ""}`);
  }

  async json<T>(ruta: string, opciones?: RequestInit): Promise<T> {
    return (await (await this.#respuesta(ruta, opciones)).json()) as T;
  }

  async bytes(ruta: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.#respuesta(ruta)).arrayBuffer());
  }

  /** Todos los archivos que cumplen la búsqueda, página a página. */
  async buscar(q: string, campos = "id,name"): Promise<Record<string, unknown>[]> {
    const archivos: Record<string, unknown>[] = [];
    let pagina: string | undefined;
    do {
      const parametros = new URLSearchParams({ q, fields: `nextPageToken,files(${campos})`, pageSize: "1000", ...(pagina && { pageToken: pagina }) });
      const respuesta = await this.json<{ files?: Record<string, unknown>[]; nextPageToken?: string }>(`/drive/v3/files?${parametros}`);
      archivos.push(...(respuesta.files ?? []));
      pagina = respuesta.nextPageToken;
    } while (pagina);
    return archivos;
  }

  /** Crea un archivo de una vez (subida «multipart»: los datos y el contenido en la misma petición). */
  async crear(metadatos: { name: string; parents?: string[]; mimeType?: string }, bytes: Uint8Array | null): Promise<ArchivoCarpeta> {
    const limite = `calderilla-${crypto.randomUUID()}`;
    const partes: BlobPart[] = [`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadatos)}\r\n`];
    if (bytes) partes.push(`--${limite}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes as Uint8Array<ArrayBuffer>, "\r\n");
    partes.push(`--${limite}--`);
    const creado = await this.json<{ id: string; name: string }>("/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${limite}` },
      body: new Blob(partes),
    });
    return { id: creado.id, nombre: creado.name };
  }

  async cambiar(id: string, cambios: { name?: string; trashed?: boolean }) {
    await this.json(`/drive/v3/files/${id}?fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cambios) });
  }
}

/** La carpeta de copias en Google Drive. */
export class CarpetaDrive implements Carpeta {
  readonly #cliente: ClienteDrive;
  readonly id: string;

  constructor(cliente: ClienteDrive, id: string) {
    this.#cliente = cliente;
    this.id = id;
  }

  async listar(): Promise<ArchivoCarpeta[]> {
    const archivos = await this.#cliente.buscar(`'${this.id}' in parents and trashed = false and mimeType != '${CARPETA}'`);
    return archivos.map((a) => ({ id: String(a.id), nombre: String(a.name) }));
  }

  leer(archivo: ArchivoCarpeta): Promise<Uint8Array> {
    return this.#cliente.bytes(`/drive/v3/files/${archivo.id}?alt=media`);
  }

  crear(nombre: string, bytes: Uint8Array): Promise<ArchivoCarpeta> {
    return this.#cliente.crear({ name: nombre, parents: [this.id] }, bytes);
  }

  renombrar(archivo: ArchivoCarpeta, nombre: string): Promise<void> {
    return this.#cliente.cambiar(archivo.id, { name: nombre });
  }

  async borrar(archivo: ArchivoCarpeta): Promise<void> {
    try {
      await this.#cliente.cambiar(archivo.id, { trashed: true });
    } catch (error) {
      if (!(error instanceof ArchivoQueNoEsta)) throw error;
    }
  }
}

export interface CarpetaEncontrada {
  id: string;
  /** «Calderilla/copias»: el nombre de la carpeta que la contiene, para reconocerla. */
  ruta: string;
  copias: number;
  /** El nombre de la copia más nueva, si hay alguna. */
  ultima: string | null;
}

/** Las carpetas «copias» de tu Drive, con cuántas copias tienen: la que tenga la más nueva suele ser la buena. */
export async function buscarCarpetasCopias(cliente: ClienteDrive, esCopia: (nombre: string) => boolean): Promise<CarpetaEncontrada[]> {
  const carpetas = await cliente.buscar(`name = 'copias' and mimeType = '${CARPETA}' and trashed = false`, "id,parents");
  const encontradas: CarpetaEncontrada[] = [];
  for (const carpeta of carpetas) {
    const padre = (carpeta.parents as string[] | undefined)?.[0];
    const nombrePadre = padre ? ((await cliente.json<{ name?: string }>(`/drive/v3/files/${padre}?fields=name`).catch(() => ({}))) as { name?: string }).name : undefined;
    const copias = (await new CarpetaDrive(cliente, String(carpeta.id)).listar()).map((a) => a.nombre).filter(esCopia).sort();
    encontradas.push({ id: String(carpeta.id), ruta: `${nombrePadre ?? "…"}/copias`, copias: copias.length, ultima: copias.at(-1) ?? null });
  }
  return encontradas.sort((a, b) => (b.ultima ?? "").localeCompare(a.ultima ?? ""));
}

/** Para quien no tiene PC: crea «Calderilla/copias» en la raíz de su Drive. */
export async function crearCarpetaCopias(cliente: ClienteDrive): Promise<string> {
  const calderilla = await cliente.crear({ name: "Calderilla", mimeType: CARPETA }, null);
  return (await cliente.crear({ name: "copias", mimeType: CARPETA, parents: [calderilla.id] }, null)).id;
}
