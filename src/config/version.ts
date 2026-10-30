import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Carpeta del programa (donde está package.json). */
export const RAIZ = path.join(import.meta.dirname, "..", "..");

/**
 * Commit con el que está instalado el programa, leído directamente de la carpeta .git (no hace falta
 * tener git) o, en el paquete para Windows, de su archivo VERSION. Sirve para darse cuenta de que se ha
 * actualizado mientras la app estaba abierta. null si no se sabe (p. ej. descargada como ZIP de GitHub).
 */
export function versionInstalada(raiz = RAIZ): string | null {
  if (!existsSync(path.join(raiz, ".git"))) {
    try {
      return readFileSync(path.join(raiz, "VERSION"), "utf8").trim() || null;
    } catch {
      return null;
    }
  }
  try {
    const head = readFileSync(path.join(raiz, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const referencia = head.slice(5);
    const suelta = path.join(raiz, ".git", referencia);
    if (existsSync(suelta)) return readFileSync(suelta, "utf8").trim();
    const empaquetadas = readFileSync(path.join(raiz, ".git", "packed-refs"), "utf8");
    return empaquetadas.split("\n").find((linea) => linea.endsWith(` ${referencia}`))?.split(" ")[0] ?? null;
  } catch {
    return null;
  }
}
