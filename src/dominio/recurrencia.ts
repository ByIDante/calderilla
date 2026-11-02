import type { Centimos } from "./dinero.ts";
import { diasDelMes, diasEntre, diferenciaMeses, indiceMes, mesDe, mesDesdeIndice, primerDia, sumarDias, sumarMeses, ultimoDia, type Fecha, type Mes } from "./fechas.ts";

export type Frecuencia = "semanal" | "catorcenal" | "quincenal" | "mensual" | "trimestral" | "semestral" | "anual";

/** De más a menos frecuente, como salen en el formulario. */
export const FRECUENCIAS: readonly Frecuencia[] = ["semanal", "catorcenal", "quincenal", "mensual", "trimestral", "semestral", "anual"];

/** Cuántas veces llega al año. Cada 2 semanas son 26 (dos meses al año llega 3 veces); dos veces al mes, 24. */
export const VECES_AL_ANIO: Record<Frecuencia, number> = { semanal: 52, catorcenal: 26, quincenal: 24, mensual: 12, trimestral: 4, semestral: 2, anual: 1 };

/** Cada cuántos meses llega (lo que llega varias veces al mes, en fracción: cada semana ≈ 0,23). */
export const MESES_FRECUENCIA = Object.fromEntries(FRECUENCIAS.map((f) => [f, 12 / VECES_AL_ANIO[f]])) as Record<Frecuencia, number>;

/** Lo que se cuenta por días desde el primer cargo, no por meses */
const DIAS_FRECUENCIA: Partial<Record<Frecuencia, number>> = { semanal: 7, catorcenal: 14 };

export const NOMBRE_FRECUENCIA: Record<Frecuencia, string> = {
  semanal: "a la semana",
  catorcenal: "cada 2 semanas",
  quincenal: "dos veces al mes",
  mensual: "al mes",
  trimestral: "cada 3 meses",
  semestral: "cada 6 meses",
  anual: "al año",
};

/** Para el desplegable «Cada cuánto» */
export const ETIQUETA_FRECUENCIA: Record<Frecuencia, string> = {
  semanal: "Cada semana",
  catorcenal: "Cada 2 semanas",
  quincenal: "Dos veces al mes (cada quincena)",
  mensual: "Una vez al mes",
  trimestral: "Cada 3 meses",
  semestral: "Cada 6 meses",
  anual: "Una vez al año",
};

/** Llega más de una vez al mes (cada semana, cada 2 semanas, dos veces al mes). */
export function variasAlMes(frecuencia: Frecuencia): boolean {
  return VECES_AL_ANIO[frecuencia] > 12;
}

/** Una paga extra de un ingreso: llega en esos meses (1-12) el mismo día que el cobro normal. */
export interface PagaExtra {
  nombre: string | null;
  meses: readonly number[];
  /** null: lo mismo que un cobro normal en ese momento (sigue las subidas) */
  importe: Centimos | null;
}

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
  /** Solo en ingresos: pagas extra que se reparten mes a mes, como los gastos anuales. */
  pagasExtra?: readonly PagaExtra[];
}

export interface VersionImporte {
  validoDesde: Fecha;
  importe: Centimos;
}

export type EstadoRecurrente = "activo" | "proximo" | "finalizado";

export function finPorCuotas(inicio: Fecha, frecuencia: Frecuencia, cuotas: number): Fecha {
  const dias = DIAS_FRECUENCIA[frecuencia];
  if (dias) return sumarDias(inicio, (cuotas - 1) * dias);
  // Dos veces al mes: los impares caen el día del primero y los pares 15 días después
  if (frecuencia === "quincenal") return cuotas % 2 ? sumarMeses(inicio, (cuotas - 1) / 2) : sumarMeses(sumarDias(inicio, 15), cuotas / 2 - 1);
  return sumarMeses(inicio, (cuotas - 1) * MESES_FRECUENCIA[frecuencia]);
}

