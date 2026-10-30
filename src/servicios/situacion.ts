import type { BaseDatos } from "../datos/db.ts";
import { diasEntre, mesDe, primerDia, sumarMesesAMes, ultimoDia, type Fecha } from "../dominio/fechas.ts";
import { evaluar } from "../reglas/escalera.ts";
import type { Parametros } from "../reglas/parametros.ts";
import { ETAPAS, NOMBRE_ETAPA, type Aviso, type Etapa, type Resultado, type Situacion } from "../reglas/tipos.ts";
import { esEspeculativo, leerCartera, type Posicion } from "./cartera.ts";
import { leerMercado, leerParametros, leerPerfil, limiteFgd, productoDe, type PerfilCompleto } from "./configuracion.ts";
import { esAhorro, esLiquida, leerCuentas, type Cuenta } from "./cuentas.ts";
import { deudas, finesProximos, leerRecurrentes, presupuestoMes, provisiones, type PresupuestoMes, type RecurrenteCompleto } from "./finanzas.ts";

export interface Contexto {
  hoy: Fecha;
  situacion: Situacion;
  resultado: Resultado;
  parametros: Parametros;
  perfil: PerfilCompleto;
  recurrentes: RecurrenteCompleto[];
  presupuesto: PresupuestoMes;
  cuentas: Cuenta[];
  cartera: Posicion[];
  /** Lo que queda por devolver de tus préstamos. */
  deuda: number;
  /** Lo que tienes: liquidez + inversión a precio de mercado + planes de pensiones − deudas. */
  patrimonio: number;
  /** Lo mismo, con la inversión a precio de compra: se usa para medir el ahorro real de cada mes. */
  patrimonioACoste: number;
}

/** Gasto en ocio de un mes: apuntes con categoría de ocio (los gastos son importes negativos). Los que son el
 * cargo de un gasto fijo no cuentan: ese gasto ya está en el presupuesto. */
export function ocioGastadoEn(bd: BaseDatos, mes: string): number {
  return -(
    bd.uno<{ total: number | null }>(
      "SELECT sum(a.importe) AS total FROM apuntes a JOIN categorias c ON c.id = a.categoria_id WHERE c.tipo = 'ocio' AND a.recurrente_id IS NULL AND a.fecha BETWEEN ? AND ?",
      primerDia(mesDe(mes)),
      ultimoDia(mesDe(mes)),
    )?.total ?? 0
  );
}

