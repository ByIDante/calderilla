import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { diasEntre, sumarDias, type Fecha } from "../dominio/fechas.ts";
import { claveConcepto } from "../importar/periodicos.ts";

/*
 * Gastos compartidos: pagas la cena de todos y te devuelven su parte por Bizum. Cada devolución se une a su
 * gasto y el gasto cuenta solo lo tuyo (en el ocio, en el presupuesto por categorías y en los gráficos). La app
 * propone las parejas y tú las confirmas; también puedes unir o separar a mano, sin borrar nada.
 */

/**
 * SQL: lo que cuenta un gasto (`a`) descontando lo que te devolvieron de él, sin pasar de cero (si te devuelven
 * más de lo que pagaste, el gasto no cuenta, pero tampoco suma como ingreso).
 */
export const NETO = "min(0, a.importe + coalesce((SELECT sum(d.importe) FROM apuntes d WHERE d.devuelve_a = a.id), 0))";

export interface MovimientoCompartido {
  id: number;
  fecha: Fecha;
  importe: Centimos;
  concepto: string;
}

export interface PropuestaDevolucion {
  gasto: MovimientoCompartido;
  entradas: MovimientoCompartido[];
  total: Centimos;
  /** Por qué se propone: la misma persona, o varios Bizums justo después de un gasto grande */
  motivo: "misma-persona" | "varios";
}

/** Dinero de otra persona: un Bizum o una transferencia de alguien (en lo traído del banco, «concepto · Nombre;Apellido») */
function dePersona(concepto: string): boolean {
  return /;/.test(concepto.split(" · ").at(-1) ?? "") || /bizum/i.test(concepto);
}

/** Quién es la otra persona: la clave de la última parte («Marta;Ruiz Vidal» → «marta ruiz») */
const persona = (concepto: string) => claveConcepto(concepto.split(" · ").at(-1) ?? concepto).clave;

interface Fila extends MovimientoCompartido {
  devuelto: number;
}

/**
 * Las devoluciones que parecen de un gasto:
 * - la misma persona te devuelve (como mucho, lo que le pagaste) en los 30 días siguientes;
 * - o, tras un gasto de 40 € o más, te llegan varios Bizums de personas en 3 días, cada uno de menos de la
 *   mitad del gasto y entre todos no más de lo que pagaste (la cena de cumpleaños).
 * Cada entrada va a un solo gasto, primero los grandes. Lo que ya decidiste a mano no se vuelve a proponer.
 */
export function proponerDevoluciones(bd: BaseDatos, hoy: Fecha): PropuestaDevolucion[] {
  const desde = sumarDias(hoy, -450);
  const gastos = bd.todos<Fila>(
    `SELECT a.id, a.fecha, a.importe, a.concepto, (SELECT count(*) FROM apuntes d WHERE d.devuelve_a = a.id) AS devuelto FROM apuntes a
     WHERE a.importe <= -2000 AND a.recurrente_id IS NULL AND coalesce(a.traspaso, 0) = 0 AND a.fecha >= ? ORDER BY a.importe, a.fecha`,
    desde,
  );
  const entradas = bd
    .todos<MovimientoCompartido>(
      `SELECT id, fecha, importe, concepto FROM apuntes WHERE importe > 0 AND recurrente_id IS NULL AND coalesce(traspaso, 0) = 0 AND devuelve_a IS NULL
       AND devolucion_manual = 0 AND fecha >= ? ORDER BY fecha, id`,
      desde,
    )
    .filter((e) => dePersona(e.concepto));
  const usadas = new Set<number>();
  const propuestas: PropuestaDevolucion[] = [];
  const libres = (filtro: (e: MovimientoCompartido) => boolean) => entradas.filter((e) => !usadas.has(e.id) && filtro(e));

  // Primero, la misma persona: el Bizum que le hiciste y el que te devuelve
  for (const g of gastos.filter((x) => !x.devuelto && dePersona(x.concepto))) {
    const quien = persona(g.concepto);
    const vuelta = libres((e) => quien.length >= 3 && persona(e.concepto) === quien && e.fecha >= g.fecha && diasEntre(g.fecha, e.fecha) <= 30 && e.importe <= -g.importe * 1.05)[0];
    if (!vuelta) continue;
    usadas.add(vuelta.id);
    propuestas.push({ gasto: g, entradas: [vuelta], total: vuelta.importe, motivo: "misma-persona" });
  }
  // Luego, varios Bizums justo después de un gasto grande (primero los gastos más grandes)
  for (const g of gastos.filter((x) => !x.devuelto && x.importe <= -4000 && !propuestas.some((p) => p.gasto.id === x.id))) {
    const cerca = libres((e) => diasEntre(g.fecha, e.fecha) >= -1 && diasEntre(g.fecha, e.fecha) <= 3 && e.importe * 2 < -g.importe);
    const elegidas: MovimientoCompartido[] = [];
    let total = 0;
    for (const e of cerca) {
      if (total + e.importe > -g.importe * 1.05) continue;
      elegidas.push(e);
      total += e.importe;
    }
    if (elegidas.length < 2) continue;
    for (const e of elegidas) usadas.add(e.id);
    propuestas.push({ gasto: g, entradas: elegidas, total, motivo: "varios" });
  }
  return propuestas.sort((a, b) => b.gasto.fecha.localeCompare(a.gasto.fecha));
}

