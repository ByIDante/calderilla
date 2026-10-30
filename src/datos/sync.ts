import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BaseDatos } from "./db.ts";

/*
 * Sincronización sin pérdidas a través de una carpeta que sincroniza otro programa (Drive, Dropbox, Syncthing…).
 *
 * Cada ordenador trabaja sobre su propia copia local. Al guardar, deja en la carpeta compartida una copia
 * NUEVA que nunca se sobrescribe; su nombre indica de qué copia viene (su "padre"):
 *
 *   000012-20261030153000-a1b2c3d4_de_000011-20261029120000-e5f6a7b8.db
 *   └ generación ┘└ fecha UTC ┘└ equipo ┘    └──────── copia padre ────────┘
 *
 * Las "cabezas" son las copias de las que no sale ninguna otra. Si hay una sola, todo cuadra; si hay dos,
 * dos ordenadores han guardado a la vez y hay que elegir. Nada se mezcla ni se borra sin preguntar.
 *
 * Las copias apartadas al resolver un conflicto (".descartada-<fecha>.db") y las que se podan por antiguas
 * (que dejan un archivo vacío ".podada") siguen "nombrando" a su padre: si no, al desaparecer una copia su
 * padre volvería a parecer una cabeza y saltaría un conflicto que no existe.
 */

export interface Copia {
  archivo: string;
  id: string;
  gen: number;
  /** Fecha UTC "aaaammddHHMMss". */
  marca: string;
  equipo: string;
  padre: string | null;
}

const ID = String.raw`(\d{6})-(\d{14})-([a-z0-9]{8})`;
const PATRON = new RegExp(`^(${ID})_de_(inicio|\\d{6}-\\d{14}-[a-z0-9]{8})\\.db$`);
const PATRON_DESCARTADA = new RegExp(`^(${ID})_de_(inicio|\\d{6}-\\d{14}-[a-z0-9]{8})\\.descartada-(\\d{14})\\.db$`);
const PATRON_PODADA = new RegExp(`^(${ID})_de_(inicio|\\d{6}-\\d{14}-[a-z0-9]{8})\\.podada$`);

export function leerNombre(archivo: string): Copia | null {
  const m = PATRON.exec(archivo);
  if (!m) return null;
  const [, id = "", gen = "", marca = "", equipo = "", padre = ""] = m;
  return { archivo, id, gen: Number(gen), marca, equipo, padre: padre === "inicio" ? null : padre };
}

/** Rastro de una copia que ya no es una versión (apartada o podada): solo importa a quién nombra como padre. */
export interface Rastro {
  archivo: string;
  id: string;
  padre: string | null;
  /** Cuándo se apartó (solo las descartadas). */
  marca: string | null;
}

export function leerRastro(archivo: string): Rastro | null {
  const descartada = PATRON_DESCARTADA.exec(archivo);
  if (descartada) return { archivo, id: descartada[1]!, padre: descartada[5] === "inicio" ? null : descartada[5]!, marca: descartada[6]! };
  const podada = PATRON_PODADA.exec(archivo);
  if (podada) return { archivo, id: podada[1]!, padre: podada[5] === "inicio" ? null : podada[5]!, marca: null };
  return null;
}

const nombreBase = (copia: Pick<Copia, "id" | "padre">) => `${copia.id}_de_${copia.padre ?? "inicio"}`;

export function nombreCopia(gen: number, marca: string, equipo: string, padre: string | null): string {
  return `${String(gen).padStart(6, "0")}-${marca}-${equipo}_de_${padre ?? "inicio"}.db`;
}