/** Fechas de cargo entre `desde` y `hasta`, ambas incluidas. Se calculan siempre desde el inicio para no acumular desfases de días. */
export function ocurrencias(r: Recurrente, desde: Fecha, hasta: Fecha): Fecha[] {
  if (r.frecuencia === "quincenal") {
    // Dos series mensuales: la del primer cobro y otra 15 días después (el 1 y el 16, el 15 y el 30…)
    const mensual = { ...r, frecuencia: "mensual" as const };
    return [...ocurrencias(mensual, desde, hasta), ...ocurrencias({ ...mensual, inicio: sumarDias(r.inicio, 15) }, desde, hasta)].sort((a, b) => a.localeCompare(b));
  }
  const limite = r.fin && r.fin < hasta ? r.fin : hasta;
  const fechas: Fecha[] = [];
  const dias = DIAS_FRECUENCIA[r.frecuencia];
  if (dias) {
    let k = Math.max(0, Math.floor(diasEntre(r.inicio, desde) / dias));
    for (let fecha = sumarDias(r.inicio, k * dias); fecha <= limite; fecha = sumarDias(r.inicio, ++k * dias)) {
      if (fecha >= desde) fechas.push(fecha);
    }
    return fechas;
  }
  const paso = MESES_FRECUENCIA[r.frecuencia];
  // Salta directamente cerca de `desde` en vez de recorrer todos los cargos desde el inicio
  let k = Math.max(0, Math.floor(diferenciaMeses(r.inicio, desde) / paso) - 1);
  for (let fecha = sumarMeses(r.inicio, k * paso); fecha <= limite; fecha = sumarMeses(r.inicio, ++k * paso)) {
    if (fecha >= desde) fechas.push(fecha);
  }
  return fechas;
}

