import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  apartadasCaducadas,
  cabezas,
  copiasSobrantes,
  decidir,
  leerNombre,
  leerRastro,
  marcaDe,
  nombreApartada,
  nombreCopia,
  nombreDescartada,
  nombrePodada,
  planResolver,
  rastrosHuerfanos,
  resumenDe,
  siguienteGen,
  type Copia,
  type Decision,
  type EstadoLocal,
  type EstadoSync,
  type Rastro,
  type ResumenVersion,
  type Sincronia,
} from "../../datos/copias.ts";
import { BaseDatos } from "../../datos/db.ts";
import { MotorWasm } from "../sqlite/motor.ts";
import { ArchivoQueNoEsta, type ArchivoCarpeta, type Carpeta } from "./carpeta.ts";

export interface OpcionesMovil {
  carpeta: Carpeta;
  sqlite3: Sqlite3Static;
  equipoId: string;
  equipoNombre: string;
  /** Se llama cada vez que se abre la base local (al arrancar y tras traer una copia de otro equipo). */
  alAbrir: (bd: BaseDatos) => void;
  /** Guarda la base local (en el móvil, en IndexedDB): se llama tras cambiarla por otra o tocar su estado. */
  guardarLocal: (bytes: Uint8Array) => Promise<void>;
  ahora?: () => Date;
}

interface Listado {
  copias: Copia[];
  rastros: Rastro[];
  /** Los archivos de cada nombre (en Drive puede haber dos con el mismo). */
  archivos: Map<string, ArchivoCarpeta[]>;
}

const VACIO = new Uint8Array();

/**
 * La sincronización del móvil: las mismas reglas que la del PC (copias.ts), contra la carpeta de copias de Drive.
 * Lo que el PC hace de golpe aquí espera a la red, así que hay que tener en cuenta lo que pasa entretanto:
 * - las operaciones con la carpeta van de una en una;
 * - si apuntas algo mientras se sube una copia, sigue «con cambios» y se sube otra después;
 * - si apuntas algo mientras se descarga una copia de otro equipo, la descarga se tira y se vuelve a decidir
 *   (acaba en conflicto, para que elijas tú).
 */
export class SincronizadorMovil implements Sincronia {
  estado: EstadoSync = { tipo: "ok" };
  aviso: string | null = null;
  readonly #opciones: OpcionesMovil;
  #motor: MotorWasm;
  #bd: BaseDatos;
  #cola: Promise<unknown> = Promise.resolve();
  #ultimaComprobacion = 0;
  #temporizador: ReturnType<typeof setTimeout> | undefined;
  /** Se cumple cuando sale el envío programado (aunque se reprograme varias veces antes). */
  #programado: { hecho: Promise<void>; avisar: () => void } | null = null;
  /** Las versiones descargadas para enseñarlas en un conflicto: se bajan una vez. */
  readonly #descargadas = new Map<string, Uint8Array>();

  private constructor(opciones: OpcionesMovil, motor: MotorWasm) {
    this.#opciones = opciones;
    this.#motor = motor;
    this.#bd = this.#abrirLocal(motor);
  }

  /** Abre la base guardada en el móvil o, la primera vez, una vacía (que no cuenta como cambios). */
  static abrir(opciones: OpcionesMovil, guardada: Uint8Array | null): SincronizadorMovil {
    return new SincronizadorMovil(opciones, guardada ? MotorWasm.desdeBytes(opciones.sqlite3, guardada) : MotorWasm.vacio(opciones.sqlite3));
  }

  get bd(): BaseDatos {
    return this.#bd;
  }

  /** Cuántas filas han cambiado en la base local: si se mueve tras una petición, hay que guardarla. */
  cambiosTotales(): number {
    return this.#motor.cambiosTotales();
  }

