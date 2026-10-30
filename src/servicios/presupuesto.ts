import type { BaseDatos } from "../datos/db.ts";
import { eurosRedondos as eur } from "../dominio/dinero.ts";
import { diasDelMes, mesDe, primerDia, sumarMesesAMes, ultimoDia, type Fecha, type Mes } from "../dominio/fechas.ts";
import { mensualEn } from "../dominio/recurrencia.ts";
import type { Aviso } from "../reglas/tipos.ts";
import { leerRecurrentes } from "./finanzas.ts";

/*
 * Presupuesto por categorías: cuánto quieres gastar como mucho al mes en lo que varía (comida, gasolina,
 * restaurantes…), comparado con lo que apuntas o importas del banco. Los cargos de gastos fijos no cuentan
 * aquí: ya están en el presupuesto general.
 */

export interface LineaPresupuesto {
  categoriaId: number;
  nombre: string;
  tipo: string;
  limite: number | null;
  gastado: number;
  /** Lo que tienes estimado en «Ingresos y gastos» para esta categoría (p. ej. «Comida, 300 €»). */
  sugerido: number | null;
  /** A este ritmo, lo que gastarás en todo el mes (solo el mes en curso). */
  proyeccion: number | null;
}

export function presupuestoPorCategoria(bd: BaseDatos, mes: Mes, hoy: Fecha): LineaPresupuesto[] {
  const categorias = bd.todos<{ id: number; nombre: string; tipo: string; limite: number | null }>(
    "SELECT c.id, c.nombre, c.tipo, l.limite FROM categorias c LEFT JOIN limites_categoria l ON l.categoria_id = c.id WHERE c.archivada = 0 AND c.tipo != 'ingreso' ORDER BY c.nombre",
  );
  const gastos = new Map(
    bd
      .todos<{ categoria_id: number; gastado: number }>(
        "SELECT categoria_id, -sum(importe) AS gastado FROM apuntes WHERE importe < 0 AND recurrente_id IS NULL AND categoria_id IS NOT NULL AND fecha BETWEEN ? AND ? GROUP BY categoria_id",
        primerDia(mes),
        ultimoDia(mes),
      )
      .map((f) => [f.categoria_id, f.gastado]),
  );
  const estimados = new Map<number, number>();
  for (const r of leerRecurrentes(bd).filter((x) => x.tipo === "gasto" && x.clase === "estimacion" && x.categoriaId)) {
    estimados.set(r.categoriaId!, (estimados.get(r.categoriaId!) ?? 0) + mensualEn(r, r.versiones, mes));
  }
  const enCurso = mes === mesDe(hoy);
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  const dia = Number(hoy.slice(8, 10));
  return categorias.map((c) => {
    const gastado = gastos.get(c.id) ?? 0;
    return {
      categoriaId: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      limite: c.limite,
      gastado,
      sugerido: estimados.get(c.id) || null,
      proyeccion: enCurso && dia >= 5 ? Math.round((gastado / dia) * diasDelMes(anio, numero)) : null,
    };
  });
}

/** Avisos cuando te pasas de un límite o vas camino de pasarte. */
export function avisosPresupuesto(lineas: readonly LineaPresupuesto[]): Aviso[] {
  const avisos: Aviso[] = [];
  for (const l of lineas) {
    if (!l.limite) continue;
    if (l.gastado > l.limite) {
      avisos.push({ nivel: "atencion", texto: `Te has pasado del presupuesto de ${l.nombre}: llevas ${eur(l.gastado)} de ${eur(l.limite)} este mes.` });
    } else if (l.proyeccion !== null && l.proyeccion > l.limite * 1.1 && l.gastado > l.limite * 0.5) {
      avisos.push({ nivel: "info", texto: `A este ritmo gastarás unos ${eur(l.proyeccion)} en ${l.nombre} este mes (tu límite es ${eur(l.limite)}).` });
    }
  }
  return avisos;
}

export function guardarLimites(bd: BaseDatos, limites: ReadonlyMap<number, number | null>) {
  bd.transaccion(() => {
    for (const [categoria, limite] of limites) {
      if (limite && limite > 0) {
        bd.ejecutar("INSERT INTO limites_categoria (categoria_id, limite) VALUES (?, ?) ON CONFLICT (categoria_id) DO UPDATE SET limite = excluded.limite", categoria, limite);
      } else {
        bd.ejecutar("DELETE FROM limites_categoria WHERE categoria_id = ?", categoria);
      }
    }
  });
}

export interface GastoMensual {
  meses: Mes[];
  series: { nombre: string; valores: number[] }[];
}

/**
 * Lo que salió cada mes por categoría, según tus movimientos (apuntados, importados o del banco). Las 5
 * categorías con más gasto van por separado y el resto se junta en «Otras».
 */
export function gastoPorCategoriaMeses(bd: BaseDatos, hasta: Mes, numeroMeses = 12): GastoMensual {
  const meses = Array.from({ length: numeroMeses }, (_, i) => sumarMesesAMes(hasta, i - (numeroMeses - 1)));
  const filas = bd.todos<{ mes: string; categoria: string | null; total: number }>(
    `SELECT substr(a.fecha, 1, 7) AS mes, c.nombre AS categoria, -sum(a.importe) AS total FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id
     WHERE a.importe < 0 AND a.fecha BETWEEN ? AND ? GROUP BY mes, categoria`,
    primerDia(meses[0]!),
    ultimoDia(hasta),
  );
  const totales = new Map<string, number>();
  for (const f of filas) totales.set(f.categoria ?? "Sin categoría", (totales.get(f.categoria ?? "Sin categoría") ?? 0) + f.total);
  const principales = [...totales].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre]) => nombre);
  const nombreDe = (categoria: string | null) => (principales.includes(categoria ?? "Sin categoría") ? (categoria ?? "Sin categoría") : "Otras");
  const nombres = [...principales, ...(totales.size > principales.length ? ["Otras"] : [])];
  const valores = new Map(nombres.map((n) => [n, meses.map(() => 0)]));
  for (const f of filas) {
    const i = meses.indexOf(f.mes);
    if (i >= 0) valores.get(nombreDe(f.categoria))![i]! += f.total;
  }
  return { meses, series: nombres.map((nombre) => ({ nombre, valores: valores.get(nombre)! })) };
}
