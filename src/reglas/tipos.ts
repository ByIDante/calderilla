import type { Centimos } from "../dominio/dinero.ts";
import type { Fecha, Mes } from "../dominio/fechas.ts";
import type { Deuda } from "./deuda.ts";

export type Etapa = "deficit" | "colchon" | "deuda_cara" | "fondo_emergencia" | "metas_corto" | "invertir";

export const ETAPAS: readonly Etapa[] = ["deficit", "colchon", "deuda_cara", "fondo_emergencia", "metas_corto", "invertir"];

export const NOMBRE_ETAPA: Record<Etapa, string> = {
  deficit: "Gastas más de lo que ingresas",
  colchon: "Colchón mínimo",
  deuda_cara: "Elimina la deuda cara",
  fondo_emergencia: "Fondo de emergencia",
  metas_corto: "Metas a corto plazo",
  invertir: "Invertir",
};

export type Estabilidad = "estable" | "normal" | "inestable";
export type PerfilRiesgo = "conservador" | "moderado" | "dinamico" | "agresivo";

export const NOMBRE_ESTABILIDAD: Record<Estabilidad, string> = {
  estable: "Estable (funcionario, contrato fijo con antigüedad)",
  normal: "Normal",
  inestable: "Inestable (autónomo, temporal, ingresos variables)",
};

export const NOMBRE_RIESGO: Record<PerfilRiesgo, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  dinamico: "Dinámico",
  agresivo: "Agresivo",
};

export interface Perfil {
  estabilidad: Estabilidad;
  riesgo: PerfilRiesgo;
  /** Tipo marginal del IRPF en % (el de tu último tramo), si lo sabes. */
  tipoMarginal: number | null;
  /** Tipo que calculas pagar al rescatar un plan de pensiones, en %. */
  tipoRescate: number | null;
  /** Lo que aporta tu empresa a tu plan de pensiones al año. */
  aportacionEmpresa: Centimos;
}

export interface MetaSituacion {
  nombre: string;
  objetivo: Centimos;
  ahorrado: Centimos;
  fecha: Fecha;
}

export interface CierreSituacion {
  mes: Mes;
  ahorroPlan: Centimos;
  ahorroReal: Centimos | null;
  liquidezLibre: Centimos;
  fondoObjetivo: Centimos;
}

export interface PrestamoFin {
  nombre: string;
  cuota: Centimos;
  fin: Fecha;
}

export interface ProductoMercado {
  nombre: string;
  /** TAE en %. */
  tae: number;
  comprobado: Fecha;
  finPromocion: Fecha | null;
  nota: string | null;
}

/** Todo lo que las reglas necesitan saber, ya calculado. Importes en céntimos y al mes salvo que se diga otra cosa. */
export interface Situacion {
  hoy: Fecha;
  /** I: ingresos netos (los no mensuales, repartidos). */
  ingresos: Centimos;
  /** E: gastos esenciales, incluidas las cuotas de préstamos y la parte mensual de los gastos anuales. */
  esenciales: Centimos;
  /** NE: gastos fijos no esenciales. */
  noEsenciales: Centimos;
  /** Saldo de cuentas corriente, remunerada, monetario, efectivo, bróker y depósitos o Letras que vencen pronto. */
  liquidez: Centimos;
  /** Lo que ya deberías tener apartado para los gastos anuales. */
  provisiones: Centimos;
  /** Lo apartado para metas. */
  apartadoMetas: Centimos;
  /** LT: fondos, ETFs y acciones no especulativos, a precio de mercado. */
  largoPlazo: Centimos;
  /** Parte de LT en renta variable. */
  rentaVariable: Centimos;
  /** Número de fondos o ETFs distintos. */
  fondos: number;
  especulativo: Centimos;
  mayorAccion: Centimos;
  pensiones: Centimos;
  deudas: Deuda[];
  metas: MetaSituacion[];
  /** Del más reciente al más antiguo. */
  cierres: CierreSituacion[];
  /** Préstamos terminados en los últimos 12 meses. */
  prestamosTerminados: PrestamoFin[];
  /** Préstamos que terminan en los próximos 12 meses. */
  prestamosPorTerminar: PrestamoFin[];
  perfil: Perfil;
  cuentasMercado: ProductoMercado[];
  letras: ProductoMercado | null;
  etapaAnterior: Etapa | null;
  ocioGastado: Centimos;
  ocioRemanente: Centimos;
  saldosPorEntidad: { entidad: string; saldo: Centimos }[];
  limiteFgd: Centimos;
}

export interface Explicado {
  texto: string;
  porque: string;
}

export interface Desbloqueo extends Explicado {
  id: "plan_empresa" | "letras" | "plan_pensiones" | "amortizar" | "especulativo" | "reequilibrar";
  titulo: string;
  disponible: boolean;
  /** Qué falta para desbloquearlo. */
  requisito: string | null;
}

export interface Aviso {
  nivel: "logro" | "info" | "atencion";
  texto: string;
}

export interface Presupuesto {
  ingresos: Centimos;
  esenciales: Centimos;
  noEsenciales: Centimos;
  /** S = I − E − NE */
  sobrante: Centimos;
  ocioMinimo: Centimos;
  objetivoAhorro: Centimos;
  /** Parte del ahorro que va a metas. */
  paraMetas: Centimos;
  /** Parte del ahorro que va a la etapa (colchón, deuda, fondo o inversión). */
  paraEtapa: Centimos;
  cuotaLiberada: Centimos;
  ocioPlan: Centimos;
  /** Lo que se quita al ocio porque en los cierres ahorraste menos de lo previsto. */
  correccion: Centimos;
  ocio: Centimos;
  ocioRemanente: Centimos;
  ocioGastado: Centimos;
  /** Lo que te queda este mes para ocio. */
  ocioQueda: Centimos;
}

export interface Progreso {
  actual: Centimos;
  objetivo: Centimos;
  falta: Centimos;
  /** Meses al ritmo actual; null si no se puede estimar. */
  meses: number | null;
}

export interface Resultado {
  etapa: Etapa;
  numero: number;
  nombre: string;
  acciones: Explicado[];
  progreso: Progreso | null;
  siguiente: string;
  desbloqueos: Desbloqueo[];
  avisos: Aviso[];
  presupuesto: Presupuesto;
  liquidezLibre: Centimos;
  colchonObjetivo: Centimos;
  fondoObjetivo: Centimos;
  fondoMeses: number;
  /** Lo que da el dinero sin riesgo y lo que se espera de la bolsa, netos, en %. */
  rentabilidades: { sinRiesgoNeta: number; bolsaNeta: number };
  rentaVariableObjetivo: number;
}
