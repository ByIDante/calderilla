import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * Actualización del paquete para Windows, el que se reparte en un ZIP con Node dentro para quien no tiene
 * Git ni cuenta de GitHub. Esas copias llevan un archivo VERSION con el commit instalado: al abrir, se
 * pregunta a GitHub por el último commit y, si es otro, se descarga el código y se cambia por el instalado.
 * Las copias de git (las tuyas) se actualizan con git y no pasan por aquí.
 */
export const REPOSITORIO = "ByIDante/calderilla";

/** Lo que no viene en la descarga y no se toca: Node, las dependencias y la propia versión. */
const PROTEGIDOS = new Set(["node", "node_modules", "VERSION"]);

export function esPaquete(raiz: string): boolean {
  return existsSync(path.join(raiz, "VERSION")) && !existsSync(path.join(raiz, ".git"));
}

/** Último commit de la rama principal en GitHub, o null si no se puede saber (sin conexión…). */
export async function ultimaVersion(espera = 5000): Promise<string | null> {
  try {
    const respuesta = await fetch(`https://api.github.com/repos/${REPOSITORIO}/commits/main`, {
      headers: { accept: "application/vnd.github.sha", "user-agent": "calderilla" },
      signal: AbortSignal.timeout(espera),
    });
    if (!respuesta.ok) return null;
    const sha = (await respuesta.text()).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Descarga el código de ese commit y lo pone en lugar del instalado. */
export async function instalarVersion(raiz: string, sha: string): Promise<void> {
  const respuesta = await fetch(`https://github.com/${REPOSITORIO}/archive/${sha}.tar.gz`, {
    headers: { "user-agent": "calderilla" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!respuesta.ok) throw new Error(`GitHub respondió ${respuesta.status} al descargar la versión nueva`);
  const archivos = leerTar(gunzipSync(Buffer.from(await respuesta.arrayBuffer())));

  const nueva = path.join(raiz, ".actualizacion");
  rmSync(nueva, { recursive: true, force: true, maxRetries: 3 });
  for (const archivo of archivos) {
    // Dentro del .tar.gz todo va en una carpeta «calderilla-<commit>/» que se quita
    const partes = archivo.ruta.split("/").slice(1).filter(Boolean);
    if (!partes.length || partes.some((p) => p === ".." || p.includes(":") || p.includes("\\"))) continue;
    const destino = path.join(nueva, ...partes);
    if (archivo.datos === null) {
      mkdirSync(destino, { recursive: true });
    } else {
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, archivo.datos);
    }
  }
  if (!existsSync(path.join(nueva, "package.json"))) throw new Error("La descarga no parece Calderilla");
  sustituir(raiz, nueva);
  writeFileSync(path.join(raiz, "VERSION"), `${sha}\n`);
}

/**
 * Cambia cada archivo y carpeta de primer nivel por el nuevo. Los archivos que no cambian se dejan como
 * están (así package-lock.json conserva su fecha y no se reinstalan las dependencias sin motivo). Si algo
 * falla a medias, se vuelve a dejar lo anterior.
 */
function sustituir(raiz: string, nueva: string) {
  const anterior = path.join(raiz, ".actualizacion-anterior");
  rmSync(anterior, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(anterior);
  const movidos: string[] = [];
  const puestos: string[] = [];
  try {
    for (const nombre of readdirSync(nueva)) {
      if (PROTEGIDOS.has(nombre)) continue;
      const origen = path.join(nueva, nombre);
      const destino = path.join(raiz, nombre);
      if (existsSync(destino)) {
        if (statSync(origen).isFile() && statSync(destino).isFile() && readFileSync(origen).equals(readFileSync(destino))) continue;
        renameSync(destino, path.join(anterior, nombre));
        movidos.push(nombre);
      }
      renameSync(origen, destino);
      puestos.push(nombre);
    }
  } catch (error) {
    for (const nombre of puestos) rmSync(path.join(raiz, nombre), { recursive: true, force: true, maxRetries: 3 });
    for (const nombre of movidos) renameSync(path.join(anterior, nombre), path.join(raiz, nombre));
    throw error;
  } finally {
    rmSync(nueva, { recursive: true, force: true, maxRetries: 3 });
  }
  rmSync(anterior, { recursive: true, force: true, maxRetries: 3 });
}

export interface EntradaTar {
  ruta: string;
  /** null en las carpetas */
  datos: Buffer | null;
}

/** Lee un .tar (formato ustar con cabeceras pax, el que genera GitHub). Solo archivos y carpetas. */
export function leerTar(tar: Buffer): EntradaTar[] {
  const entradas: EntradaTar[] = [];
  const texto = (inicio: number, largo: number) => {
    const trozo = tar.subarray(inicio, inicio + largo);
    const fin = trozo.indexOf(0);
    return trozo.subarray(0, fin === -1 ? largo : fin).toString("utf8");
  };
  let rutaLarga: string | null = null;
  let posicion = 0;
  while (posicion + 512 <= tar.length) {
    const cabecera = tar.subarray(posicion, posicion + 512);
    if (cabecera.every((byte) => byte === 0)) break;
    const tamano = parseInt(texto(posicion + 124, 12).trim() || "0", 8);
    const tipo = String.fromCharCode(cabecera[156] ?? 0);
    const prefijo = texto(posicion + 345, 155);
    const nombre = texto(posicion, 100);
    const datos = tar.subarray(posicion + 512, posicion + 512 + tamano);
    posicion += 512 + Math.ceil(tamano / 512) * 512;

    if (tipo === "x") {
      // Cabecera pax de la entrada siguiente: «<largo> clave=valor\n»; aquí solo importa la ruta
      rutaLarga = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(datos.toString("utf8"))?.[1] ?? rutaLarga;
      continue;
    }
    if (tipo === "L") {
      rutaLarga = datos.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    const ruta = rutaLarga ?? (prefijo ? `${prefijo}/${nombre}` : nombre);
    rutaLarga = null;
    if (tipo === "0" || tipo === "\0") entradas.push({ ruta, datos: Buffer.from(datos) });
    else if (tipo === "5") entradas.push({ ruta, datos: null });
    // Las demás (cabecera pax global con el commit, enlaces…) no hacen falta
  }
  return entradas;
}
