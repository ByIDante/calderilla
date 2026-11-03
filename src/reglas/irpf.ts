/*
 * Una estimación del IRPF de un sueldo, para saber tu tipo marginal: cuánto te ahorrarías de impuestos por cada
 * euro que aportes a un plan de pensiones. Es una aproximación para asalariados (sin hijos, deducciones ni
 * situaciones especiales); lo exacto sale en tu declaración de la renta.
 *
 * Valores de 2026, comprobados el 3/11/2026:
 * - Cotización del trabajador: 4,70 % contingencias comunes + 1,55 % desempleo (contrato indefinido) + 0,10 %
 *   formación + 0,15 % MEI = 6,50 % (Orden PJC/297/2026).
 * - Gastos deducibles: la cotización y 2.000 € de otros gastos (art. 19 LIRPF).
 * - Reducción por rendimientos del trabajo (art. 20 LIRPF): 7.302 € hasta 14.852 € de rendimiento neto, que
 *   baja hasta desaparecer a 19.747,50 €.
 * - Mínimo personal: 5.550 €, también en Cataluña.
 * Las escalas (estatal y de Cataluña) están en los datos de mercado, con su fuente.
 */

export interface Tramo {
  /** Hasta qué base, en euros (null: sin límite) */
  hasta: number | null;
  /** Tipo en % */
  tipo: number;
}

export const COTIZACION_TRABAJADOR = 6.5;
export const OTROS_GASTOS = 2000;
export const MINIMO_PERSONAL = 5550;

export function reduccionTrabajo(rendimientoNeto: number): number {
  if (rendimientoNeto <= 14852) return 7302;
  if (rendimientoNeto <= 17673.52) return 7302 - 1.75 * (rendimientoNeto - 14852);
  if (rendimientoNeto <= 19747.5) return 2364.34 - 1.14 * (rendimientoNeto - 17673.52);
  return 0;
}

/** Lo que sale de aplicar una escala a una base (cada tramo a su tipo) */
export function aplicarEscala(base: number, tramos: readonly Tramo[]): number {
  let cuota = 0;
  let desde = 0;
  for (const tramo of tramos) {
    const hasta = tramo.hasta ?? Infinity;
    if (base > desde) cuota += ((Math.min(base, hasta) - desde) * tramo.tipo) / 100;
    desde = hasta;
  }
  return cuota;
}

/** El IRPF de una base liquidable: las dos escalas, cada una menos lo que corresponde al mínimo personal */
function cuotaDeBase(base: number, estatal: readonly Tramo[], autonomica: readonly Tramo[]): number {
  const minimo = Math.min(base, MINIMO_PERSONAL);
  return Math.max(0, aplicarEscala(base, estatal) - aplicarEscala(minimo, estatal)) + Math.max(0, aplicarEscala(base, autonomica) - aplicarEscala(minimo, autonomica));
}

export interface EstimacionIrpf {
  bruto: number;
  cotizaciones: number;
  base: number;
  /** IRPF al año */
  cuota: number;
  /** Lo que te queda al año: bruto − cotizaciones − IRPF */
  neto: number;
  /** % de IRPF sobre el bruto */
  tipoMedio: number;
  /** % que te ahorras de IRPF por cada euro que aportas a un plan de pensiones */
  marginal: number;
}

/** El IRPF de un sueldo bruto anual (en euros). */
export function estimarIrpf(bruto: number, estatal: readonly Tramo[], autonomica: readonly Tramo[]): EstimacionIrpf {
  const cotizaciones = (bruto * COTIZACION_TRABAJADOR) / 100;
  const rendimientoNeto = Math.max(0, bruto - cotizaciones - OTROS_GASTOS);
  const base = Math.max(0, rendimientoNeto - reduccionTrabajo(rendimientoNeto));
  const cuota = cuotaDeBase(base, estatal, autonomica);
  // Una aportación a un plan de pensiones baja la base: se mira cuánto baja el impuesto con 1.000 € menos
  const marginal = (cuota - cuotaDeBase(Math.max(0, base - 1000), estatal, autonomica)) / 10;
  return { bruto, cotizaciones, base, cuota, neto: bruto - cotizaciones - cuota, tipoMedio: bruto > 0 ? (cuota / bruto) * 100 : 0, marginal };
}

/** El sueldo bruto que deja este neto al año (por tanteo: el neto crece con el bruto). */
export function brutoDeNeto(neto: number, estatal: readonly Tramo[], autonomica: readonly Tramo[]): number {
  let [bajo, alto] = [neto, neto * 2.5];
  for (let i = 0; i < 60; i++) {
    const medio = (bajo + alto) / 2;
    if (estimarIrpf(medio, estatal, autonomica).neto < neto) bajo = medio;
    else alto = medio;
  }
  return Math.round((bajo + alto) / 2);
}
