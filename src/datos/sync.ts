import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
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
} from "./copias.ts";
import { BaseDatos } from "./db.ts";

// La sincronización del PC: las copias van a una carpeta de este ordenador que sincroniza otro programa. Las reglas
// (nombres, cabezas, qué guardar y qué podar) están en copias.ts y son las mismas en el móvil.
export * from "./copias.ts";

export interface OpcionesSync {
  carpetaDatos: string;
  rutaTrabajo: string;
  equipoId: string;
  equipoNombre: string;
  /** Se llama cada vez que se abre la copia local (al arrancar y tras traer una copia de otro ordenador). */
  alAbrir: (bd: BaseDatos) => void;
  ahora?: () => Date;
}

export class Sincronizador implements Sincronia {
  readonly carpetaCopias: string;
  estado: EstadoSync = { tipo: "ok" };
  /** Aviso para la banda superior, p. ej. cuando llegan cambios de otro ordenador. */
  aviso: string | null = null;
  #bd: BaseDatos;
  readonly #opciones: OpcionesSync;
  #temporizador: NodeJS.Timeout | undefined;

  constructor(opciones: OpcionesSync) {
    this.#opciones = opciones;
    this.carpetaCopias = path.join(opciones.carpetaDatos, "copias");
    this.#bd = this.#abrirLocal();
  }

  get bd(): BaseDatos {
    return this.#bd;
  }