export function marcaDe(fecha: Date): string {
  return fecha.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function fechaDeMarca(marca: string): Date {
  return new Date(`${marca.slice(0, 4)}-${marca.slice(4, 6)}-${marca.slice(6, 8)}T${marca.slice(8, 10)}:${marca.slice(10, 12)}:${marca.slice(12, 14)}Z`);
}

/** Copias de las que no sale ninguna otra (ni viva ni apartada ni podada), de la más reciente a la más antigua. */
export function cabezas(copias: readonly Copia[], rastros: readonly Pick<Rastro, "padre">[] = []): Copia[] {
  const padres = new Set([...copias, ...rastros].map((copia) => copia.padre));
  return copias.filter((copia) => !padres.has(copia.id)).sort((a, b) => b.gen - a.gen || b.marca.localeCompare(a.marca));
}

export interface EstadoLocal {
  /** Copia compartida de la que sale la copia local. */
  base: string | null;
  /** Hay cambios locales que aún no se han dejado en la carpeta. */
  sucio: boolean;
}

export type Decision =
  | { tipo: "nada" }
  | { tipo: "enviar" }
  | { tipo: "descargar"; copia: Copia }
  | { tipo: "conflicto"; versiones: Copia[]; localConCambios: boolean };

export function decidir(copias: readonly Copia[], local: EstadoLocal, rastros: readonly Pick<Rastro, "padre">[] = []): Decision {
  const actuales = cabezas(copias, rastros);
  const [unica] = actuales;
  if (!unica) return { tipo: "enviar" };
  if (actuales.length === 1) {
    if (unica.id === local.base) return local.sucio ? { tipo: "enviar" } : { tipo: "nada" };
    // Otro ordenador ha guardado después: si aquí no hay cambios, basta con traerla
    return local.sucio ? { tipo: "conflicto", versiones: actuales, localConCambios: true } : { tipo: "descargar", copia: unica };
  }
  return { tipo: "conflicto", versiones: actuales, localConCambios: local.sucio };
}

const DIA = 86_400_000;

/**
 * Qué copias sobran. Se guardan todas las de los últimos 7 días, la última de cada día durante 30 días y la
 * última de cada mes durante un año. Nunca se borran las cabezas ni la copia de la que sale este ordenador.
 */
export function copiasSobrantes(copias: readonly Copia[], base: string | null, ahora: Date, rastros: readonly Pick<Rastro, "padre">[] = []): Copia[] {
  const conservar = new Set<string>(cabezas(copias, rastros).map((copia) => copia.id));
  if (base) conservar.add(base);
  const ultimaDelDia = new Map<string, Copia>();
  const ultimaDelMes = new Map<string, Copia>();
  for (const copia of copias) {
    const edad = (ahora.getTime() - fechaDeMarca(copia.marca).getTime()) / DIA;
    if (edad <= 7) conservar.add(copia.id);
    const dia = copia.marca.slice(0, 8);
    const mes = copia.marca.slice(0, 6);
    if (edad <= 30 && (ultimaDelDia.get(dia)?.marca ?? "") < copia.marca) ultimaDelDia.set(dia, copia);
    if (edad <= 366 && (ultimaDelMes.get(mes)?.marca ?? "") < copia.marca) ultimaDelMes.set(mes, copia);
  }
  for (const copia of [...ultimaDelDia.values(), ...ultimaDelMes.values()]) conservar.add(copia.id);
  return copias.filter((copia) => !conservar.has(copia.id));
}

export interface ResumenVersion {
  archivo: string | null;
  equipo: string;
  guardada: string | null;
  recurrentes: number;
  apuntes: number;
  cuentas: number;
  activos: number;
  /** Nombres de gastos, cuentas, inversiones y metas, para enseñar qué cambia entre versiones. */
  nombres: string[];
}

export type EstadoSync =
  | { tipo: "ok" }
  | { tipo: "conflicto"; versiones: Copia[]; localConCambios: boolean }
  | { tipo: "error"; mensaje: string };

export interface OpcionesSync {
  carpetaDatos: string;
  rutaTrabajo: string;
  equipoId: string;
  equipoNombre: string;
  /** Se llama cada vez que se abre la copia local (al arrancar y tras traer una copia de otro ordenador). */
  alAbrir: (bd: BaseDatos) => void;
  ahora?: () => Date;
}

export class Sincronizador {
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
    const gen = Math.max(0, ...copias.map((copia) => copia.gen)) + 1;
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
    const marca = marcaDe(this.#ahora());
    const nombre = nombreCopia(0, marca, this.#opciones.equipoId, padre).replace(/\.db$/, `.descartada-${marca}.db`);
    bd.copiarA(path.join(this.carpetaCopias, nombre));
  }

  /** Aparta versiones: dejan de contar, pero se guardan 30 días contando desde ahora. */
  #descartar(copias: readonly Copia[]) {
    const marca = marcaDe(this.#ahora());
    for (const copia of copias) {
      const origen = path.join(this.carpetaCopias, copia.archivo);
      if (existsSync(origen)) renameSync(origen, path.join(this.carpetaCopias, `${nombreBase(copia)}.descartada-${marca}.db`));
    }
  }

  /** Resuelve un conflicto: `eleccion` es el archivo de la versión que sigue, o "local" para quedarse con la de este ordenador. */
  resolver(eleccion: string) {
    const { copias, rastros } = this.listar();
    const versiones = cabezas(copias, rastros);
    const { base } = this.estadoLocal();
    if (eleccion === "local") {
      const padre = versiones.find((copia) => copia.id === base) ?? versiones[0] ?? null;
      this.#enviar(padre?.id ?? null);
      this.#descartar(versiones.filter((copia) => copia.id !== padre?.id));
    } else {
      const elegida = versiones.find((copia) => copia.archivo === eleccion);
      if (!elegida) throw new Error("Esa versión ya no está en la carpeta. Vuelve a mirar los conflictos.");
      if (this.estadoLocal().sucio) this.#apartar(this.#bd, base);
      this.#descargar(elegida, false);
      this.#descartar(versiones.filter((copia) => copia.id !== elegida.id));
    }
    this.aviso = "Conflicto resuelto. Las versiones que no elegiste quedan apartadas en la carpeta de copias.";
    this.comprobar();
  }

  resumen(copia: Copia | null): ResumenVersion {
    const bd = copia ? new BaseDatos(path.join(this.carpetaCopias, copia.archivo), { soloLectura: true }) : this.#bd;
    try {
      const contar = (tabla: string) => bd.uno<{ n: number }>(`SELECT count(*) AS n FROM ${tabla}`)?.n ?? 0;
      return {
        archivo: copia?.archivo ?? null,
        equipo: bd.leerMeta("equipo_nombre") ?? copia?.equipo ?? "?",
        guardada: bd.leerMeta("modificado"),
        recurrentes: contar("recurrentes"),
        apuntes: contar("apuntes"),
        cuentas: contar("cuentas"),
        activos: contar("activos"),
        nombres: bd
          .todos<{ nombre: string }>(
            `SELECT 'Gasto o ingreso: ' || nombre AS nombre FROM recurrentes UNION SELECT 'Cuenta: ' || nombre FROM cuentas
             UNION SELECT 'Inversión: ' || nombre FROM activos UNION SELECT 'Meta: ' || nombre FROM metas`,
          )
          .map((fila) => fila.nombre),
      };
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
    const dejarRastro = (copia: Pick<Copia, "id" | "padre">) => writeFileSync(ruta(`${nombreBase(copia)}.podada`), "");
    let { copias, rastros } = this.listar();
    for (const copia of copiasSobrantes(copias, this.estadoLocal().base, ahora, rastros)) {
      dejarRastro(copia);
      rmSync(ruta(copia.archivo), { force: true });
    }
    for (const rastro of rastros) {
      if (rastro.marca && ahora.getTime() - fechaDeMarca(rastro.marca).getTime() > 30 * DIA) {
        dejarRastro(rastro);
        rmSync(ruta(rastro.archivo), { force: true });
      }
    }
    ({ copias, rastros } = this.listar());
    const vivas = new Set(copias.map((copia) => copia.id));
    for (const rastro of rastros) {
      if (!rastro.marca && (!rastro.padre || !vivas.has(rastro.padre))) rmSync(ruta(rastro.archivo), { force: true });
    }
  }

  /** Al cerrar el programa: deja guardado lo pendiente. */
  cerrar() {
    clearTimeout(this.#temporizador);
    if (this.estadoLocal().sucio) this.comprobar();
    this.#bd.cerrar();
  }
}
