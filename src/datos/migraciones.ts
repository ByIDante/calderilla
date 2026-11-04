import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Migracion {
  version: number;
  sql: string;
}

const CARPETA_MIGRACIONES = path.join(import.meta.dirname, "migraciones");

/**
 * Migraciones en orden: 001_inicial.sql, 002_….sql. Su número es la versión del esquema (PRAGMA user_version).
 * Es lo único de la base que lee archivos: en el móvil, al construir, se cambia por las migraciones ya incrustadas.
 */
export function migraciones(): Migracion[] {
  return readdirSync(CARPETA_MIGRACIONES)
    .filter((archivo) => /^\d{3}_.+\.sql$/.test(archivo))
    .sort()
    .map((archivo) => ({ version: Number(archivo.slice(0, 3)), sql: readFileSync(path.join(CARPETA_MIGRACIONES, archivo), "utf8") }));
}