  #ahora(): Date {
    return this.#opciones.ahora?.() ?? new Date();
  }

  #abrirLocal(): BaseDatos {
    const bd = new BaseDatos(this.#opciones.rutaTrabajo);
    this.#opciones.alAbrir(bd);
    bd.escribirMeta("equipo_nombre", this.#opciones.equipoNombre);
    return bd;
  }

  listar(): { copias: Copia[]; rastros: Rastro[] } {
    mkdirSync(this.carpetaCopias, { recursive: true });
    const archivos = readdirSync(this.carpetaCopias);
    return {
      copias: archivos.map(leerNombre).filter((copia): copia is Copia => copia !== null),
      rastros: archivos.map(leerRastro).filter((rastro): rastro is Rastro => rastro !== null),
    };
  }

  estadoLocal(): EstadoLocal {
    return { base: this.#bd.leerMeta("base"), sucio: this.#bd.leerMeta("sucio") === "1" };
  }

  /** Mira la carpeta compartida y hace lo que toque: nada, guardar, traer o avisar de un conflicto. */
  comprobar(): Decision | null {
    this.#ultimaComprobacion = Date.now();
    try {
      const { copias, rastros } = this.listar();
      const decision = decidir(copias, this.estadoLocal(), rastros);
      if (decision.tipo === "enviar") this.#enviar(this.estadoLocal().base);
      if (decision.tipo === "descargar") this.#descargar(decision.copia, true);
      this.estado = decision.tipo === "conflicto" ? { tipo: "conflicto", versiones: decision.versiones, localConCambios: decision.localConCambios } : { tipo: "ok" };
      return decision;
    } catch (error) {
      this.estado = { tipo: "error", mensaje: (error as Error).message };
      return null;
    }
  }

  #ultimaComprobacion = 0;

  /** Comprueba la carpeta si hace rato que no se mira (al navegar entre páginas, para ver enseguida los cambios de otro ordenador). */
  comprobarSiToca(intervaloMs = 10_000) {
    const ahora = Date.now();
    if (ahora - this.#ultimaComprobacion < intervaloMs) return;
    this.comprobar();
  }

  /** Tras un cambio, espera unos segundos por si llegan más y guarda una sola copia. */
  programarEnvio(esperaMs = 5_000) {
    clearTimeout(this.#temporizador);
    this.#temporizador = setTimeout(() => this.comprobar(), esperaMs);
    this.#temporizador.unref();
  }

  #enviar(padre: string | null): Copia {
    const { copias } = this.listar();
    const gen = siguienteGen(copias);
    const nombre = nombreCopia(gen, marcaDe(this.#ahora()), this.#opciones.equipoId, padre);
    const temporal = path.join(this.carpetaCopias, `.${nombre}.tmp`);
    rmSync(temporal, { force: true });
    this.#bd.copiarA(temporal);
    // El programa de sincronización solo ve aparecer el archivo ya completo
    renameSync(temporal, path.join(this.carpetaCopias, nombre));
    const copia = leerNombre(nombre)!;
    this.#bd.escribirMeta("base", copia.id);
    this.#bd.escribirMeta("sucio", "0");
    this.#podar();
    return copia;
  }

  #descargar(copia: Copia, avisar: boolean) {
    const temporal = `${this.#opciones.rutaTrabajo}.descarga`;
    copyFileSync(path.join(this.carpetaCopias, copia.archivo), temporal);
    // Se valida antes de sustituir nada: si la guardó una versión más nueva del programa, migrar() lo rechaza
    const prueba = new BaseDatos(temporal);
    try {
      prueba.migrar();
      prueba.escribirMeta("base", copia.id);
      prueba.escribirMeta("sucio", "0");
    } finally {
      prueba.cerrar();
    }
    const origen = new BaseDatos(path.join(this.carpetaCopias, copia.archivo), { soloLectura: true });
    const equipo = origen.leerMeta("equipo_nombre") ?? copia.equipo;
    origen.cerrar();
    this.#bd.cerrar();
    renameSync(temporal, this.#opciones.rutaTrabajo);
    this.#bd = this.#abrirLocal();
    if (avisar && copia.equipo !== this.#opciones.equipoId) this.aviso = `Se han cargado los últimos cambios, guardados en «${equipo}».`;
  }

  /** Guarda una copia apartada (no cuenta como versión) para no perder nada al resolver un conflicto. */
  #apartar(bd: BaseDatos, padre: string | null) {
    bd.copiarA(path.join(this.carpetaCopias, nombreApartada(marcaDe(this.#ahora()), this.#opciones.equipoId, padre)));
  }

  /** Aparta versiones: dejan de contar, pero se guardan 30 días contando desde ahora. */
  #descartar(copias: readonly Copia[]) {
    const marca = marcaDe(this.#ahora());
    for (const copia of copias) {
      const origen = path.join(this.carpetaCopias, copia.archivo);
      if (existsSync(origen)) renameSync(origen, path.join(this.carpetaCopias, nombreDescartada(copia, marca)));
    }
  }

  /** Guarda aparte una copia de los datos tal como están ahora (para poder deshacer una restauración o importación). */
  copiaDeSeguridad() {
    this.#apartar(this.#bd, this.estadoLocal().base);
  }

  /**
   * Vuelve a los datos de una copia anterior (o apartada). Lo actual se aparta antes, y lo restaurado se guarda
   * como una versión nueva, así el otro ordenador también lo recibe.
   */
  restaurar(archivo: string) {
    const { copias, rastros } = this.listar();
    const existe = copias.some((c) => c.archivo === archivo) || rastros.some((r) => r.archivo === archivo && r.archivo.endsWith(".db"));
    if (!existe) throw new Error("Esa copia ya no está en la carpeta.");
    const { base } = this.estadoLocal();
    this.copiaDeSeguridad();
    const temporal = `${this.#opciones.rutaTrabajo}.restaurar`;
    copyFileSync(path.join(this.carpetaCopias, archivo), temporal);
    const prueba = new BaseDatos(temporal);
    try {
      prueba.migrar();
      prueba.escribirMeta("base", base);
      prueba.escribirMeta("sucio", "1");
    } finally {
      prueba.cerrar();
    }
    this.#bd.cerrar();
    renameSync(temporal, this.#opciones.rutaTrabajo);
    this.#bd = this.#abrirLocal();
    this.comprobar();
  }

  /** Resuelve un conflicto: `eleccion` es el archivo de la versión que sigue, o "local" para quedarse con la de este ordenador. */
  resolver(eleccion: string) {
    const { copias, rastros } = this.listar();
    const { base } = this.estadoLocal();
    const plan = planResolver(cabezas(copias, rastros), base, eleccion);
    if (plan.tipo === "local") {
      this.#enviar(plan.padre?.id ?? null);
    } else {
      if (this.estadoLocal().sucio) this.#apartar(this.#bd, base);
      this.#descargar(plan.elegida, false);
    }
    this.#descartar(plan.descartar);
    this.aviso = "Conflicto resuelto. Las versiones que no elegiste quedan apartadas en la carpeta de copias.";
    this.comprobar();
  }

  resumen(copia: Pick<Copia, "archivo" | "equipo"> | null): ResumenVersion {
    const bd = copia ? new BaseDatos(path.join(this.carpetaCopias, copia.archivo), { soloLectura: true }) : this.#bd;
    try {
      return resumenDe(bd, copia);
    } finally {
      if (copia) bd.cerrar();
    }
  }

  /**
   * Borra copias antiguas según la retención. Cada copia borrada deja un ".podada" vacío que sigue nombrando a
   * su padre; ese rastro se borra cuando su padre ya no existe. Las apartadas se borran 30 días después de
   * apartarlas.
   */
  #podar() {
    const ahora = this.#ahora();
    const ruta = (archivo: string) => path.join(this.carpetaCopias, archivo);
    const dejarRastro = (copia: Pick<Copia, "id" | "padre">) => writeFileSync(ruta(nombrePodada(copia)), "");
    let { copias, rastros } = this.listar();
    for (const copia of copiasSobrantes(copias, this.estadoLocal().base, ahora, rastros)) {
      dejarRastro(copia);
      rmSync(ruta(copia.archivo), { force: true });
    }
    for (const rastro of apartadasCaducadas(rastros, ahora)) {
      dejarRastro(rastro);
      rmSync(ruta(rastro.archivo), { force: true });
    }
    ({ copias, rastros } = this.listar());
    for (const rastro of rastrosHuerfanos(copias, rastros)) rmSync(ruta(rastro.archivo), { force: true });
  }

  /** Al cerrar el programa: deja guardado lo pendiente. */
  cerrar() {
    clearTimeout(this.#temporizador);
    if (this.estadoLocal().sucio) this.comprobar();
    this.#bd.cerrar();
  }
}
