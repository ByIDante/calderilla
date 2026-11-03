import type { Centimos } from "../dominio/dinero.ts";
import { diferenciaMeses, mesDe, primerDia, sumarMeses, ultimoDia, type Fecha, type Mes } from "../dominio/fechas.ts";
import { cuadroAmortizacion, interesesTotales, pendienteEn } from "../dominio/prestamo.ts";
import { importeEn, type Frecuencia } from "../dominio/recurrencia.ts";
import type { Deuda } from "../reglas/deuda.ts";
import { evaluar } from "../reglas/escalera.ts";
import type { ClaveParametro, Parametros } from "../reglas/parametros.ts";
import type { Etapa, MetaSituacion, Resultado, Situacion } from "../reglas/tipos.ts";
import { conAmortizacion, deudas, finesProximos, presupuestoMes, provisiones, type PresupuestoMes, type RecurrenteCompleto } from "./finanzas.ts";
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
  /** Pagos anticipados de préstamos, por el id del gasto: sale de tus cuentas hoy */
  adelantos: Map<number, { importe: Centimos; modo: "cuota" | "plazo" }>;
  /** Lo que traspasas solo cada mes a tu ahorro (si apartas más de lo que pide la regla, sale del ocio) */
  ahorroAutomatico: Centimos | null;
}

export function sinCambios(): Prueba {
  return {
    importes: new Map(),
    quitados: new Set(),
    nuevos: [],
    liquidez: null,
    ocioGastado: null,
    metas: new Map(),
    metasQuitadas: new Set(),
    metaNueva: null,
    parametros: {},
    adelantos: new Map(),
    ahorroAutomatico: null,
  };
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
    Object.keys(prueba.parametros).length +
    prueba.adelantos.size +
    (prueba.ahorroAutomatico === null ? 0 : 1)
  );
}

/** Lo que supone adelantar un préstamo: lo que pagas hoy, lo que te ahorras y cómo queda */
export interface ResultadoAdelanto {
  nombre: string;
  importe: Centimos;
  comision: Centimos;
  modo: "cuota" | "plazo";
  interesesAhorrados: Centimos;
  finAntes: Fecha;
  finDespues: Fecha;
  cuotaAntes: Centimos;
  cuotaDespues: Centimos;
  vinculado: boolean;
  /** Para que la regla diga si compensa (con lo que se debe antes de adelantar) */
  deuda: Deuda | undefined;
}

export interface Simulacion {
  /** Los ingresos y gastos que cuentan, con los cambios (los de prueba tienen id negativo) */
  recurrentes: RecurrenteCompleto[];
  /** Los préstamos con lo adelantado, también los que quitas del presupuesto: lo que debes no cambia por quitarlos */
  prestamos: RecurrenteCompleto[];
  adelantos: ResultadoAdelanto[];
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
  const adelantos: ResultadoAdelanto[] = [];
  const conCambios = base.recurrentes.map((r) => {
    const importe = prueba.importes.get(r.id);
    // Un importe nuevo vale para todo: así cuenta igual este mes y en el reparto de lo anual
    const cambiado = importe === undefined ? r : { ...r, versiones: [{ validoDesde: r.inicio, importe }] };
    const adelanto = prueba.adelantos.get(r.id);
    if (!adelanto || !cambiado.prestamo) return cambiado;
    const pagado = Math.min(adelanto.importe, pendienteEn(cambiado.prestamo, base.hoy));
    const despues = conAmortizacion(cambiado, { fecha: base.hoy, importe: pagado, modo: adelanto.modo });
    const siguiente = cuadroAmortizacion(cambiado.prestamo).find((fila) => fila.fecha > base.hoy && fila.cuota > 0)?.fecha ?? base.hoy;
    adelantos.push({
      nombre: r.nombre,
      importe: pagado,
      comision: Math.round((pagado * cambiado.prestamo.comisionAmortizacion) / 100),
      modo: adelanto.modo,
      interesesAhorrados: interesesTotales(cambiado.prestamo) - interesesTotales(despues.prestamo!),
      finAntes: cambiado.fin!,
      finDespues: despues.fin!,
      cuotaAntes: importeEn(cambiado.versiones, siguiente),
      cuotaDespues: importeEn(despues.versiones, siguiente),
      vinculado: cambiado.prestamo.vinculado,
      deuda: deudas([cambiado], base.hoy)[0],
    });
    return despues;
  });
  const recurrentes = [...conCambios.filter((r) => !prueba.quitados.has(r.id)), ...prueba.nuevos.map((nuevo) => recurrenteDePrueba(nuevo, primerDia(mes)))];
  const prestamos = conCambios.filter((r) => r.prestamo);
  const fines = finesProximos(prestamos, base.hoy);
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
    // Lo adelantado (y su comisión) sale hoy de tus cuentas
    liquidez: (prueba.liquidez ?? base.situacion.liquidez) - adelantos.reduce((suma, a) => suma + a.importe + a.comision, 0),
    deudas: deudas(prestamos, base.hoy),
    prestamosTerminados: fines.terminados,
    prestamosPorTerminar: fines.porTerminar,
    ocioGastado: prueba.ocioGastado ?? base.situacion.ocioGastado,
    ahorroAutomatico: prueba.ahorroAutomatico ?? base.situacion.ahorroAutomatico,
    metas,
    apartadoMetas: metas.reduce((suma, meta) => suma + meta.ahorrado, 0),
  };
  const parametros = { ...base.parametros, ...prueba.parametros };
  return { recurrentes, prestamos, adelantos, presupuesto, situacion, parametros, resultado: evaluar(situacion, parametros) };
}

