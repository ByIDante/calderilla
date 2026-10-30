import type { Centimos } from "./dinero.ts";
import { diferenciaMeses, indiceMes, mesDe, sumarMeses, ultimoDia, type Fecha, type Mes } from "./fechas.ts";

export type Frecuencia = "mensual" | "trimestral" | "semestral" | "anual";

export const MESES_FRECUENCIA: Record<Frecuencia, number> = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };

export const NOMBRE_FRECUENCIA: Record<Frecuencia, string> = {
  mensual: "al mes",
  trimestral: "cada 3 meses",
  semestral: "cada 6 meses",
  anual: "al año",
};

export interface Recurrente {
  id: number;
  tipo: "ingreso" | "gasto";
  nombre: string;
  frecuencia: Frecuencia;
  /** Fecha del primer cargo o cobro. */
  inicio: Fecha;
  /** Fecha del último cargo o cobro; null si no tiene fin. */
  fin: Fecha | null;
  esencial: boolean;
}

export interface VersionImporte {
  validoDesde: Fecha;
  importe: Centimos;
}

export type EstadoRecurrente = "activo" | "proximo" | "finalizado";

export function finPorCuotas(inicio: Fecha, frecuencia: Frecuencia, cuotas: number): Fecha {
  return sumarMeses(inicio, (cuotas - 1) * MESES_FRECUENCIA[frecuencia]);
}

/** Fechas de cargo entre `desde` y `hasta`, ambas incluidas. Se calculan siempre desde el inicio para no acumular desfases de días. */
export function ocurrencias(r: Recurrente, desde: Fecha, hasta: Fecha): Fecha[] {
  const paso = MESES_FRECUENCIA[r.frecuencia];
  const limite = r.fin && r.fin < hasta ? r.fin : hasta;
  const fechas: Fecha[] = [];
  // Salta directamente cerca de `desde` en vez de recorrer todos los cargos desde el inicio
  let k = Math.max(0, Math.floor(diferenciaMeses(r.inicio, desde) / paso) - 1);
  for (let fecha = sumarMeses(r.inicio, k * paso); fecha <= limite; fecha = sumarMeses(r.inicio, ++k * paso)) {
    if (fecha >= desde) fechas.push(fecha);
  }
  return fechas;
}

export function proximaOcurrencia(r: Recurrente, desde: Fecha): Fecha | null {
  const paso = MESES_FRECUENCIA[r.frecuencia];
  let k = Math.max(0, Math.floor(diferenciaMeses(r.inicio, desde) / paso) - 1);
  for (;;) {
    const fecha = sumarMeses(r.inicio, k * paso);
    if (r.fin && fecha > r.fin) return null;
    if (fecha >= desde) return fecha;
    k++;
  }
}

export function estadoEn(r: Recurrente, fecha: Fecha): EstadoRecurrente {
  if (r.fin && r.fin < fecha) return "finalizado";
  if (r.inicio > fecha) return "proximo";
  return "activo";
}

/** Cargos que quedan desde `fecha` (incluida); null si no tiene fin. */
export function cuotasRestantes(r: Recurrente, fecha: Fecha): number | null {
  if (!r.fin) return null;
  return ocurrencias(r, fecha, r.fin).length;
}

/** El importe vigente en una fecha: la última versión que empezó antes o ese mismo día. */
export function importeEn(versiones: readonly VersionImporte[], fecha: Fecha): Centimos {
  let elegido: VersionImporte | undefined;
  for (const version of versiones) {
    if (version.validoDesde <= fecha && (!elegido || version.validoDesde > elegido.validoDesde)) elegido = version;
  }
  // Antes de la primera versión se usa la más antigua, para no dejar meses a cero
  elegido ??= [...versiones].sort((a, b) => a.validoDesde.localeCompare(b.validoDesde))[0];
  return elegido?.importe ?? 0;
}

/**
 * Lo que pesa en el presupuesto de un mes. Un gasto que no es mensual se reparte entre los meses que lo
 * preceden (un seguro anual de 600 € cuenta 50 € al mes durante los 12 meses anteriores a cada cargo).
 */
export function mensualEn(r: Recurrente, versiones: readonly VersionImporte[], mes: Mes): Centimos {
  const paso = MESES_FRECUENCIA[r.frecuencia];
  const indice = indiceMes(mes);
  if (indice < indiceMes(r.inicio) - (paso - 1)) return 0;
  if (r.fin && indice > indiceMes(r.fin)) return 0;
  return Math.round(importeEn(versiones, ultimoDia(mes)) / paso);
}

/**
 * Lo que ya deberías tener apartado de un gasto no mensual: un seguro anual de 600 € que se cobra dentro
 * de 3 meses lleva 9 de 12 meses acumulando, es decir 450 €.
 */
export function provisionAcumulada(r: Recurrente, versiones: readonly VersionImporte[], fecha: Fecha): Centimos {
  const paso = MESES_FRECUENCIA[r.frecuencia];
  if (r.tipo !== "gasto" || paso === 1) return 0;
  const proxima = proximaOcurrencia(r, fecha);
  if (!proxima) return 0;
  const faltan = diferenciaMeses(mesDe(fecha), mesDe(proxima));
  if (faltan >= paso) return 0;
  return Math.round((importeEn(versiones, proxima) * (paso - faltan)) / paso);
}