export function proximaOcurrencia(r: Recurrente, desde: Fecha): Fecha | null {
  // Lo que llega varias veces al mes siempre tiene un cargo en las próximas semanas (salvo que haya terminado)
  if (variasAlMes(r.frecuencia)) return ocurrencias(r, desde, sumarDias(r.inicio > desde ? r.inicio : desde, 31))[0] ?? null;
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

/** Lo que suman al año las pagas extra, con `importe` como cobro normal para las que no tienen uno propio. */
export function extrasAlAnio(r: Recurrente, importe: Centimos): Centimos {
  return (r.pagasExtra ?? []).reduce((suma, paga) => suma + (paga.importe ?? importe) * paga.meses.length, 0);
}

/**
 * Lo que pesa en el presupuesto de un mes. Un gasto que no es mensual se reparte entre los meses que lo
 * preceden (un seguro anual de 600 € cuenta 50 € al mes durante los 12 meses anteriores a cada cargo). Lo que
 * llega varias veces al mes cuenta su media (cada semana, 52 cobros ÷ 12). Las pagas extra se reparten entre
 * los 12 meses: 14 pagas de 1.500 € cuentan 1.750 € todos los meses.
 */
export function mensualEn(r: Recurrente, versiones: readonly VersionImporte[], mes: Mes): Centimos {
  const indice = indiceMes(mes);
  if (r.fin && indice > indiceMes(r.fin)) return 0;
  const importe = importeEn(versiones, ultimoDia(mes));
  const extras = indice >= indiceMes(r.inicio) ? extrasAlAnio(r, importe) / 12 : 0;
  if (variasAlMes(r.frecuencia)) {
    if (indice < indiceMes(r.inicio)) return 0;
    return Math.round((importe * VECES_AL_ANIO[r.frecuencia]) / 12 + extras);
  }
  const paso = MESES_FRECUENCIA[r.frecuencia];
  if (indice < indiceMes(r.inicio) - (paso - 1)) return 0;
  return Math.round(importe / paso + extras);
}

/** Ese día en ese mes, o el último del mes si es más corto (el 31 en febrero es el 28 o el 29) */
function diaEnMes(mes: Mes, dia: number): Fecha {
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  return `${mes}-${String(Math.min(dia, diasDelMes(anio, numero))).padStart(2, "0")}`;
}

/** Las pagas extra que llegan en un mes, con su fecha (el día del cobro normal) y su importe. */
export function pagasEnMes(r: Recurrente, versiones: readonly VersionImporte[], mes: Mes): { nombre: string | null; fecha: Fecha; importe: Centimos }[] {
  if (!r.pagasExtra?.length) return [];
  const fecha = diaEnMes(mes, Number(r.inicio.slice(8, 10)));
  if (fecha < r.inicio || (r.fin && fecha > r.fin)) return [];
  const numero = Number(mes.slice(5, 7));
  return r.pagasExtra.filter((paga) => paga.meses.includes(numero)).map((paga) => ({ nombre: paga.nombre, fecha, importe: paga.importe ?? importeEn(versiones, fecha) }));
}

/** Lo que se cobra o se paga de verdad en un mes: cada cargo con su importe de ese día, más las pagas extra. */
export function cobrosEnMes(r: Recurrente, versiones: readonly VersionImporte[], mes: Mes): Centimos {
  const normal = ocurrencias(r, primerDia(mes), ultimoDia(mes)).reduce((suma, fecha) => suma + importeEn(versiones, fecha), 0);
  return normal + pagasEnMes(r, versiones, mes).reduce((suma, paga) => suma + paga.importe, 0);
}

/**
 * Lo que ya deberías tener apartado de un gasto no mensual: un seguro anual de 600 € que se cobra dentro
 * de 3 meses lleva 9 de 12 meses acumulando, es decir 450 €.
 */
export function provisionAcumulada(r: Recurrente, versiones: readonly VersionImporte[], fecha: Fecha): Centimos {
  const paso = MESES_FRECUENCIA[r.frecuencia];
  if (r.tipo !== "gasto" || paso <= 1) return 0;
  const proxima = proximaOcurrencia(r, fecha);
  if (!proxima) return 0;
  const faltan = diferenciaMeses(mesDe(fecha), mesDe(proxima));
  if (faltan >= paso) return 0;
  return Math.round((importeEn(versiones, proxima) * (paso - faltan)) / paso);
}

/**
 * Lo contrario de la provisión, en los ingresos: lo que el presupuesto ya ha contado y aún no has cobrado.
 * El presupuesto reparte las pagas extra entre los 12 meses, cuenta la media de lo que llega varias veces al
 * mes y adelanta lo trimestral o anual; aquí se suma lo que contó mes a mes hasta `fecha` y se resta lo cobrado
 * de verdad. Sirve para medir el ahorro real de cada mes: sin esto, con 14 pagas (o cobrando cada 2 semanas),
 * los meses normales parecería que ahorras menos de lo previsto. Para final de mes (los cierres).
 */
export function devengoAcumulado(r: Recurrente, versiones: readonly VersionImporte[], fecha: Fecha): Centimos {
  if (r.tipo !== "ingreso" || fecha < sumarMeses(r.inicio, -11)) return 0;
  let contado = 0;
  // Desde el primer mes que puede contar (lo anual empieza a repartirse 11 meses antes del primer cobro)
  for (let indice = indiceMes(r.inicio) - 11; indice <= indiceMes(fecha); indice++) contado += mensualEn(r, versiones, mesDesdeIndice(indice));
  let cobrado = ocurrencias(r, r.inicio, fecha).reduce((suma, dia) => suma + importeEn(versiones, dia), 0);
  for (let indice = indiceMes(r.inicio); indice <= indiceMes(fecha); indice++) {
    cobrado += pagasEnMes(r, versiones, mesDesdeIndice(indice))
      .filter((paga) => paga.fecha <= fecha)
      .reduce((suma, paga) => suma + paga.importe, 0);
  }
  return contado - cobrado;
}

export interface DesgloseAnual {
  /** Cada cobro o cargo normal */
  importe: Centimos;
  veces: number;
  normal: Centimos;
  pagas: { nombre: string | null; meses: readonly number[]; importe: Centimos; total: Centimos }[];
  total: Centimos;
  /** Lo que cuenta cada mes en el presupuesto: el total entre 12 */
  alMes: Centimos;
}

/** Cuánto suma en un año, con el importe vigente en `fecha`: los cobros normales y cada paga extra. */
export function desgloseAnual(r: Recurrente, versiones: readonly VersionImporte[], fecha: Fecha): DesgloseAnual {
  const importe = importeEn(versiones, fecha);
  const veces = VECES_AL_ANIO[r.frecuencia];
  const pagas = (r.pagasExtra ?? []).map((paga) => ({ nombre: paga.nombre, meses: paga.meses, importe: paga.importe ?? importe, total: (paga.importe ?? importe) * paga.meses.length }));
  const total = importe * veces + pagas.reduce((suma, paga) => suma + paga.total, 0);
  return { importe, veces, normal: importe * veces, pagas, total, alMes: Math.round(total / 12) };
}
