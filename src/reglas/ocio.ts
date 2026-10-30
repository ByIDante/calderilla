import { diasEntre } from "../dominio/fechas.ts";
import type { Parametros } from "./parametros.ts";
import type { Etapa, Presupuesto, Situacion } from "./tipos.ts";

const PROPORCION: Record<Etapa, (p: Parametros) => number> = {
  deficit: () => 0,
  colchon: (p) => p.proporcionColchon,
  deuda_cara: (p) => p.proporcionDeuda,
  fondo_emergencia: (p) => p.proporcionFondo,
  metas_corto: (p) => p.proporcionMetas,
  invertir: (p) => p.proporcionInvertir,
};

/** Cuotas de préstamos terminados hace poco: durante unos meses van enteras a ahorro, para no gastarlas sin darse cuenta. */
export function cuotaLiberada(s: Situacion, p: Parametros): number {
  return s.prestamosTerminados.filter((prestamo) => diasEntre(prestamo.fin, s.hoy) <= p.cuotaLiberadaMeses * 30.5).reduce((suma, prestamo) => suma + prestamo.cuota, 0);
}

/**
 * ¿Cuánto puedo gastar en ocio? Lo que sobra tras los gastos, menos el ahorro que pide la etapa y las metas,
 * corregido con lo que de verdad ahorraste en los últimos cierres de mes.
 */
export function calcularPresupuesto(s: Situacion, etapa: Etapa, p: Parametros, requeridoMetas: number): Presupuesto {
  const sobrante = s.ingresos - s.esenciales - s.noEsenciales;
  const ocioMinimo = Math.max(Math.round((s.ingresos * p.ocioMinimoPct) / 100), p.ocioMinimoEur * 100);
  const maximoAhorro = Math.max(sobrante - ocioMinimo, 0);
  const liberada = Math.min(cuotaLiberada(s, p), Math.max(sobrante, 0));
  const proporcion = PROPORCION[etapa](p) / 100;

  const objetivoAhorro =
    etapa === "deficit"
      ? 0
      : Math.min(Math.max(Math.round(proporcion * (sobrante - liberada)) + liberada, requeridoMetas, 0), maximoAhorro);
  const paraMetas = Math.min(requeridoMetas, objetivoAhorro);
  const ocioPlan = Math.max(sobrante - objetivoAhorro, 0);

  // Si en 2 de los 3 últimos cierres ahorraste menos de lo previsto, hay gastos que no estás apuntando: se descuentan del ocio
  const recientes = s.cierres.slice(0, 3).filter((cierre) => cierre.ahorroReal !== null);
  const pordebajo = recientes.filter((cierre) => (cierre.ahorroReal ?? 0) < cierre.ahorroPlan);
  const correccion =
    pordebajo.length >= 2 ? Math.round(pordebajo.reduce((suma, cierre) => suma + cierre.ahorroPlan - (cierre.ahorroReal ?? 0), 0) / pordebajo.length) : 0;
  const ocio = Math.max(ocioPlan - correccion, 0);

  return {
    ingresos: s.ingresos,
    esenciales: s.esenciales,
    noEsenciales: s.noEsenciales,
    sobrante,
    ocioMinimo,
    objetivoAhorro,
    paraMetas,
    paraEtapa: objetivoAhorro - paraMetas,
    cuotaLiberada: liberada,
    ocioPlan,
    correccion: Math.min(correccion, ocioPlan),
    ocio,
    ocioRemanente: s.ocioRemanente,
    ocioGastado: s.ocioGastado,
    ocioQueda: ocio + s.ocioRemanente - s.ocioGastado,
  };
}

/** Al cerrar el mes: la parte del ocio no gastado que pasa al siguiente (con tope de un mes de ocio). */
export function ocioSobrante(ocio: number, gastado: number, p: Parametros): number {
  return Math.min(ocio, Math.round((Math.max(ocio - gastado, 0) * p.remanente) / 100));
}
