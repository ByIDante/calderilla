import type { BaseDatos } from "../datos/db.ts";

/*
 * Importa una exportación JSON de Calderilla (Ajustes → Exportar a JSON): sustituye todos los datos por los del
 * archivo. Quien llama debe guardar antes una copia de seguridad.
 */

interface Exportacion {
  programa: string;
  esquema: number;
  tablas: Record<string, Record<string, unknown>[]>;
}

function esExportacion(datos: unknown): datos is Exportacion {
  const d = datos as Partial<Exportacion> | null;
  return !!d && d.programa === "Calderilla" && typeof d.esquema === "number" && typeof d.tablas === "object" && d.tablas !== null;
}

export function importarJson(bd: BaseDatos, datos: unknown): { filas: number } {
  if (!esExportacion(datos)) throw new Error("Ese archivo no es una exportación de Calderilla.");
  if (datos.esquema > bd.version()) throw new Error("Lo exportó una versión más nueva de Calderilla: actualiza el programa antes de importarlo.");
  const tablas = bd.todos<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('meta') AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
  let filas = 0;
  // Sin comprobar claves ajenas mientras se vacía y se rellena: el orden de las tablas no importa
  bd.script("PRAGMA foreign_keys = OFF");
  try {
    bd.transaccion(() => {
      for (const tabla of tablas) {
        bd.ejecutar(`DELETE FROM ${tabla}`);
        const columnas = new Set(bd.todos<{ name: string }>(`PRAGMA table_info(${tabla})`).map((c) => c.name));
        for (const fila of datos.tablas[tabla] ?? []) {
          const nombres = Object.keys(fila).filter((n) => columnas.has(n));
          if (!nombres.length) continue;
          const valores = nombres.map((n) => {
            const v = fila[n];
            return v === null || typeof v === "number" || typeof v === "string" ? v : JSON.stringify(v);
          });
          bd.ejecutar(`INSERT INTO ${tabla} (${nombres.join(", ")}) VALUES (${nombres.map(() => "?").join(", ")})`, ...valores);
          filas++;
        }
      }
    });
  } finally {
    bd.script("PRAGMA foreign_keys = ON");
  }
  return { filas };
}