/** Si dejaras de cobrar: meses que aguantas con lo que tienes en las cuentas, pagando solo lo esencial. */
export function mesesSinIngresos(sim: Simulacion): number | null {
  return sim.situacion.esenciales > 0 ? Math.max(sim.situacion.liquidez, 0) / sim.situacion.esenciales : null;
}

/** Una meta, la misma en tus números y en la prueba (la de prueba no tiene id) */
const claveMeta = (meta: MetaSituacion) => `meta-${meta.id ?? "prueba"}`;

export interface PuntoProyeccion {
  mes: Mes;
  /** Lo que tienes ahorrado: cuentas e inversión, sin lo apartado para los gastos anuales */
  ahorrado: Centimos;
  etapa: Etapa;
}

/** Cuándo se llega a cada cosa: el mes, «ya» o null si no llega en el tiempo proyectado */
export interface Hito {
  clave: string;
  nombre: string;
  ya: boolean;
  mes: Mes | null;
}

/**
 * Los próximos `meses` meses si cada mes ahorras lo que pide la regla. Mes a mes se vuelve a evaluar la
 * escalera con los ingresos y gastos de ese mes (los préstamos que terminan, las subidas con fecha, lo anual):
 * así cambia lo que toca ahorrar al subir de etapa. Lo de las metas se reparte entre ellas según lo que pide
 * cada una; lo de la etapa va a tus cuentas o, desde «Invertir», a la inversión. Si gastas más de lo que
 * ingresas, lo que falta sale de tus cuentas (hasta dejarlas a cero). Sin intereses ni bolsa.
 */
