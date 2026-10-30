import { euros, porcentaje, type Centimos } from "../dominio/dinero.ts";
import type { Parametros } from "./parametros.ts";

export interface Deuda {
  nombre: string;
  pendiente: Centimos;
  /** TAE en %. */
  tae: number;
  cuota: Centimos;
  mesesRestantes: number;
  /** Comisión por amortizar antes de tiempo, en %. */
  comision: number;
  vinculado: boolean;
}

export interface Rentabilidades {
  /** Lo que da, ya sin impuestos, la mejor opción sin riesgo (cuenta remunerada o Letras). En %. */
  sinRiesgoNeta: number;
  /** Lo que se espera de una cartera 100 % en bolsa, ya sin impuestos. En %. */
  bolsaNeta: number;
}

export type Veredicto = "prioridad" | "opcional" | "no";

export interface ResultadoDeuda {
  veredicto: Veredicto;
  /** TAE descontando la comisión de amortización, repartida entre los años que quedan. */
  taeEfectiva: number;
  /** A partir de esta TAE la deuda se paga antes que nada más. */
  linea: number;
  porque: string;
}

/**
 * La única regla para decidir si conviene pagar una deuda antes de tiempo, se use en la etapa que se use.
 * Pagar deuda es una rentabilidad segura y sin impuestos igual a su TAE; se compara con lo que darían las
 * alternativas ya descontados los impuestos.
 */
export function veredictoDeuda(deuda: Deuda, r: Rentabilidades, p: Parametros): ResultadoDeuda {
  const anos = Math.max(deuda.mesesRestantes / 12, 1);
  const taeEfectiva = deuda.tae - deuda.comision / anos;
  const linea = Math.max(p.deudaCaraMinTae, r.bolsaNeta + p.margenDeuda);
  const datos = `«${deuda.nombre}»: TAE ${porcentaje(deuda.tae)}${deuda.comision ? ` (${porcentaje(taeEfectiva)} contando la comisión)` : ""}, quedan ${euros(deuda.pendiente)}`;

  if (taeEfectiva >= linea) {
    return {
      veredicto: "prioridad",
      taeEfectiva,
      linea,
      porque: `${datos}. Pagarla es como ganar un ${porcentaje(taeEfectiva)} seguro y sin impuestos; ninguna inversión razonable lo garantiza (la bolsa, de media, ~${porcentaje(r.bolsaNeta)} neto y con riesgo).`,
    };
  }
  if (taeEfectiva > r.sinRiesgoNeta) {
    return {
      veredicto: "opcional",
      taeEfectiva,
      linea,
      porque: `${datos}. Amortizar te ahorra un ${porcentaje(taeEfectiva)} seguro; una cuenta remunerada da ~${porcentaje(r.sinRiesgoNeta)} neto e invertir podría dar más, pero con riesgo. Es una opción, no una prioridad.`,
    };
  }
  return {
    veredicto: "no",
    taeEfectiva,
    linea,
    porque: `${datos}. Es más barata que lo que te da el dinero sin riesgo (~${porcentaje(r.sinRiesgoNeta)} neto): no compensa adelantar pagos.`,
  };
}
