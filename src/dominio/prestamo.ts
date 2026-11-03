import type { Centimos } from "./dinero.ts";
import { sumarMeses, type Fecha } from "./fechas.ts";

export interface Prestamo {
  capital: Centimos;
  /** Tipo nominal anual en %, p. ej. 5,5. */
  tin: number;
  /** TAE en %, si la sabes; si no, se aproxima a partir del TIN. */
  tae: number | null;
  plazoMeses: number;
  primeraCuota: Fecha;
  /** Comisión por amortizar antes de tiempo, en % de lo amortizado. */
  comisionAmortizacion: number;
  /** El precio del coche o del producto dependía de mantener esta financiación. */
  vinculado: boolean;
  /**
   * Cuota final de una financiación con valor futuro garantizado (coches, motos): el pago grande que llega el
   * mes siguiente a la última cuota normal, cuando decides si la pagas, la refinancias o devuelves el vehículo.
   */
  cuotaFinal?: Centimos;
  /** Pagos anticipados, en cualquier orden. */
  amortizaciones?: readonly Amortizacion[];
}

export interface Amortizacion {
  fecha: Fecha;
  importe: Centimos;
  /** «cuota»: baja la cuota y se mantiene el plazo; «plazo»: se mantiene la cuota y se termina antes. */
  modo: "cuota" | "plazo";
}

export interface FilaCuadro {
  numero: number;
  fecha: Fecha;
  cuota: Centimos;
  intereses: Centimos;
  amortizacion: Centimos;
  pendiente: Centimos;
  /** Lo amortizado por adelantado justo antes de esta cuota. */
  anticipado: Centimos;
  /** Es la cuota final (el pago grande del final), no una cuota normal. */
  final?: boolean;
}

/**
 * Cuota del sistema francés: la misma todos los meses. Con cuota final, las cuotas devuelven solo lo que no
 * cubre ese pago del final (que llega un mes después de la última cuota normal).
 */
export function cuotaMensual(capital: Centimos, tin: number, meses: number, cuotaFinal: Centimos = 0): Centimos {
  if (meses <= 0) return capital;
  const i = tin / 100 / 12;
  if (i === 0) return Math.round((capital - cuotaFinal) / meses);
  return Math.round(((capital - cuotaFinal * (1 + i) ** -(meses + 1)) * i) / (1 - (1 + i) ** -meses));
}

export function taeAproximada(tin: number): number {
  return ((1 + tin / 100 / 12) ** 12 - 1) * 100;
}

export function taeDe(p: Prestamo): number {
  return p.tae ?? taeAproximada(p.tin);
}

export function cuadroAmortizacion(p: Prestamo): FilaCuadro[] {
  const i = p.tin / 100 / 12;
  const pendientes = [...(p.amortizaciones ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const filas: FilaCuadro[] = [];
  const final = p.cuotaFinal ?? 0;
  let cuota = cuotaMensual(p.capital, p.tin, p.plazoMeses, final);
  let pendiente = p.capital;
  // Sin pagos anticipados, la cuota final es la del contrato: los céntimos del redondeo van a la última cuota normal
  const finalExacta = Boolean(final) && !pendientes.length;
  const antesDeLaFinal = i === 0 ? final : Math.round(final / (1 + i));
  // Con cuota final hay un pago más, el mes siguiente a la última cuota normal: lo que quede pendiente
  for (let n = 1; n <= p.plazoMeses + (final ? 1 : 0) && pendiente > 0; n++) {
    const fecha = sumarMeses(p.primeraCuota, n - 1);
    // Las amortizaciones hechas antes de esta cuota reducen lo pendiente y, según el modo, la cuota o el plazo
    let anticipado = 0;
    while (pendientes[0] && pendientes[0].fecha < fecha) {
      const a = pendientes.shift()!;
      const importe = Math.min(a.importe, pendiente);
      pendiente -= importe;
      anticipado += importe;
      // Con cuota final, «acortar plazo» no adelanta el final del contrato: baja lo que queda para la cuota final
      if (a.modo === "cuota" && pendiente > 0 && n <= p.plazoMeses) cuota = cuotaMensual(pendiente, p.tin, p.plazoMeses - n + 1, final);
    }
    if (pendiente <= 0) {
      filas.push({ numero: n, fecha, cuota: 0, intereses: 0, amortizacion: 0, pendiente: 0, anticipado });
      break;
    }
    const esFinal = Boolean(final) && n === p.plazoMeses + 1;
    const intereses = esFinal && finalExacta ? Math.max(final - pendiente, 0) : Math.round(pendiente * i);
    // La última cuota (la final, si la hay) absorbe lo que quede, también los céntimos sobrantes por redondeo
    const ultima = final ? esFinal : n === p.plazoMeses;
    const amortizacion =
      ultima || cuota - intereses >= pendiente
        ? pendiente
        : finalExacta && n === p.plazoMeses
          ? Math.max(pendiente - antesDeLaFinal, 0)
          : cuota - intereses;
    pendiente -= amortizacion;
    filas.push({ numero: n, fecha, cuota: intereses + amortizacion, intereses, amortizacion, pendiente, anticipado, ...(esFinal ? { final: true } : {}) });
  }
  return filas;
}

export function interesesTotales(p: Prestamo): Centimos {
  return cuadroAmortizacion(p).reduce((suma, fila) => suma + fila.intereses, 0);
}

/** Fecha del último pago, la cuota final si la hay (antes si se ha amortizado reduciendo plazo). */
export function finPrestamo(p: Prestamo): Fecha {
  const ultima = cuadroAmortizacion(p).filter((fila) => fila.cuota > 0).at(-1);
  return ultima?.fecha ?? p.primeraCuota;
}

/** Fecha de la última cuota normal: hasta ahí se paga cada mes (la cuota final va aparte). */
export function finCuotas(p: Prestamo): Fecha {
  const ultima = cuadroAmortizacion(p).filter((fila) => fila.cuota > 0 && !fila.final).at(-1);
  return ultima?.fecha ?? p.primeraCuota;
}

/** La cuota final que queda por pagar a partir de `fecha` (incluida), con su fecha; null si no tiene o ya se pagó. */
export function cuotaFinalPendiente(p: Prestamo, fecha: Fecha): { importe: Centimos; fecha: Fecha } | null {
  const fila = cuadroAmortizacion(p).find((f) => f.final);
  return fila && fila.fecha >= fecha && fila.cuota > 0 ? { importe: fila.cuota, fecha: fila.fecha } : null;
}

/** Lo que queda por devolver tras las cuotas cobradas y lo amortizado hasta `fecha` (incluida). */
export function pendienteEn(p: Prestamo, fecha: Fecha): Centimos {
  let pendiente = p.capital;
  let ultimaCuota = "";
  for (const fila of cuadroAmortizacion(p)) {
    if (fila.fecha > fecha) break;
    pendiente = fila.pendiente;
    ultimaCuota = fila.fecha;
  }
  // Lo amortizado después de la última cuota cobrada aún no aparece en el cuadro
  for (const a of p.amortizaciones ?? []) {
    if (a.fecha >= ultimaCuota && a.fecha <= fecha) pendiente -= Math.min(a.importe, pendiente);
  }
  return pendiente;
}

export function cuotasRestantesPrestamo(p: Prestamo, fecha: Fecha): number {
  return cuadroAmortizacion(p).filter((fila) => fila.fecha > fecha).length;
}