  #ahora(): Date {
    return this.#opciones.ahora?.() ?? new Date();
  }

  #abrirLocal(motor: MotorWasm): BaseDatos {
    const bd = new BaseDatos("móvil", { motor });
    this.#opciones.alAbrir(bd);
    bd.escribirMeta("equipo_nombre", this.#opciones.equipoNombre);
    return bd;
  }

  async guardarLocal() {
    await this.#opciones.guardarLocal(this.#motor.aBytes());
  }

  /** Lo que toca la carpeta va de uno en uno: lo siguiente espera a que acabe lo anterior, salga bien o mal. */
  #enCola<T>(trabajo: () => Promise<T>): Promise<T> {
    const hecho = this.#cola.then(trabajo, trabajo);
    this.#cola = hecho.catch(() => {});
    return hecho;
  }

  async listar(): Promise<Listado> {
    const archivos = new Map<string, ArchivoCarpeta[]>();
    for (const archivo of await this.#opciones.carpeta.listar()) archivos.set(archivo.nombre, [...(archivos.get(archivo.nombre) ?? []), archivo]);
    const nombres = [...archivos.keys()];
    return {
      copias: nombres.map(leerNombre).filter((copia): copia is Copia => copia !== null),
      rastros: nombres.flatMap((nombre) => archivos.get(nombre)!.map(() => leerRastro(nombre))).filter((rastro): rastro is Rastro => rastro !== null),
      archivos,
    };
  }

  estadoLocal(): EstadoLocal {
    return { base: this.#bd.leerMeta("base"), sucio: this.#bd.leerMeta("sucio") === "1" };
  }

  /** Mira la carpeta y hace lo que toque: nada, guardar, traer o avisar de un conflicto. */
  comprobar(): Promise<Decision | null> {
    return this.#enCola(() => this.#comprobar());
  }

  async #comprobar(intentos = 2): Promise<Decision | null> {
    this.#ultimaComprobacion = Date.now();
    try {
      const listado = await this.listar();
      const decision = decidir(listado.copias, this.estadoLocal(), listado.rastros);
      if (decision.tipo === "enviar") await this.#enviar(this.estadoLocal().base, listado);
      // Si se ha apuntado algo mientras se descargaba, se vuelve a mirar: ahora hay cambios aquí y allí
      if (decision.tipo === "descargar" && !(await this.#descargar(decision.copia, listado, true)) && intentos > 0) return this.#comprobar(intentos - 1);
      this.estado = decision.tipo === "conflicto" ? { tipo: "conflicto", versiones: decision.versiones, localConCambios: decision.localConCambios } : { tipo: "ok" };
      if (decision.tipo !== "conflicto") this.#descargadas.clear();
      return decision;
    } catch (error) {
      this.estado = { tipo: "error", mensaje: (error as Error).message };
      return null;
    }
  }

  /**
   * Comprueba la carpeta si hace rato que no se mira. La primera vez (al abrir la app) se espera un poco, para no
   * apuntar sobre datos viejos; después se hace sin esperar, y lo que llegue se ve en la página siguiente. Con un
   * conflicto pendiente (intervalo 0) se espera siempre.
   */
  async comprobarSiToca(intervaloMs = 10_000) {
    if (Date.now() - this.#ultimaComprobacion < intervaloMs) return;
    const primera = this.#ultimaComprobacion === 0;
    const comprobacion = this.comprobar();
    if (intervaloMs === 0) await comprobacion;
    else if (primera) await Promise.race([comprobacion, new Promise((listo) => setTimeout(listo, 2_500))]);
  }

  /** Tras un cambio, espera un poco por si llegan más y sube una sola copia. */
  programarEnvio(esperaMs = 1_500) {
    clearTimeout(this.#temporizador);
    if (!this.#programado) {
      let avisar = () => {};
      const hecho = new Promise<void>((listo) => (avisar = listo));
      this.#programado = { hecho, avisar };
    }
    this.#temporizador = setTimeout(() => void this.#enviarProgramado(), esperaMs);
  }

  async #enviarProgramado() {
    clearTimeout(this.#temporizador);
    this.#temporizador = undefined;
    const programado = this.#programado;
    this.#programado = null;
    await this.comprobar();
    programado?.avisar();
  }

  /**
   * Espera a lo que esté por hacer: el envío programado y la cola. El service worker lo espera para que el sistema
   * no lo pare a medias; con `adelantar`, el envío sale ya (al pasar la app a segundo plano no se puede esperar).
   */
  async pendiente(adelantar = false) {
    if (this.#programado) await (adelantar ? this.#enviarProgramado() : this.#programado.hecho);
    await this.#cola;
  }

  async #enviar(padre: string | null, listado: Listado): Promise<Copia> {
    const nombre = nombreCopia(siguienteGen(listado.copias), marcaDe(this.#ahora()), this.#opciones.equipoId, padre);
    const cambios = this.#motor.cambiosTotales();
    await this.#opciones.carpeta.crear(nombre, this.#motor.aBytes());
    const copia = leerNombre(nombre)!;
    // Lo apuntado mientras subía no va en esa copia: sigue «con cambios» y saldrá en la siguiente
    const sinCambiosEntretanto = this.#motor.cambiosTotales() === cambios;
    this.#bd.escribirMeta("base", copia.id);
    if (sinCambiosEntretanto) this.#bd.escribirMeta("sucio", "0");
    else this.programarEnvio();
    await this.guardarLocal();
    await this.#podar();
    return copia;
  }

  /** Cambia la base local por una copia descargada. Devuelve false si se ha apuntado algo entretanto (no cambia nada). */
  async #descargar(copia: Copia, listado: Listado, avisar: boolean): Promise<boolean> {
    const cambios = this.#motor.cambiosTotales();
    const bytes = await this.#leer(copia.archivo, listado);
    if (this.#motor.cambiosTotales() !== cambios) return false;
    const motor = MotorWasm.desdeBytes(this.#opciones.sqlite3, bytes);
    const nueva = new BaseDatos(copia.archivo, { motor });
    let equipo: string;
    try {
      equipo = nueva.leerMeta("equipo_nombre") ?? copia.equipo;
      // Si la guardó una versión más nueva del programa, migrar() la rechaza y aquí no cambia nada
      nueva.migrar();
      nueva.escribirMeta("base", copia.id);
      nueva.escribirMeta("sucio", "0");
    } catch (error) {
      nueva.cerrar();
      throw error;
    }
    this.#cambiarBase(motor);
    await this.guardarLocal();
    if (avisar && copia.equipo !== this.#opciones.equipoId) this.aviso = `Se han cargado los últimos cambios, guardados en «${equipo}».`;
    return true;
  }

  /** La base local pasa a ser otra (ya migrada): se cierra la anterior y se abre la nueva como al arrancar. */
  #cambiarBase(motor: MotorWasm) {
    this.#bd.cerrar();
    this.#motor = motor;
    this.#bd = this.#abrirLocal(motor);
  }

  async #leer(nombre: string, listado: Listado): Promise<Uint8Array> {
    const archivo = listado.archivos.get(nombre)?.[0];
    if (!archivo) throw new ArchivoQueNoEsta("Esa copia ya no está en la carpeta.");
    return this.#opciones.carpeta.leer(archivo);
  }

  /** Guarda una copia apartada (no cuenta como versión) de los datos de ahora, para no perder nada. */
  async #apartar(padre: string | null) {
    await this.#opciones.carpeta.crear(nombreApartada(marcaDe(this.#ahora()), this.#opciones.equipoId, padre), this.#motor.aBytes());
  }

  /** Aparta versiones: dejan de contar, pero se guardan 30 días contando desde ahora. */
  async #descartar(copias: readonly Copia[]) {
    const marca = marcaDe(this.#ahora());
    const { archivos } = await this.listar();
    for (const copia of copias) {
      for (const archivo of archivos.get(copia.archivo) ?? []) await this.#opciones.carpeta.renombrar(archivo, nombreDescartada(copia, marca));
    }
  }

  copiaDeSeguridad(): Promise<void> {
    return this.#enCola(() => this.#apartar(this.estadoLocal().base));
  }

  /** Vuelve a una copia anterior (o apartada): lo de ahora se aparta antes, y lo restaurado se sube como versión nueva. */
  restaurar(archivo: string): Promise<void> {
    return this.#enCola(async () => {
      const listado = await this.listar();
      const existe = listado.copias.some((c) => c.archivo === archivo) || listado.rastros.some((r) => r.archivo === archivo && r.archivo.endsWith(".db"));
      if (!existe) throw new Error("Esa copia ya no está en la carpeta.");
      const { base } = this.estadoLocal();
      await this.#apartar(base);
      const motor = MotorWasm.desdeBytes(this.#opciones.sqlite3, await this.#leer(archivo, listado));
      const restaurada = new BaseDatos(archivo, { motor });
      try {
        restaurada.migrar();
        restaurada.escribirMeta("base", base);
        restaurada.escribirMeta("sucio", "1");
      } catch (error) {
        restaurada.cerrar();
        throw error;
      }
      this.#cambiarBase(motor);
      await this.guardarLocal();
      await this.#comprobar();
    });
  }

  /** Resuelve un conflicto: `eleccion` es el archivo de la versión que sigue, o "local" para quedarse con la de este móvil. */
  resolver(eleccion: string): Promise<void> {
    return this.#enCola(async () => {
      const listado = await this.listar();
      const { base, sucio } = this.estadoLocal();
      const plan = planResolver(cabezas(listado.copias, listado.rastros), base, eleccion);
      if (plan.tipo === "local") {
        await this.#enviar(plan.padre?.id ?? null, listado);
      } else {
        if (sucio) await this.#apartar(base);
        if (!(await this.#descargar(plan.elegida, listado, false))) throw new Error("Has cambiado algo mientras se descargaba esa versión. Vuelve a elegir.");
      }
      await this.#descartar(plan.descartar);
      this.aviso = "Conflicto resuelto. Las versiones que no elegiste quedan apartadas en la carpeta de copias.";
      await this.#comprobar();
    });
  }

  /** El resumen de una versión (o de lo de este móvil, con null). Las de la carpeta se descargan una sola vez. */
  async resumen(copia: Pick<Copia, "archivo" | "equipo"> | null): Promise<ResumenVersion> {
    if (!copia) return resumenDe(this.#bd, null);
    let bytes = this.#descargadas.get(copia.archivo);
    if (!bytes) {
      bytes = await this.#leer(copia.archivo, await this.listar());
      this.#descargadas.set(copia.archivo, bytes);
    }
    const bd = new BaseDatos(copia.archivo, { motor: MotorWasm.desdeBytes(this.#opciones.sqlite3, bytes) });
    try {
      return resumenDe(bd, copia);
    } finally {
      bd.cerrar();
    }
  }

  /**
   * Borra copias antiguas con la misma retención que el PC: cada copia borrada deja un «.podada» vacío que sigue
   * nombrando a su padre, y ese rastro se borra cuando su padre ya no existe.
   */
  async #podar() {
    const ahora = this.#ahora();
    const carpeta = this.#opciones.carpeta;
    const quitar = async (nombre: string, listado: Listado) => {
      for (const archivo of listado.archivos.get(nombre) ?? []) await carpeta.borrar(archivo);
    };
    let listado = await this.listar();
    for (const copia of copiasSobrantes(listado.copias, this.estadoLocal().base, ahora, listado.rastros)) {
      await carpeta.crear(nombrePodada(copia), VACIO);
      await quitar(copia.archivo, listado);
    }
    for (const rastro of apartadasCaducadas(listado.rastros, ahora)) {
      await carpeta.crear(nombrePodada(rastro), VACIO);
      await quitar(rastro.archivo, listado);
    }
    listado = await this.listar();
    for (const rastro of rastrosHuerfanos(listado.copias, listado.rastros)) await quitar(rastro.archivo, listado);
  }

  cerrar() {
    clearTimeout(this.#temporizador);
    this.#bd.cerrar();
  }
}
