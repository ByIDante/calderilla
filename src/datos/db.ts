import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type Valor = SQLInputValue;

const CARPETA_MIGRACIONES = path.join(import.meta.dirname, "migraciones");

/** Migraciones en orden: 001_inicial.sql, 002_….sql. Su número es la versión del esquema (PRAGMA user_version). */
function migraciones(): { version: number; sql: string }[] {
  return readdirSync(CARPETA_MIGRACIONES)
    .filter((archivo) => /^\d{3}_.+\.sql$/.test(archivo))
    .sort()
    .map((archivo) => ({ version: Number(archivo.slice(0, 3)), sql: readFileSync(path.join(CARPETA_MIGRACIONES, archivo), "utf8") }));
}

export const VERSION_ESQUEMA = Math.max(0, ...migraciones().map((m) => m.version));

export class VersionNuevaError extends Error {}

/** Envoltorio fino sobre node:sqlite, para poder cambiar de motor sin tocar el resto. */
export class BaseDatos {
  readonly ruta: string;
  readonly #db: DatabaseSync;
  #profundidad = 0;

  constructor(ruta: string, opciones: { soloLectura?: boolean } = {}) {
    this.ruta = ruta;
    this.#db = new DatabaseSync(ruta, { readOnly: opciones.soloLectura ?? false });
    if (opciones.soloLectura) return;
    // Sin WAL: la base es un único archivo que se puede copiar con seguridad cuando no hay transacciones abiertas
    this.#db.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");
  }

  todos<T>(sql: string, ...parametros: Valor[]): T[] {
    return this.#db.prepare(sql).all(...parametros) as T[];
  }

  uno<T>(sql: string, ...parametros: Valor[]): T | undefined {
    return this.#db.prepare(sql).get(...parametros) as T | undefined;
  }

  ejecutar(sql: string, ...parametros: Valor[]): { cambios: number; id: number } {
    const resultado = this.#db.prepare(sql).run(...parametros);
    return { cambios: Number(resultado.changes), id: Number(resultado.lastInsertRowid) };
  }

  script(sql: string) {
    this.#db.exec(sql);
  }

  /** Se puede anidar: dentro de otra transacción usa un punto de guardado (si falla, solo se deshace lo de dentro). */
  transaccion<T>(fn: () => T): T {
    const nombre = `punto${this.#profundidad}`;
    this.#db.exec(this.#profundidad ? `SAVEPOINT ${nombre}` : "BEGIN");
    this.#profundidad++;
    try {
      const resultado = fn();
      this.#profundidad--;
      this.#db.exec(this.#profundidad ? `RELEASE ${nombre}` : "COMMIT");
      return resultado;
    } catch (error) {
      this.#profundidad--;
      this.#db.exec(this.#profundidad ? `ROLLBACK TO ${nombre}; RELEASE ${nombre}` : "ROLLBACK");
      throw error;
    }
  }

  /** Copia completa y compacta en otro archivo, sin cerrar la base. */
  copiarA(destino: string) {
    this.#db.prepare("VACUUM INTO ?").run(destino);
  }

  version(): number {
    return Number(this.uno<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0);
  }

  leerMeta(clave: string): string | null {
    return this.uno<{ valor: string | null }>("SELECT valor FROM meta WHERE clave = ?", clave)?.valor ?? null;
  }

  escribirMeta(clave: string, valor: string | null) {
    this.ejecutar("INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor", clave, valor);
  }

  cerrar() {
    if (this.#db.isOpen) this.#db.close();
  }

  /** Aplica las migraciones pendientes y crea los disparadores que marcan la base como modificada. */
  migrar() {
    const actual = this.version();
    if (actual > VERSION_ESQUEMA) {
      throw new VersionNuevaError(
        `Estos datos los guardó una versión más nueva de Calderilla (esquema ${actual}, esta versión entiende hasta el ${VERSION_ESQUEMA}). Actualiza el programa en este ordenador.`,
      );
    }
    for (const migracion of migraciones()) {
      if (migracion.version <= actual) continue;
      this.transaccion(() => {
        this.script(migracion.sql);
        this.script(`PRAGMA user_version = ${migracion.version}`);
      });
    }
    this.crearDisparadores();
  }

  /**
   * Cualquier cambio en una tabla de datos marca la copia como "con cambios" dentro de la misma transacción,
   * así nunca se pierde el aviso aunque el programa se cierre de golpe.
   */
  private crearDisparadores() {
    const tablas = this.todos<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('meta') AND name NOT LIKE 'sqlite_%'");
    for (const { name } of tablas) {
      for (const evento of ["INSERT", "UPDATE", "DELETE"]) {
        this.script(`CREATE TRIGGER IF NOT EXISTS cambio_${name}_${evento.toLowerCase()} AFTER ${evento} ON ${name}
          BEGIN
            INSERT INTO meta (clave, valor) VALUES ('sucio', '1') ON CONFLICT (clave) DO UPDATE SET valor = '1';
            INSERT INTO meta (clave, valor) VALUES ('modificado', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor;
          END`);
      }
    }
  }
}
