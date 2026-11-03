import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { mesDe, primerDia, sumarMesesAMes, ultimoDia, type Fecha, type Mes } from "../dominio/fechas.ts";
import { NETO } from "./compartidos.ts";
import { ocioGastadoEn } from "./situacion.ts";

/*
 * Tu año en cifras: lo que entró y salió de verdad cada mes según tus movimientos (apuntados, importados o del
 * banco), por categorías y comparado con el año anterior. Los traspasos entre tus cuentas no cuentan y un gasto
 * compartido cuenta solo lo tuyo, como en el resto de la app.
 */

export interface MesDelAnio {
  mes: Mes;
  /** Sin movimientos ese mes (antes de empezar a usar la app, por ejemplo): no se sabe */
  conDatos: boolean;
  ingresos: Centimos;
  gastos: Centimos;
  ocio: Centimos;
  /** Lo que ahorraste según el cierre del mes (null si no se cerró) */
  ahorroReal: Centimos | null;
}

export interface CategoriaDelAnio {
  nombre: string;
  total: Centimos;
  /** Para comparar con el año anterior: lo de este año en los meses que tienen movimientos en los dos */
  comparable: Centimos | null;
  /** Lo de esos mismos meses del año anterior (null si entonces no había movimientos) */
  anterior: Centimos | null;
}

export interface Anio {
  anio: number;
  meses: MesDelAnio[];
  ingresos: Centimos;
  gastos: Centimos;
  ocio: Centimos;
  /** Los meses con movimientos */
  mesesConDatos: number;
  categorias: CategoriaDelAnio[];
  /** Los meses que tienen movimientos este año y el anterior (los del anterior): lo de cada año en ellos */
  comparacion: { meses: Mes[]; ahora: Totales; antes: Totales } | null;
  /** Lo que tenías en el primer y el último cierre del año */
  patrimonio: { desde: Mes; inicio: Centimos; hasta: Mes; fin: Centimos } | null;
  /** El primer año con movimientos (para no ofrecer años vacíos) */
  primerAnio: number | null;
}

export interface Totales {
  ingresos: Centimos;
  gastos: Centimos;
}

/** Entradas y salidas de un mes: sin traspasos; lo que te devuelven de un gasto no es una entrada */
function totalesMes(bd: BaseDatos, mes: Mes): Totales & { movimientos: number } {
  const fila = bd.uno<{ ingresos: number | null; gastos: number | null; movimientos: number }>(
    `SELECT sum(CASE WHEN a.importe > 0 AND a.devuelve_a IS NULL THEN a.importe END) AS ingresos, -sum(CASE WHEN a.importe < 0 THEN ${NETO} END) AS gastos,
            count(*) AS movimientos
     FROM apuntes a WHERE coalesce(a.traspaso, 0) = 0 AND a.fecha BETWEEN ? AND ?`,
    primerDia(mes),
    ultimoDia(mes),
  );
  return { ingresos: fila?.ingresos ?? 0, gastos: fila?.gastos ?? 0, movimientos: fila?.movimientos ?? 0 };
}

/** Lo que salió por categoría en estos meses */
function porCategoria(bd: BaseDatos, meses: readonly Mes[]): Map<string, Centimos> {
  const total = new Map<string, Centimos>();
  for (const mes of meses) {
    const filas = bd.todos<{ categoria: string | null; total: number }>(
      `SELECT c.nombre AS categoria, -sum(${NETO}) AS total FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id
       WHERE a.importe < 0 AND coalesce(a.traspaso, 0) = 0 AND a.fecha BETWEEN ? AND ? GROUP BY c.nombre`,
      primerDia(mes),
      ultimoDia(mes),
    );
    for (const f of filas) total.set(f.categoria ?? "Sin categoría", (total.get(f.categoria ?? "Sin categoría") ?? 0) + f.total);
  }
  return total;
}

/** El año `anio` hasta hoy (los meses que aún no han llegado no salen). */
export function resumenAnual(bd: BaseDatos, anio: number, hoy: Fecha): Anio {
  const hasta = mesDe(hoy);
  const todos = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= hasta);
  const cierres = new Map(
    bd.todos<{ mes: string; ahorro_real: number | null; patrimonio: number }>("SELECT mes, ahorro_real, patrimonio FROM cierres_mes WHERE mes LIKE ? ORDER BY mes", `${anio}-%`).map((c) => [c.mes, c]),
  );
  const meses: MesDelAnio[] = todos.map((mes) => {
    const t = totalesMes(bd, mes);
    return { mes, conDatos: t.movimientos > 0, ingresos: t.ingresos, gastos: t.gastos, ocio: t.movimientos ? ocioGastadoEn(bd, primerDia(mes)) : 0, ahorroReal: cierres.get(mes)?.ahorro_real ?? null };
  });
  const conDatos = meses.filter((m) => m.conDatos);
  const suma = (lista: readonly MesDelAnio[], campo: "ingresos" | "gastos" | "ocio") => lista.reduce((s, m) => s + m[campo], 0);

  // Con el año anterior se comparan solo los meses que tienen movimientos en los dos
  const comparables = conDatos.filter((m) => totalesMes(bd, sumarMesesAMes(m.mes, -12)).movimientos > 0);
  const previos = comparables.map((m) => sumarMesesAMes(m.mes, -12));
  const antes = previos.length ? porCategoria(bd, previos) : null;
  const ahoraComparable = antes ? porCategoria(bd, comparables.map((m) => m.mes)) : null;
  const categorias = [...porCategoria(bd, conDatos.map((m) => m.mes))]
    .map(([nombre, total]) => ({ nombre, total, comparable: ahoraComparable ? (ahoraComparable.get(nombre) ?? 0) : null, anterior: antes ? (antes.get(nombre) ?? 0) : null }))
    .sort((a, b) => b.total - a.total);
  // Lo que había el año anterior en una categoría que este año no sale también cuenta
  for (const [nombre, anterior] of antes ?? []) if (!categorias.some((c) => c.nombre === nombre)) categorias.push({ nombre, total: 0, comparable: 0, anterior });
  const totales = (lista: readonly Mes[]): Totales =>
    lista.map((mes) => totalesMes(bd, mes)).reduce((s, t) => ({ ingresos: s.ingresos + t.ingresos, gastos: s.gastos + t.gastos }), { ingresos: 0, gastos: 0 });

  const cerrados = [...cierres.values()];
  const primero = bd.uno<{ fecha: string | null }>("SELECT min(fecha) AS fecha FROM apuntes")?.fecha ?? null;
  return {
    anio,
    meses,
    ingresos: suma(conDatos, "ingresos"),
    gastos: suma(conDatos, "gastos"),
    ocio: suma(conDatos, "ocio"),
    mesesConDatos: conDatos.length,
    categorias,
    comparacion: previos.length ? { meses: previos, ahora: totales(comparables.map((m) => m.mes)), antes: totales(previos) } : null,
    patrimonio:
      cerrados.length >= 2 ? { desde: cerrados[0]!.mes, inicio: cerrados[0]!.patrimonio, hasta: cerrados.at(-1)!.mes, fin: cerrados.at(-1)!.patrimonio } : null,
    primerAnio: primero ? Number(primero.slice(0, 4)) : null,
  };
}