/** Une estas entradas a su gasto (lo decides tú: la detección no lo cambia). */
export function unirDevoluciones(bd: BaseDatos, gastoId: number, entradaIds: readonly number[]): number {
  return bd.transaccion(() =>
    entradaIds.reduce(
      (n, id) => n + bd.ejecutar("UPDATE apuntes SET devuelve_a = ?, devolucion_manual = 1 WHERE id = ? AND importe > 0 AND id != ?", gastoId, id, gastoId).cambios,
      0,
    ),
  );
}

/** «No es una devolución» o «sepáralo de ese gasto»: deja de contar como devolución y no se vuelve a proponer. */
export function separarDevoluciones(bd: BaseDatos, entradaIds: readonly number[]): number {
  return bd.transaccion(() => entradaIds.reduce((n, id) => n + bd.ejecutar("UPDATE apuntes SET devuelve_a = NULL, devolucion_manual = 1 WHERE id = ?", id).cambios, 0));
}

/** Para unir a mano: las entradas cercanas a un gasto (de 3 días antes a 45 después) que aún no son devolución de nada. */
export function entradasCercanas(bd: BaseDatos, gasto: MovimientoCompartido): MovimientoCompartido[] {
  return bd.todos<MovimientoCompartido>(
    `SELECT id, fecha, importe, concepto FROM apuntes WHERE importe > 0 AND devuelve_a IS NULL AND recurrente_id IS NULL AND coalesce(traspaso, 0) = 0
     AND fecha BETWEEN ? AND ? ORDER BY fecha, id`,
    sumarDias(gasto.fecha, -3),
    sumarDias(gasto.fecha, 45),
  );
}

/** Para unir a mano una entrada: los gastos de 45 días antes a 3 después que podrían ser el suyo. */
export function gastosCercanos(bd: BaseDatos, entrada: MovimientoCompartido): MovimientoCompartido[] {
  return bd.todos<MovimientoCompartido>(
    `SELECT id, fecha, importe, concepto FROM apuntes WHERE importe < 0 AND recurrente_id IS NULL AND coalesce(traspaso, 0) = 0
     AND fecha BETWEEN ? AND ? ORDER BY fecha DESC, id DESC`,
    sumarDias(entrada.fecha, -45),
    sumarDias(entrada.fecha, 3),
  );
}

/** Las devoluciones de un gasto. */
export function devolucionesDe(bd: BaseDatos, gastoId: number): MovimientoCompartido[] {
  return bd.todos<MovimientoCompartido>("SELECT id, fecha, importe, concepto FROM apuntes WHERE devuelve_a = ? ORDER BY fecha, id", gastoId);
}
