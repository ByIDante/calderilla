// Umbrales de las reglas. Todos se pueden cambiar en Ajustes → Parámetros; aquí están los valores por defecto
// que salieron del diseño (gestor de inversiones + abogado del diablo, octubre de 2026).

export interface DefinicionParametro {
  etiqueta: string;
  unidad: "meses" | "€" | "%" | "puntos" | "cierres" | "días";
  defecto: number;
  grupo: string;
  ayuda?: string;
}

export const PARAMETROS = {
  colchonMeses: { grupo: "Colchón y fondo de emergencia", etiqueta: "Colchón: meses de gastos esenciales", unidad: "meses", defecto: 1 },
  colchonMinimo: { grupo: "Colchón y fondo de emergencia", etiqueta: "Colchón mínimo", unidad: "€", defecto: 1000 },
  fondoMesesEstable: { grupo: "Colchón y fondo de emergencia", etiqueta: "Fondo de emergencia con trabajo estable", unidad: "meses", defecto: 3 },
  fondoMesesNormal: { grupo: "Colchón y fondo de emergencia", etiqueta: "Fondo de emergencia con estabilidad normal", unidad: "meses", defecto: 6 },
  fondoMesesInestable: { grupo: "Colchón y fondo de emergencia", etiqueta: "Fondo de emergencia con ingresos inestables", unidad: "meses", defecto: 9 },
  reentrada: {
    grupo: "Colchón y fondo de emergencia",
    etiqueta: "Volver a una etapa superada al bajar del",
    unidad: "%",
    defecto: 80,
    ayuda: "Evita que un mes flojo te devuelva a la etapa anterior: solo vuelves si bajas de este porcentaje del objetivo.",
  },

  deudaCaraMinTae: { grupo: "Deudas", etiqueta: "Una deuda es cara como mínimo desde una TAE de", unidad: "%", defecto: 7 },
  margenDeuda: { grupo: "Deudas", etiqueta: "Margen sobre la rentabilidad esperada de la bolsa", unidad: "puntos", defecto: 1 },

  rentaVariableEsperada: { grupo: "Rentabilidades supuestas", etiqueta: "Rentabilidad anual esperada de la renta variable", unidad: "%", defecto: 6 },
  rentaFijaEsperada: { grupo: "Rentabilidades supuestas", etiqueta: "Rentabilidad anual esperada de la renta fija", unidad: "%", defecto: 3 },
  lastreFiscal: { grupo: "Rentabilidades supuestas", etiqueta: "Parte de la rentabilidad que se lleva Hacienda", unidad: "%", defecto: 20 },
  tipoAhorro: { grupo: "Rentabilidades supuestas", etiqueta: "IRPF de los intereses de una cuenta", unidad: "%", defecto: 19 },

  metasCortoMeses: { grupo: "Metas", etiqueta: "Una meta es a corto plazo si falta menos de", unidad: "meses", defecto: 36 },

  excesoLiquidez: { grupo: "Opciones que se desbloquean", etiqueta: "Liquidez sobrante para proponer Letras o depósitos", unidad: "€", defecto: 3000 },
  cierresExceso: { grupo: "Opciones que se desbloquean", etiqueta: "…durante cierres de mes seguidos", unidad: "cierres", defecto: 3 },
  pensionDiferenciaMin: {
    grupo: "Opciones que se desbloquean",
    etiqueta: "Plan de pensiones: diferencia mínima entre tu tipo marginal y el tipo al rescatar",
    unidad: "puntos",
    defecto: 5,
  },
  pensionTope: { grupo: "Opciones que se desbloquean", etiqueta: "Aportación máxima a un plan individual", unidad: "€", defecto: 1500 },
  especulativoMesesGasto: {
    grupo: "Opciones que se desbloquean",
    etiqueta: "Parte especulativa (cripto, divisas) a partir de una inversión de",
    unidad: "meses",
    defecto: 12,
    ayuda: "Meses de gastos esenciales invertidos a largo plazo.",
  },

  topeEspeculativoConservador: { grupo: "Topes por perfil", etiqueta: "Tope especulativo, perfil conservador", unidad: "%", defecto: 0 },
  topeEspeculativoModerado: { grupo: "Topes por perfil", etiqueta: "Tope especulativo, perfil moderado", unidad: "%", defecto: 2 },
  topeEspeculativoDinamico: { grupo: "Topes por perfil", etiqueta: "Tope especulativo, perfil dinámico", unidad: "%", defecto: 5 },
  topeEspeculativoAgresivo: { grupo: "Topes por perfil", etiqueta: "Tope especulativo, perfil agresivo", unidad: "%", defecto: 5 },
  topeAccion: { grupo: "Topes por perfil", etiqueta: "Tope de una sola acción en la cartera", unidad: "%", defecto: 10 },
  rvConservador: { grupo: "Topes por perfil", etiqueta: "Renta variable, perfil conservador", unidad: "%", defecto: 25 },
  rvModerado: { grupo: "Topes por perfil", etiqueta: "Renta variable, perfil moderado", unidad: "%", defecto: 50 },
  rvDinamico: { grupo: "Topes por perfil", etiqueta: "Renta variable, perfil dinámico", unidad: "%", defecto: 70 },
  rvAgresivo: { grupo: "Topes por perfil", etiqueta: "Renta variable, perfil agresivo", unidad: "%", defecto: 90 },
  desvio: { grupo: "Topes por perfil", etiqueta: "Reequilibrar si el reparto se desvía más de", unidad: "puntos", defecto: 5 },

  ocioMinimoPct: { grupo: "Ocio", etiqueta: "Ocio mínimo: porcentaje de los ingresos", unidad: "%", defecto: 5 },
  ocioMinimoEur: { grupo: "Ocio", etiqueta: "Ocio mínimo en euros", unidad: "€", defecto: 50 },
  proporcionColchon: { grupo: "Ocio", etiqueta: "Parte del sobrante que se ahorra en Colchón", unidad: "%", defecto: 80 },
  proporcionDeuda: { grupo: "Ocio", etiqueta: "Parte del sobrante que se ahorra en Deuda cara", unidad: "%", defecto: 80 },
  proporcionFondo: { grupo: "Ocio", etiqueta: "Parte del sobrante que se ahorra en Fondo de emergencia", unidad: "%", defecto: 60 },
  proporcionMetas: { grupo: "Ocio", etiqueta: "Parte del sobrante que se ahorra en Metas", unidad: "%", defecto: 60 },
  proporcionInvertir: { grupo: "Ocio", etiqueta: "Parte del sobrante que se ahorra en Invertir", unidad: "%", defecto: 50 },
  remanente: { grupo: "Ocio", etiqueta: "Ocio no gastado que pasa al mes siguiente", unidad: "%", defecto: 50 },
  cuotaLiberadaMeses: { grupo: "Ocio", etiqueta: "Meses que una cuota de préstamo terminado va entera a ahorro", unidad: "meses", defecto: 3 },

  datoViejoDias: { grupo: "Avisos", etiqueta: "Pedir que verifiques un dato de mercado tras", unidad: "días", defecto: 90 },
  avisoPrestamoMeses: { grupo: "Avisos", etiqueta: "Avisar del fin de un préstamo con antelación de", unidad: "meses", defecto: 3 },
} satisfies Record<string, DefinicionParametro>;

export type ClaveParametro = keyof typeof PARAMETROS;
export type Parametros = Record<ClaveParametro, number>;

export function parametrosPorDefecto(): Parametros {
  return Object.fromEntries(Object.entries(PARAMETROS).map(([clave, definicion]) => [clave, definicion.defecto])) as Parametros;
}

export function esClaveParametro(clave: string): clave is ClaveParametro {
  return clave in PARAMETROS;
}
