import type { Centimos } from "../dominio/dinero.ts";
import { mesDe, primerDia, ultimoDia, type Fecha } from "../dominio/fechas.ts";
import { importeEn, type Frecuencia } from "../dominio/recurrencia.ts";
import { evaluar } from "../reglas/escalera.ts";
import type { ClaveParametro, Parametros } from "../reglas/parametros.ts";
import type { MetaSituacion, Resultado, Situacion } from "../reglas/tipos.ts";
import { presupuestoMes, provisiones, type PresupuestoMes, type RecurrenteCompleto } from "./finanzas.ts";
import type { Contexto } from "./situacion.ts";

/*
 * La Calculadora: tus números de verdad con los cambios que quieras probar, sin guardar nada. Usa las mismas
 * cuentas que el resto de la app (`presupuestoMes`, `provisiones` y `evaluar`), así que lo que sale aquí es lo
 * que saldría en cada pantalla si esos fueran tus datos. No toca la base de datos: parte de lo que lee
 * `construir()`.
 */

export type Base = Omit<Contexto, "resultado">;

/** Las reglas que se pueden tocar en la Calculadora (el resto se queda como en Ajustes → Parámetros) */
export const PARAMETROS_PRUEBA = [
  "proporcionColchon",
  "proporcionDeuda",
  "proporcionFondo",
  "proporcionMetas",
  "proporcionInvertir",
  "ocioMinimoPct",
  "ocioMinimoEur",
  "fondoMesesEstable",
  "fondoMesesNormal",
  "fondoMesesInestable",
  "colchonMinimo",
] as const satisfies readonly ClaveParametro[];

export type ParametroPrueba = (typeof PARAMETROS_PRUEBA)[number];

export interface NuevoPrueba {
  /** Fila del formulario (1, 2, 3): su id en la simulación es el mismo en negativo */
  fila: number;
  tipo: "ingreso" | "gasto";
  esencial: boolean;
  nombre: string;
  importe: Centimos;
  frecuencia: Frecuencia;
}

export interface CambioMeta {
  objetivo?: Centimos;
  ahorrado?: Centimos;
  fecha?: Fecha;
}

export interface Prueba {
  /** Importe de cada cobro o cargo, por el id del ingreso o gasto */
  importes: Map<number, Centimos>;
  quitados: Set<number>;
  nuevos: NuevoPrueba[];
  /** Dinero en tus cuentas (la liquidez que mira la escalera) */
  liquidez: Centimos | null;
  ocioGastado: Centimos | null;
  metas: Map<number, CambioMeta>;
  metasQuitadas: Set<number>;
  metaNueva: MetaSituacion | null;
  parametros: Partial<Record<ParametroPrueba, number>>;
}

export function sinCambios(): Prueba {
  return { importes: new Map(), quitados: new Set(), nuevos: [], liquidez: null, ocioGastado: null, metas: new Map(), metasQuitadas: new Set(), metaNueva: null, parametros: {} };
}

/** ¿Cuántas cosas has cambiado? (para decir «son tus números de verdad» si ninguna) */
export function cambios(prueba: Prueba): number {
  return (
    prueba.importes.size +
    prueba.quitados.size +
    prueba.nuevos.length +
    (prueba.liquidez === null ? 0 : 1) +
    (prueba.ocioGastado === null ? 0 : 1) +
    prueba.metas.size +
    prueba.metasQuitadas.size +
    (prueba.metaNueva ? 1 : 0) +
    Object.keys(prueba.parametros).length
  );
}

export interface Simulacion {
  /** Los ingresos y gastos que cuentan, con los cambios (los de prueba tienen id negativo) */
  recurrentes: RecurrenteCompleto[];
  presupuesto: PresupuestoMes;
  situacion: Situacion;
  parametros: Parametros;
  resultado: Resultado;
}

/** Un ingreso o gasto de prueba, como si lo hubieras apuntado este mes */
function recurrenteDePrueba(nuevo: NuevoPrueba, desde: Fecha): RecurrenteCompleto {
  return {
    id: -nuevo.fila,
    tipo: nuevo.tipo,
    nombre: nuevo.nombre,
    frecuencia: nuevo.frecuencia,
    inicio: desde,
    fin: null,
    esencial: nuevo.tipo === "gasto" && nuevo.esencial,
    categoriaId: null,
    categoria: null,
    clase: "fijo",
    nota: null,
    patron: null,
    versiones: [{ validoDesde: desde, importe: nuevo.importe }],
    prestamo: null,
    pagasExtra: [],
  };
}

/** Lo que saldría con estos cambios. Sin cambios, exactamente lo mismo que las pantallas de verdad. */
export function simular(base: Base, prueba: Prueba): Simulacion {
  const mes = mesDe(base.hoy);
  const recurrentes = [
    ...base.recurrentes
      .filter((r) => !prueba.quitados.has(r.id))
      .map((r) => {
        const importe = prueba.importes.get(r.id);
        // Un importe nuevo vale para todo: así cuenta igual este mes y en el reparto de lo anual
        return importe === undefined ? r : { ...r, versiones: [{ validoDesde: r.inicio, importe }] };
      }),
    ...prueba.nuevos.map((nuevo) => recurrenteDePrueba(nuevo, primerDia(mes))),
  ];
  const presupuesto = presupuestoMes(recurrentes, mes);

  const metas = base.situacion.metas
    .filter((meta) => meta.id === undefined || !prueba.metasQuitadas.has(meta.id))
    .map((meta) => ({ ...meta, ...(meta.id === undefined ? {} : prueba.metas.get(meta.id)) }));
  if (prueba.metaNueva) metas.push(prueba.metaNueva);

  const situacion: Situacion = {
    ...base.situacion,
    ingresos: presupuesto.ingresos,
    esenciales: presupuesto.esenciales,
    noEsenciales: presupuesto.noEsenciales,
    provisiones: provisiones(recurrentes, base.hoy),
    liquidez: prueba.liquidez ?? base.situacion.liquidez,
    ocioGastado: prueba.ocioGastado ?? base.situacion.ocioGastado,
    metas,
    apartadoMetas: metas.reduce((suma, meta) => suma + meta.ahorrado, 0),
  };
  const parametros = { ...base.parametros, ...prueba.parametros };
  return { recurrentes, presupuesto, situacion, parametros, resultado: evaluar(situacion, parametros) };
}

/** El importe de cada cobro o cargo que se enseña en la Calculadora: el que cuenta este mes. */
export function importeDelMes(r: RecurrenteCompleto, hoy: Fecha): Centimos {
  return importeEn(r.versiones, ultimoDia(mesDe(hoy)));
}
