import sqlite3InitModule, { type Database, type PreparedStatement, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { Motor, Valor } from "../../datos/db.ts";

/**
 * Arranca SQLite en WebAssembly. En Node lee él solo su sqlite3.wasm; en el service worker se le pasan los bytes,
 * que salen de su almacén (sus propias peticiones no pasan por él y sin conexión fallarían).
 */
export async function arrancarSqlite(wasm?: ArrayBuffer): Promise<Sqlite3Static> {
  const opciones = {
    print: () => {},
    printErr: () => {},
    ...(wasm && {
      instantiateWasm(imports: WebAssembly.Imports, listo: (instancia: WebAssembly.Instance, modulo: WebAssembly.Module) => void) {
        WebAssembly.instantiate(wasm, imports).then((r) => listo(r.instance, r.module));
        return {};
      },
    }),
  };
  // Los tipos del paquete no declaran las opciones a propósito
  return (sqlite3InitModule as unknown as (opciones: object) => Promise<Sqlite3Static>)(opciones);
}

/** «SQLITE_CONSTRAINT_UNIQUE: sqlite3 result code 2067: UNIQUE constraint failed: …» → como en node:sqlite. */
function comoNode(error: unknown): unknown {
  if (error instanceof Error && /^SQLITE_[A-Z_]+: sqlite3 result code \d+: /.test(error.message)) {
    return new Error(error.message.replace(/^SQLITE_[A-Z_]+: sqlite3 result code \d+: /, ""));
  }
  return error;
}

/**
 * La base en memoria sobre SQLite en WebAssembly, con lo que BaseDatos usa de node:sqlite y su mismo
 * comportamiento: los números se enlazan como REAL (como hace node:sqlite; si no, «? / 2» daría otra cosa) y las
 * filas son objetos sin prototipo.
 */
export class MotorWasm implements Motor {
  readonly #sqlite3: Sqlite3Static;
  readonly #db: Database;

  private constructor(sqlite3: Sqlite3Static, db: Database) {
    this.#sqlite3 = sqlite3;
    this.#db = db;
  }

  static vacio(sqlite3: Sqlite3Static): MotorWasm {
    return new MotorWasm(sqlite3, new sqlite3.oo1.DB(":memory:"));
  }

  /** Abre en memoria una base guardada (la de IndexedDB o una copia descargada). */
  static desdeBytes(sqlite3: Sqlite3Static, bytes: Uint8Array): MotorWasm {
    const db = new sqlite3.oo1.DB(":memory:");
    // Un Buffer de Node también es un Uint8Array, pero allocFromTypedArray solo acepta los de verdad
    const puntero = sqlite3.wasm.allocFromTypedArray(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const { capi } = sqlite3;
    db.checkRc(capi.sqlite3_deserialize(db, "main", puntero, bytes.byteLength, bytes.byteLength, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE));
    return new MotorWasm(sqlite3, db);
  }

  /** La base entera, como el archivo .db que guarda el PC. */
  aBytes(): Uint8Array {
    return this.#sqlite3.capi.sqlite3_js_db_export(this.#db);
  }

  /** Cuántas filas se han cambiado desde que se abrió: si no se mueve, no ha habido cambios. */
  cambiosTotales(): number {
    return this.#sqlite3.capi.sqlite3_total_changes(this.#db);
  }

  get isOpen(): boolean {
    return this.#db.isOpen();
  }

  close() {
    this.#db.close();
  }

  exec(sql: string) {
    try {
      this.#db.exec(sql);
    } catch (error) {
      throw comoNode(error);
    }
  }

  prepare(sql: string) {
    return {
      all: (...parametros: Valor[]) => this.#filas(sql, parametros, Infinity),
      get: (...parametros: Valor[]) => this.#filas(sql, parametros, 1)[0],
      run: (...parametros: Valor[]) => {
        this.#conSentencia(sql, parametros, (sentencia) => {
          while (sentencia.step());
        });
        const { capi } = this.#sqlite3;
        return { changes: capi.sqlite3_changes(this.#db), lastInsertRowid: Number(capi.sqlite3_last_insert_rowid(this.#db)) };
      },
    };
  }

  #filas(sql: string, parametros: Valor[], limite: number): Record<string, unknown>[] {
    return this.#conSentencia(sql, parametros, (sentencia) => {
      const columnas = sentencia.getColumnNames();
      const filas: Record<string, unknown>[] = [];
      while (filas.length < limite && sentencia.step()) {
        const fila: Record<string, unknown> = Object.create(null);
        columnas.forEach((columna, i) => (fila[columna] = sentencia.get(i)));
        filas.push(fila);
      }
      return filas;
    });
  }

  /** Cada consulta prepara su sentencia y la libera al acabar (en WebAssembly no hay recolector que lo haga). */
  #conSentencia<T>(sql: string, parametros: Valor[], usar: (sentencia: PreparedStatement) => T): T {
    let sentencia: PreparedStatement | undefined;
    try {
      sentencia = this.#db.prepare(sql);
      this.#enlazar(sentencia, parametros);
      return usar(sentencia);
    } catch (error) {
      throw comoNode(error);
    } finally {
      sentencia?.finalize();
    }
  }

  #enlazar(sentencia: PreparedStatement, parametros: Valor[]) {
    const { capi } = this.#sqlite3;
    parametros.forEach((valor, i) => {
      const n = i + 1;
      if (typeof valor === "number") this.#db.checkRc(capi.sqlite3_bind_double(sentencia, n, valor));
      else if (typeof valor === "bigint") this.#db.checkRc(capi.sqlite3_bind_int64(sentencia, n, valor));
      else if (valor === null || typeof valor === "string" || valor instanceof Uint8Array) sentencia.bind(n, valor);
      else throw new Error(`Provided value cannot be bound to SQLite parameter ${n}.`);
    });
  }
}
