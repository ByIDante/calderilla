/** Lo que el móvil guarda en el propio navegador: la base, sus ajustes y el permiso de Google. */
export interface Almacen {
  leer<T>(clave: string): Promise<T | undefined>;
  guardar(clave: string, valor: unknown): Promise<void>;
  borrar(clave: string): Promise<void>;
}

/**
 * En IndexedDB, con escritura «estricta»: cuando responde, ya está en el disco. Así lo apuntado no se pierde
 * aunque el sistema pare la app justo después.
 */
export function almacenIndexedDb(nombre = "calderilla"): Almacen {
  let abierta: Promise<IDBDatabase> | null = null;
  const abrir = () =>
    (abierta ??= new Promise((listo, fallo) => {
      const peticion = indexedDB.open(nombre, 1);
      peticion.onupgradeneeded = () => peticion.result.createObjectStore("datos");
      peticion.onsuccess = () => listo(peticion.result);
      peticion.onerror = () => fallo(peticion.error);
    }));
  const operar = async <T>(modo: IDBTransactionMode, accion: (datos: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await abrir();
    return new Promise((listo, fallo) => {
      const transaccion = db.transaction("datos", modo, { durability: "strict" });
      const peticion = accion(transaccion.objectStore("datos"));
      transaccion.oncomplete = () => listo(peticion.result as T);
      transaccion.onerror = () => fallo(transaccion.error);
      transaccion.onabort = () => fallo(transaccion.error);
    });
  };
  return {
    leer: (clave) => operar("readonly", (datos) => datos.get(clave)),
    guardar: (clave, valor) => operar("readwrite", (datos) => datos.put(valor, clave)),
    borrar: (clave) => operar("readwrite", (datos) => datos.delete(clave)),
  };
}

/** En memoria: para los tests y por si el navegador no deja usar IndexedDB (entonces no se guarda nada al cerrar). */
export function almacenEnMemoria(): Almacen {
  const datos = new Map<string, unknown>();
  return {
    leer: async <T>(clave: string) => structuredClone(datos.get(clave)) as T | undefined,
    guardar: async (clave, valor) => void datos.set(clave, structuredClone(valor)),
    borrar: async (clave) => void datos.delete(clave),
  };
}