/** Reúne todo lo que necesitan las reglas a fecha `hoy`. */
export function construir(bd: BaseDatos, hoy: Fecha): Omit<Contexto, "resultado"> {
  const mes = mesDe(hoy);
  const parametros = leerParametros(bd);
  const perfil = leerPerfil(bd);
  const recurrentes = leerRecurrentes(bd);
  const presupuesto = presupuestoMes(recurrentes, mes);
  const cuentas = leerCuentas(bd, hoy);
  const cartera = leerCartera(bd, hoy);
  const mercado = leerMercado(bd);

  const liquidas = cuentas.filter((c) => esLiquida(c, hoy));
  const liquidezCartera = cartera.filter((p) => p.activo.renta === "monetario" && !esEspeculativo(p.activo)).reduce((s, p) => s + p.valor, 0);
  const largoPlazo = cartera.filter((p) => !esEspeculativo(p.activo) && p.activo.renta !== "monetario" && ["fondo", "etf", "accion", "otro"].includes(p.activo.tipo));
  const especulativo = cartera.filter((p) => esEspeculativo(p.activo));
  const pensiones = cuentas.filter((c) => c.tipo === "plan_pensiones").reduce((s, c) => s + c.saldo, 0);

  // Una meta unida a una cuenta lleva ahorrado lo que tenga esa cuenta (como mucho, el objetivo)
  const saldoDe = new Map(cuentas.map((c) => [c.id, c.saldo]));
  const metas = bd
    .todos<{ nombre: string; objetivo: number; ahorrado: number; fecha: string; cuenta_id: number | null }>("SELECT nombre, objetivo, ahorrado, fecha, cuenta_id FROM metas WHERE cumplida = 0")
    .map((m) => ({ nombre: m.nombre, objetivo: m.objetivo, fecha: m.fecha, ahorrado: m.cuenta_id ? Math.min(Math.max(saldoDe.get(m.cuenta_id) ?? 0, 0), m.objetivo) : m.ahorrado }));
  const cierres = bd.todos<{ mes: string; ahorro_plan: number; ahorro_real: number | null; liquidez_libre: number; fondo_objetivo: number; ocio_sobrante: number }>(
    "SELECT mes, ahorro_plan, ahorro_real, liquidez_libre, fondo_objetivo, ocio_sobrante FROM cierres_mes WHERE mes < ? ORDER BY mes DESC LIMIT 6",
    mes,
  );
  const cierreAnterior = cierres[0]?.mes === sumarMesesAMes(mes, -1) ? cierres[0] : undefined;
  const etapaAnterior = (bd.uno<{ etapa: Etapa }>("SELECT etapa FROM historial_etapas ORDER BY id DESC LIMIT 1")?.etapa ?? null) as Etapa | null;
  const fines = finesProximos(recurrentes, hoy);

  const porEntidad = new Map<string, number>();
  for (const cuenta of cuentas.filter((c) => esAhorro(c) && c.entidad && c.moneda === "EUR")) {
    porEntidad.set(cuenta.entidad!, (porEntidad.get(cuenta.entidad!) ?? 0) + cuenta.saldo);
  }

  const liquidez = liquidas.reduce((s, c) => s + c.saldo, 0) + liquidezCartera;
  const situacion: Situacion = {
    hoy,
    ingresos: presupuesto.ingresos,
    esenciales: presupuesto.esenciales,
    noEsenciales: presupuesto.noEsenciales,
    liquidez,
    provisiones: provisiones(recurrentes, hoy),
    apartadoMetas: metas.reduce((s, m) => s + m.ahorrado, 0),
    largoPlazo: largoPlazo.reduce((s, p) => s + p.valor, 0),
    rentaVariable: largoPlazo.filter((p) => p.activo.renta === "variable").reduce((s, p) => s + p.valor, 0),
    fondos: largoPlazo.filter((p) => p.cantidad > 0 && (p.activo.tipo === "fondo" || p.activo.tipo === "etf")).length,
    especulativo: especulativo.reduce((s, p) => s + p.valor, 0),
    mayorAccion: Math.max(0, ...largoPlazo.filter((p) => p.activo.tipo === "accion").map((p) => p.valor)),
    pensiones,
    deudas: deudas(recurrentes, hoy),
    metas,
    cierres: cierres.map((c) => ({ mes: c.mes, ahorroPlan: c.ahorro_plan, ahorroReal: c.ahorro_real, liquidezLibre: c.liquidez_libre, fondoObjetivo: c.fondo_objetivo })),
    prestamosTerminados: fines.terminados,
    prestamosPorTerminar: fines.porTerminar,
    perfil,
    cuentasMercado: mercado.filter((d) => d.tipo === "cuenta").map(productoDe),
    letras: mercado.filter((d) => d.tipo === "letras").map(productoDe)[0] ?? null,
    etapaAnterior,
    ocioGastado: ocioGastadoEn(bd, hoy),
    ocioRemanente: cierreAnterior?.ocio_sobrante ?? 0,
    saldosPorEntidad: [...porEntidad].map(([entidad, saldo]) => ({ entidad, saldo })),
    limiteFgd: limiteFgd(mercado),
  };

  // Devolver capital de un préstamo también es ahorrar: la deuda resta del patrimonio
  const deuda = situacion.deudas.reduce((s, d) => s + d.pendiente, 0);
  const invertidoMercado = cartera.reduce((s, p) => s + p.valor, 0) - liquidezCartera;
  const invertidoCoste = cartera.reduce((s, p) => s + p.coste, 0);
  const ahorroTotal = cuentas.filter(esAhorro).reduce((s, c) => s + c.saldo, 0);
  return {
    hoy,
    situacion,
    parametros,
    perfil,
    recurrentes,
    presupuesto,
    cuentas,
    cartera,
    deuda,
    patrimonio: ahorroTotal + liquidezCartera + invertidoMercado + pensiones - deuda,
    patrimonioACoste: ahorroTotal + invertidoCoste + pensiones - deuda,
  };
}

/** Evalúa la escalera a fecha `hoy` y guarda el cambio de etapa en el historial. */
export function contexto(bd: BaseDatos, hoy: Fecha): Contexto {
  const base = construir(bd, hoy);
  const resultado = evaluar(base.situacion, base.parametros);
  if (base.situacion.etapaAnterior !== resultado.etapa) {
    bd.ejecutar("INSERT INTO historial_etapas (fecha, etapa) VALUES (?, ?)", hoy, resultado.etapa);
  }
  resultado.avisos.unshift(...avisoCambioEtapa(bd, hoy));
  return { ...base, resultado };
}

/** «¡Has superado…!» durante una semana tras cambiar de etapa. */
function avisoCambioEtapa(bd: BaseDatos, hoy: Fecha): Aviso[] {
  const [ultimo, anterior] = bd.todos<{ fecha: string; etapa: Etapa }>("SELECT fecha, etapa FROM historial_etapas ORDER BY id DESC LIMIT 2");
  if (!ultimo || !anterior || diasEntre(ultimo.fecha, hoy) > 7) return [];
  return ETAPAS.indexOf(anterior.etapa) < ETAPAS.indexOf(ultimo.etapa)
    ? [{ nivel: "logro", texto: `¡Has superado «${NOMBRE_ETAPA[anterior.etapa]}»! Ahora toca: ${NOMBRE_ETAPA[ultimo.etapa].toLowerCase()}.` }]
    : [{ nivel: "atencion", texto: `Has vuelto a la etapa «${NOMBRE_ETAPA[ultimo.etapa]}».` }];
}
