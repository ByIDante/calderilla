import type { BaseDatos } from "./db.ts";

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

export function fechaDeMarca(marca: string): Date {
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

/** La generación de la próxima copia: una más que la más alta que haya. */
export function siguienteGen(copias: readonly Pick<Copia, "gen">[]): number {
  return Math.max(0, ...copias.map((copia) => copia.gen)) + 1;
}

/** Copia apartada de los datos de este equipo tal como están (no cuenta como versión). */
export function nombreApartada(marca: string, equipo: string, padre: string | null): string {
  return nombreCopia(0, marca, equipo, padre).replace(/\.db$/, `.descartada-${marca}.db`);
}

/** Una versión apartada al resolver un conflicto: deja de contar, pero sigue nombrando a su padre. */
export function nombreDescartada(copia: Pick<Copia, "id" | "padre">, marca: string): string {
  return `${nombreBase(copia)}.descartada-${marca}.db`;
}

/** El archivo vacío que deja una copia podada, para que siga nombrando a su padre. */
export function nombrePodada(copia: Pick<Copia, "id" | "padre">): string {
  return `${nombreBase(copia)}.podada`;
}

/** Las versiones apartadas hace más de 30 días: se borran, dejando su rastro. */
export function apartadasCaducadas(rastros: readonly Rastro[], ahora: Date): Rastro[] {
  return rastros.filter((rastro) => rastro.marca && ahora.getTime() - fechaDeMarca(rastro.marca).getTime() > 30 * DIA);
}

/** Rastros de copias podadas cuyo padre ya no existe: ya no hace falta que lo nombren. */
export function rastrosHuerfanos(copias: readonly Copia[], rastros: readonly Rastro[]): Rastro[] {
  const vivas = new Set(copias.map((copia) => copia.id));
  return rastros.filter((rastro) => !rastro.marca && (!rastro.padre || !vivas.has(rastro.padre)));
}

export type PlanResolver = { tipo: "local"; padre: Copia | null; descartar: Copia[] } | { tipo: "elegida"; elegida: Copia; descartar: Copia[] };

/** Qué hacer al resolver un conflicto: `eleccion` es el archivo de la versión que sigue, o "local" para quedarse con la de este equipo. */
export function planResolver(versiones: readonly Copia[], base: string | null, eleccion: string): PlanResolver {
  if (eleccion === "local") {
    const padre = versiones.find((copia) => copia.id === base) ?? versiones[0] ?? null;
    return { tipo: "local", padre, descartar: versiones.filter((copia) => copia.id !== padre?.id) };
  }
  const elegida = versiones.find((copia) => copia.archivo === eleccion);
  if (!elegida) throw new Error("Esa versión ya no está en la carpeta. Vuelve a mirar los conflictos.");
  return { tipo: "elegida", elegida, descartar: versiones.filter((copia) => copia.id !== elegida.id) };
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

/** Lo que se enseña de una versión para reconocerla (en la lista de copias y al resolver un conflicto). */
export function resumenDe(bd: BaseDatos, copia: Pick<Copia, "archivo" | "equipo"> | null): ResumenVersion {
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
}

type Puede<T> = T | Promise<T>;

/**
 * Lo que las pantallas comunes usan de la sincronización: la del PC (una carpeta de este ordenador) y la del
 * móvil (Google Drive), donde todo lo que toca la carpeta es asíncrono.
 */
export interface Sincronia {
  readonly bd: BaseDatos;
  estado: EstadoSync;
  /** Aviso para la banda superior, p. ej. cuando llegan cambios de otro equipo. */
  aviso: string | null;
  estadoLocal(): EstadoLocal;
  comprobar(): Puede<Decision | null>;
  comprobarSiToca(intervaloMs?: number): Puede<void>;
  programarEnvio(esperaMs?: number): void;
  copiaDeSeguridad(): Puede<void>;
  restaurar(archivo: string): Puede<void>;
  resolver(eleccion: string): Puede<void>;
  resumen(copia: Pick<Copia, "archivo" | "equipo"> | null): Puede<ResumenVersion>;
  cerrar(): Puede<void>;
}
