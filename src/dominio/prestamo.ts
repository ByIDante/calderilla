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
}

export interface FilaCuadro {
  numero: number;
  fecha: Fecha;
  cuota: Centimos;
  intereses: Centimos;
  amortizacion: Centimos;
  pendiente: Centimos;
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
  const cuota = cuotaMensual(p.capital, p.tin, p.plazoMeses);
  const i = p.tin / 100 / 12;
  const filas: FilaCuadro[] = [];
  let pendiente = p.capital;
  for (let n = 1; n <= p.plazoMeses; n++) {
    const intereses = Math.round(pendiente * i);
    // La última cuota absorbe los céntimos que hayan ido sobrando por redondeo
    const amortizacion = n === p.plazoMeses ? pendiente : Math.min(cuota - intereses, pendiente);
    pendiente -= amortizacion;
    filas.push({ numero: n, fecha: sumarMeses(p.primeraCuota, n - 1), cuota: intereses + amortizacion, intereses, amortizacion, pendiente });
  }
  return filas;
}

export function finPrestamo(p: Prestamo): Fecha {
  return sumarMeses(p.primeraCuota, p.plazoMeses - 1);
}

/** Lo que queda por devolver tras las cuotas cobradas hasta `fecha` (incluida). */
export function pendienteEn(p: Prestamo, fecha: Fecha): Centimos {
  let pendiente = p.capital;
  for (const fila of cuadroAmortizacion(p)) {
    if (fila.fecha > fecha) break;
    pendiente = fila.pendiente;
  }
  return pendiente;
}

export function cuotasRestantesPrestamo(p: Prestamo, fecha: Fecha): number {
  return cuadroAmortizacion(p).filter((fila) => fila.fecha > fecha).length;
}
