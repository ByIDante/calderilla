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
}

/** Cuota del sistema francés: la misma todos los meses. */
export function cuotaMensual(capital: Centimos, tin: number, meses: number): Centimos {
  if (meses <= 0) return capital;
  const i = tin / 100 / 12;
  if (i === 0) return Math.round(capital / meses);
  return Math.round((capital * i) / (1 - (1 + i) ** -meses));
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
  let cuota = cuotaMensual(p.capital, p.tin, p.plazoMeses);
  let pendiente = p.capital;
  for (let n = 1; n <= p.plazoMeses && pendiente > 0; n++) {
    const fecha = sumarMeses(p.primeraCuota, n - 1);
    // Las amortizaciones hechas antes de esta cuota reducen lo pendiente y, según el modo, la cuota o el plazo
    let anticipado = 0;
    while (pendientes[0] && pendientes[0].fecha < fecha) {
      const a = pendientes.shift()!;
      const importe = Math.min(a.importe, pendiente);
      pendiente -= importe;
      anticipado += importe;
      if (a.modo === "cuota" && pendiente > 0) cuota = cuotaMensual(pendiente, p.tin, p.plazoMeses - n + 1);
    }
    if (pendiente <= 0) {
      filas.push({ numero: n, fecha, cuota: 0, intereses: 0, amortizacion: 0, pendiente: 0, anticipado });
      break;
    }
    const intereses = Math.round(pendiente * i);
    // La última cuota absorbe los céntimos que hayan ido sobrando por redondeo
    const amortizacion = n === p.plazoMeses || cuota - intereses >= pendiente ? pendiente : cuota - intereses;
    pendiente -= amortizacion;
    filas.push({ numero: n, fecha, cuota: intereses + amortizacion, intereses, amortizacion, pendiente, anticipado });
  }
  return filas;
}

export function interesesTotales(p: Prestamo): Centimos {
  return cuadroAmortizacion(p).reduce((suma, fila) => suma + fila.intereses, 0);
}

/** Fecha de la última cuota (antes si se ha amortizado reduciendo plazo). */
export function finPrestamo(p: Prestamo): Fecha {
  const ultima = cuadroAmortizacion(p).filter((fila) => fila.cuota > 0).at(-1);
  return ultima?.fecha ?? p.primeraCuota;
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