export function proyectar(sim: Simulacion, meses = 24): { puntos: PuntoProyeccion[]; hitos: Hito[] } {
  let s = sim.situacion;
  let r = sim.resultado;
  const metas = s.metas.map((meta) => ({ ...meta }));
  const ahorrado = (x: Situacion) => x.liquidez - x.provisiones + x.largoPlazo;
  const puntos: PuntoProyeccion[] = [{ mes: mesDe(s.hoy), ahorrado: ahorrado(s), etapa: r.etapa }];
  const llegada = new Map<string, { ya: boolean; mes: Mes | null }>();
  const mirar = (clave: string, cumple: boolean, mes: Mes, primera: boolean) => {
    if (cumple && !llegada.get(clave)?.mes && !llegada.get(clave)?.ya) llegada.set(clave, { ya: primera, mes: primera ? null : mes });
  };
  const revisar = (mes: Mes, primera: boolean) => {
    mirar("colchon", r.liquidezLibre >= r.colchonObjetivo, mes, primera);
    mirar("fondo", r.liquidezLibre >= r.fondoObjetivo, mes, primera);
    mirar("invertir", r.etapa === "invertir", mes, primera);
    mirar("sin-dinero", s.liquidez <= 0 && r.presupuesto.sobrante < 0, mes, primera);
    metas.forEach((meta) => mirar(claveMeta(meta), meta.ahorrado >= meta.objetivo, mes, primera));
  };
  revisar(mesDe(s.hoy), true);

  for (let t = 1; t <= meses; t++) {
    const p = r.presupuesto;
    // Lo de las metas, repartido según lo que pide cada una (sin pasarse de lo que le falta)
    const piden = metas.map((meta) => Math.max(0, Math.ceil((meta.objetivo - meta.ahorrado) / Math.max(1, diferenciaMeses(s.hoy, meta.fecha)))));
    const totalPiden = piden.reduce((suma, x) => suma + x, 0);
    metas.forEach((meta, i) => {
      meta.ahorrado = Math.min(meta.objetivo, meta.ahorrado + (totalPiden ? Math.round((p.paraMetas * piden[i]!) / totalPiden) : 0));
    });
    const hoy = sumarMeses(sim.situacion.hoy, t);
    const presupuesto = presupuestoMes(sim.recurrentes, mesDe(hoy));
    const nuevasProvisiones = provisiones(sim.recurrentes, hoy);
    const fines = finesProximos(sim.prestamos, hoy);
    const aEtapa = p.objetivoAhorro - p.paraMetas;
    s = {
      ...s,
      hoy,
      ingresos: presupuesto.ingresos,
      esenciales: presupuesto.esenciales,
      noEsenciales: presupuesto.noEsenciales,
      // Lo apartado para los gastos anuales entra y sale de las cuentas; lo que crece es lo ahorrado
      liquidez: Math.max(0, s.liquidez + p.paraMetas + (r.etapa === "invertir" ? 0 : aEtapa) + Math.min(p.sobrante, 0) + nuevasProvisiones - s.provisiones),
      largoPlazo: s.largoPlazo + (r.etapa === "invertir" ? aEtapa : 0),
      provisiones: nuevasProvisiones,
      deudas: deudas(sim.prestamos, hoy),
      prestamosTerminados: fines.terminados,
      prestamosPorTerminar: fines.porTerminar,
      metas: metas.map((meta) => ({ ...meta })),
      apartadoMetas: metas.reduce((suma, meta) => suma + meta.ahorrado, 0),
      etapaAnterior: r.etapa,
      ocioGastado: 0,
      ocioRemanente: 0,
    };
    r = evaluar(s, sim.parametros);
    puntos.push({ mes: mesDe(hoy), ahorrado: ahorrado(s), etapa: r.etapa });
    revisar(mesDe(hoy), false);
  }

  const hitos: Hito[] = [
    { clave: "colchon", nombre: "Tener el colchón" },
    { clave: "fondo", nombre: "Completar el fondo de emergencia" },
    { clave: "invertir", nombre: "Empezar a invertir" },
    ...metas.map((meta) => ({ clave: claveMeta(meta), nombre: `Meta «${meta.nombre}»` })),
    // Solo si pasa: gastas más de lo que ingresas y se acaba lo de las cuentas
    ...(llegada.has("sin-dinero") ? [{ clave: "sin-dinero", nombre: "Te quedarías sin dinero en las cuentas" }] : []),
  ].map((h) => ({ ...h, ya: llegada.get(h.clave)?.ya ?? false, mes: llegada.get(h.clave)?.mes ?? null }));
  return { puntos, hitos };
}

/** El importe de cada cobro o cargo que se enseña en la Calculadora: el que cuenta este mes. */
export function importeDelMes(r: RecurrenteCompleto, hoy: Fecha): Centimos {
  return importeEn(r.versiones, ultimoDia(mesDe(hoy)));
}
