import { eurosRedondos as eur, porcentaje } from "../dominio/dinero.ts";
import { diasEntre, diferenciaMeses, formatoFecha, mesDe, nombreMes, sumarMeses } from "../dominio/fechas.ts";
import { veredictoDeuda, type Deuda, type Rentabilidades, type ResultadoDeuda } from "./deuda.ts";
import { calcularPresupuesto } from "./ocio.ts";
import type { Parametros } from "./parametros.ts";
import {
  ETAPAS,
  NOMBRE_ETAPA,
  type Aviso,
  type Desbloqueo,
  type Estabilidad,
  type Etapa,
  type Explicado,
  type MetaSituacion,
  type PerfilRiesgo,
  type Presupuesto,
  type ProductoMercado,
  type Progreso,
  type Resultado,
  type Situacion,
} from "./tipos.ts";

/*
 * La escalera de inversión. La etapa actual es la primera cuyo requisito aún no se cumple; al cumplirlo se
 * pasa a la siguiente, y en la última («Invertir») se van desbloqueando más opciones a medida que crece la
 * cartera. Todo son reglas fijas: no hay IA ni conexión a internet.
 */

const MESES_FONDO: Record<Estabilidad, (p: Parametros) => number> = {
  estable: (p) => p.fondoMesesEstable,
  normal: (p) => p.fondoMesesNormal,
  inestable: (p) => p.fondoMesesInestable,
};

export const RENTA_VARIABLE: Record<PerfilRiesgo, (p: Parametros) => number> = {
  conservador: (p) => p.rvConservador,
  moderado: (p) => p.rvModerado,
  dinamico: (p) => p.rvDinamico,
  agresivo: (p) => p.rvAgresivo,
};

const TOPE_ESPECULATIVO: Record<PerfilRiesgo, (p: Parametros) => number> = {
  conservador: (p) => p.topeEspeculativoConservador,
  moderado: (p) => p.topeEspeculativoModerado,
  dinamico: (p) => p.topeEspeculativoDinamico,
  agresivo: (p) => p.topeEspeculativoAgresivo,
};

/** Si no hay ningún tipo al día, se supone este (en %) para comparar deudas. */
const RENTABILIDAD_SIN_DATOS = 2;

export function datoViejo(producto: ProductoMercado, hoy: string, p: Parametros): boolean {
  return diasEntre(producto.comprobado, hoy) > p.datoViejoDias;
}

type DeudaEvaluada = ResultadoDeuda & { deuda: Deuda };
type MetaEvaluada = MetaSituacion & { meses: number; falta: number; requerido: number; corta: boolean };

/** Las cifras que usan todas las reglas, calculadas una vez. */
interface Calculo {
  s: Situacion;
  p: Parametros;
  sobrante: number;
  liquidezLibre: number;
  colchonObjetivo: number;
  fondoMeses: number;
  fondoObjetivo: number;
  productos: ProductoMercado[];
  letras: ProductoMercado | null;
  rentabilidades: Rentabilidades;
  deudas: DeudaEvaluada[];
  caras: DeudaEvaluada[];
  metas: MetaEvaluada[];
  requeridoMetas: number;
  requeridoCortas: number;
  capacidad: number;
  bloquea: Record<Etapa, boolean>;
  etapa: Etapa;
  indice: number;
  presupuesto: Presupuesto;
  /** Lo que se ahorra al mes para el objetivo de la etapa. */
  aporte: number;
  rvObjetivo: number;
}

function calcular(s: Situacion, p: Parametros): Calculo {
  const sobrante = s.ingresos - s.esenciales - s.noEsenciales;
  const liquidezLibre = s.liquidez - s.provisiones - s.apartadoMetas;
  const colchonObjetivo = Math.max(Math.round(p.colchonMeses * s.esenciales), p.colchonMinimo * 100);
  const fondoMeses = MESES_FONDO[s.perfil.estabilidad](p);
  const fondoObjetivo = Math.max(Math.round(fondoMeses * s.esenciales), colchonObjetivo);

  // Productos con dato reciente y cuya promoción no ha terminado, del que más paga al que menos
  const productos = s.cuentasMercado
    .filter((producto) => !datoViejo(producto, s.hoy, p) && (!producto.finPromocion || producto.finPromocion >= s.hoy))
    .sort((a, b) => b.tae - a.tae);
  const letras = s.letras && !datoViejo(s.letras, s.hoy, p) ? s.letras : null;
  const mejorSinRiesgo = Math.max(productos[0]?.tae ?? 0, letras?.tae ?? 0) || RENTABILIDAD_SIN_DATOS;
  const rentabilidades = {
    sinRiesgoNeta: mejorSinRiesgo * (1 - p.tipoAhorro / 100),
    bolsaNeta: p.rentaVariableEsperada * (1 - p.lastreFiscal / 100),
  };

  const deudas = s.deudas.map((deuda) => ({ deuda, ...veredictoDeuda(deuda, rentabilidades, p) }));
  const caras = deudas.filter((d) => d.veredicto === "prioridad").sort((a, b) => b.taeEfectiva - a.taeEfectiva);

  const metas = s.metas
    .map((meta) => {
      const meses = Math.max(1, diferenciaMeses(s.hoy, meta.fecha));
      const falta = Math.max(0, meta.objetivo - meta.ahorrado);
      return { ...meta, meses, falta, requerido: Math.ceil(falta / meses), corta: meses <= p.metasCortoMeses };
    })
    .filter((meta) => meta.falta > 0);
  const requeridoMetas = metas.reduce((suma, meta) => suma + meta.requerido, 0);
  const requeridoCortas = metas.filter((meta) => meta.corta).reduce((suma, meta) => suma + meta.requerido, 0);
  const ocioMinimo = Math.max(Math.round((s.ingresos * p.ocioMinimoPct) / 100), p.ocioMinimoEur * 100);
  const capacidad = Math.max(sobrante - ocioMinimo, 0);

  // Para volver a una etapa ya superada hay que bajar bastante de su objetivo, no basta con un mes flojo
  const ordenAnterior = s.etapaAnterior ? ETAPAS.indexOf(s.etapaAnterior) : -1;
  const umbral = (objetivo: number, etapa: Etapa) => (ordenAnterior > ETAPAS.indexOf(etapa) ? Math.round((objetivo * p.reentrada) / 100) : objetivo);
  const bloquea: Record<Etapa, boolean> = {
    deficit: sobrante < 0,
    colchon: liquidezLibre < umbral(colchonObjetivo, "colchon"),
    deuda_cara: caras.length > 0,
    fondo_emergencia: liquidezLibre < umbral(fondoObjetivo, "fondo_emergencia"),
    metas_corto: requeridoCortas > capacidad,
    invertir: true,
  };
  const etapa = ETAPAS.find((e) => bloquea[e]) ?? "invertir";
  const presupuesto = calcularPresupuesto(s, etapa, p, requeridoMetas);

  return {
    s,
    p,
    sobrante,
    liquidezLibre,
    colchonObjetivo,
    fondoMeses,
    fondoObjetivo,
    productos,
    letras,
    rentabilidades,
    deudas,
    caras,
    metas,
    requeridoMetas,
    requeridoCortas,
    capacidad,
    bloquea,
    etapa,
    indice: ETAPAS.indexOf(etapa),
    presupuesto,
    aporte: presupuesto.paraEtapa,
    rvObjetivo: RENTA_VARIABLE[s.perfil.riesgo](p),
  };
}

function ejemplosCuentas(productos: ProductoMercado[]): string {
  if (!productos.length) return "No hay tipos de cuentas remuneradas al día: revísalos en Ajustes → Datos de mercado.";
  const lista = productos
    .slice(0, 3)
    .map((producto) => [`${producto.nombre} ${porcentaje(producto.tae)}`, producto.nota].filter(Boolean).join(", "))
    .join("; ");
  return `Ejemplos, no recomendación: ${lista}. Comprueba las condiciones antes de abrir nada.`;
}

function mesesHasta(falta: number, aporte: number): number | null {
  if (falta <= 0) return 0;
  return aporte > 0 ? Math.ceil(falta / aporte) : null;
}

function alRitmo(meses: number | null): string {
  if (!meses) return "";
  return ` Al ritmo propuesto, en unos ${meses} ${meses === 1 ? "mes" : "meses"}.`;
}

function productoParaPlazo(meses: number): string {
  return meses < 12 ? "cuenta remunerada" : "Letras del Tesoro, un depósito o un fondo monetario que venzan antes de la fecha";
}

// ── Qué hacer en cada etapa ────────────────────────────────────────────────────────────────────────────

type Plan = { acciones: Explicado[]; progreso: Progreso | null };

function planDeficit(c: Calculo): Plan {
  const falta = -c.sobrante;
  const texto =
    c.s.noEsenciales >= falta
      ? `Cada mes te faltan ${eur(falta)}. La regla sugiere recortar primero los gastos no esenciales, que suman ${eur(c.s.noEsenciales)}.`
      : `Cada mes te faltan ${eur(falta)}; aun quitando todos los no esenciales (${eur(c.s.noEsenciales)}) no llega. Hay que revisar los gastos esenciales o los ingresos.`;
  return {
    acciones: [{ texto, porque: "Mientras gastes más de lo que ingresas, cualquier plan de ahorro o inversión se financia con deuda o con tus ahorros. Es lo primero que hay que cuadrar." }],
    progreso: null,
  };
}

function progresoHacia(c: Calculo, objetivo: number): Progreso {
  const actual = Math.max(c.liquidezLibre, 0);
  const falta = objetivo - actual;
  return { actual, objetivo, falta, meses: mesesHasta(falta, c.aporte) };
}

function planColchon(c: Calculo): Plan {
  const progreso = progresoHacia(c, c.colchonObjetivo);
  const meses = c.p.colchonMeses === 1 ? "un mes" : `${c.p.colchonMeses} meses`;
  return {
    acciones: [
      {
        texto: `Aparta ${eur(c.aporte)} al mes en tu cuenta corriente o remunerada hasta tener ${eur(c.colchonObjetivo)} libres. Te faltan ${eur(progreso.falta)}.${alRitmo(progreso.meses)}`,
        porque: `Un colchón de ${meses} de gastos esenciales (mínimo ${eur(c.p.colchonMinimo * 100)}) evita que un imprevisto pequeño acabe en descubierto o en la tarjeta. ${ejemplosCuentas(c.productos)}`,
      },
    ],
    progreso,
  };
}

function planDeudaCara(c: Calculo): Plan {
  const [primera] = c.caras;
  if (!primera) return { acciones: [], progreso: null };
  const pendienteTotal = c.caras.reduce((suma, d) => suma + d.deuda.pendiente, 0);
  const meses = mesesHasta(primera.deuda.pendiente, primera.deuda.cuota + c.aporte);
  const plazo = meses ? ` Quedaría saldada en unos ${meses} meses.` : "";
  const resto = c.caras.length > 1 ? ` Luego, la siguiente más cara. En total te quedan ${eur(pendienteTotal)} de deuda cara.` : "";
  const comision = primera.deuda.comision ? " Mira antes la comisión por amortizar en tu contrato." : "";
  return {
    acciones: [
      {
        texto: `Paga ${eur(c.aporte)} al mes de más a «${primera.deuda.nombre}» (TAE ${porcentaje(primera.deuda.tae)}), además de su cuota.${plazo}${resto}`,
        porque: `${primera.porque} Se empieza por la de mayor TAE porque es la que más cuesta cada mes.${comision}`,
      },
    ],
    progreso: null,
  };
}

function planFondo(c: Calculo): Plan {
  const progreso = progresoHacia(c, c.fondoObjetivo);
  return {
    acciones: [
      {
        texto: `Ahorra ${eur(c.aporte)} al mes en una cuenta remunerada o un fondo monetario hasta llegar a ${eur(c.fondoObjetivo)}. Te faltan ${eur(progreso.falta)}.${alRitmo(progreso.meses)}`,
        porque: [
          `Tu fondo de emergencia son ${c.fondoMeses} meses de gastos esenciales (${c.fondoMeses} × ${eur(c.s.esenciales)}), según la estabilidad de tus ingresos.`,
          "Sirve para no tener que vender inversiones en plena caída o si te quedas sin trabajo, así que debe estar disponible y sin riesgo.",
          "Por debajo de esa cifra, tu dinero va a la cuenta remunerada; por encima, se empieza a invertir.",
          ejemplosCuentas(c.productos),
          `Ojo: más de ${eur(c.s.limiteFgd)} en una misma entidad no está cubierto por el fondo de garantía, y un fondo monetario no está garantizado.`,
        ].join(" "),
      },
    ],
    progreso,
  };
}

function planMetasCortas(c: Calculo): Plan {
  const acciones = c.metas
    .filter((meta) => meta.corta)
    .map((meta) => {
      const posible = Math.floor((c.capacidad * meta.requerido) / Math.max(c.requeridoCortas, 1));
      const mesesNecesarios = posible > 0 ? Math.ceil(meta.falta / posible) : null;
      const nuevaFecha = mesesNecesarios ? `mover la fecha a ${nombreMes(mesDe(sumarMeses(c.s.hoy, mesesNecesarios)))} o ` : "";
      return {
        texto: `No llegas a «${meta.nombre}»: necesitarías ${eur(meta.requerido)} al mes y te salen unos ${eur(posible)}. La regla sugiere ${nuevaFecha}bajar el objetivo a unos ${eur(meta.ahorrado + posible * meta.meses)}.`,
        porque: `Para un plazo de ${meta.meses} meses el dinero no debe ir a bolsa: ${productoParaPlazo(meta.meses)}. Por eso la meta se cubre solo con ahorro.`,
      };
    });
  return { acciones, progreso: null };
}

function planInvertir(c: Calculo): Plan {
  const acciones: Explicado[] = [];
  if (c.aporte > 0) {
    acciones.push({
      texto: `Invierte ${eur(c.aporte)} al mes de forma automática en fondos indexados: ${c.rvObjetivo} % en bolsa mundial y ${100 - c.rvObjetivo} % en renta fija en euros.`,
      porque: [
        "En España los fondos de inversión se pueden traspasar de uno a otro sin pagar impuestos (art. 94 de la Ley del IRPF), así que reequilibrar o cambiar de fondo no tributa hasta que vendes.",
        "Los ETF no tienen esa ventaja: son buena opción solo si vas a comprar y no tocar.",
        "Aportar cada mes de forma automática evita intentar adivinar el mercado. El reparto entre bolsa y renta fija sale de tu perfil de riesgo (Ajustes → Perfil).",
        "Ejemplos de dónde hacerlo, no recomendación: MyInvestor, Indexa Capital, Openbank, tu banco si tiene fondos indexados.",
      ].join(" "),
    });
  }
  if (c.liquidezLibre < c.fondoObjetivo) {
    acciones.push({
      texto: `Tu fondo de emergencia está por debajo del objetivo (${eur(Math.max(c.liquidezLibre, 0))} de ${eur(c.fondoObjetivo)}): lleva el ahorro nuevo a reponerlo, pero no pares la aportación automática.`,
      porque: `Bajar un poco del objetivo no te devuelve a la etapa anterior hasta que caes del ${c.p.reentrada} %, para no deshacer el plan por un mes flojo.`,
    });
  }
  // Mientras no haya otra opción a la vista, el progreso apunta a la parte especulativa
  const umbral = Math.round(c.p.especulativoMesesGasto * c.s.esenciales);
  const tope = TOPE_ESPECULATIVO[c.s.perfil.riesgo](c.p);
  const progreso =
    tope > 0 && c.s.largoPlazo < umbral
      ? { actual: c.s.largoPlazo, objetivo: umbral, falta: umbral - c.s.largoPlazo, meses: mesesHasta(umbral - c.s.largoPlazo, c.aporte) }
      : null;
  return { acciones, progreso };
}

const PLANES: Record<Etapa, (c: Calculo) => Plan> = {
  deficit: planDeficit,
  colchon: planColchon,
  deuda_cara: planDeudaCara,
  fondo_emergencia: planFondo,
  metas_corto: planMetasCortas,
  invertir: planInvertir,
};

function accionesMetas(c: Calculo): Explicado[] {
  if (c.etapa === "deficit") return [];
  return c.metas
    .filter((meta) => c.etapa !== "metas_corto" || !meta.corta)
    .map((meta) => ({
      texto: `Aparta ${eur(meta.requerido)} al mes para «${meta.nombre}» (${eur(meta.falta)} en ${meta.meses} meses).`,
      porque: meta.corta
        ? `Es una meta a menos de ${c.p.metasCortoMeses} meses: ${productoParaPlazo(meta.meses)}, nunca bolsa.`
        : "Es una meta lejana: puede ir invertida, con más renta fija a medida que se acerca la fecha.",
    }));
}

function textoSiguiente(c: Calculo): string {
  if (c.etapa === "invertir") return "Estás en la última etapa: sigue aportando. A medida que crece tu inversión se desbloquean más opciones.";
  const proxima = ETAPAS.slice(c.indice + 1).find((e) => c.bloquea[e] && e !== "invertir");
  if (proxima === "fondo_emergencia") return `Después: fondo de emergencia de ${eur(c.fondoObjetivo)} (${c.fondoMeses} meses de gastos esenciales).`;
  if (proxima) return `Después: ${NOMBRE_ETAPA[proxima].toLowerCase()}.`;
  return "Después: empezar a invertir cada mes.";
}

// ── Opciones que se desbloquean ────────────────────────────────────────────────────────────────────────

const enInvertir = (c: Calculo) => c.etapa === "invertir";

function opcionPlanEmpresa(c: Calculo): Desbloqueo | null {
  if (c.s.perfil.aportacionEmpresa <= 0) return null;
  const disponible = c.indice > ETAPAS.indexOf("colchon");
  return {
    id: "plan_empresa",
    titulo: "Plan de pensiones de empresa",
    disponible,
    requisito: disponible ? null : "Completar el colchón mínimo.",
    texto: `Tu empresa aporta ${eur(c.s.perfil.aportacionEmpresa)} al año a tu plan. Si para recibirlo tienes que aportar tú, hazlo: es dinero que pone la empresa.`,
    porque:
      "Una aportación de la empresa es una rentabilidad inmediata que ninguna otra opción iguala, por eso va antes incluso que la deuda cara. Recuerda que el plan queda bloqueado hasta la jubilación (o 10 años desde cada aportación).",
  };
}

function opcionLetras(c: Calculo): Desbloqueo {
  const minimo = c.p.excesoLiquidez * 100;
  const exceso = c.liquidezLibre - c.fondoObjetivo;
  const anteriores = Math.max(c.p.cierresExceso - 1, 0);
  const cierresConExceso = c.s.cierres.slice(0, anteriores).filter((cierre) => cierre.liquidezLibre - cierre.fondoObjetivo > minimo).length;
  const disponible = enInvertir(c) && exceso > minimo && cierresConExceso >= anteriores;
  const letras = c.letras ? `Las Letras a 12 meses rinden ~${porcentaje(c.letras.tae)} (dato del ${formatoFecha(c.letras.comprobado)})` : "Las Letras a 12 meses";
  const cuenta = c.productos[0] ? `~${porcentaje(c.productos[0].tae)}` : "lo que indique tu banco";
  return {
    id: "letras",
    titulo: "Letras del Tesoro o depósitos",
    disponible,
    requisito: disponible ? null : `Tener más de ${eur(minimo)} por encima del fondo de emergencia durante ${c.p.cierresExceso} cierres de mes seguidos.`,
    texto: `Te sobran ${eur(Math.max(exceso, 0))} de liquidez por encima del fondo de emergencia. ${letras} y un depósito fijan el tipo un año; la mejor cuenta da ${cuenta}. Elige lo que más pague, o invierte ese exceso.`,
    porque: "Tener mucho dinero parado de más pierde poder de compra con la inflación. Las Letras se compran en el Tesoro Público o en tu banco y tributan como los intereses.",
  };
}

function requisitoPension(c: Calculo, diferencia: number | null): string | null {
  if (diferencia === null) return "Indica tu tipo marginal de IRPF y el que calculas pagar al jubilarte (Ajustes → Perfil).";
  if (diferencia < c.p.pensionDiferenciaMin) return `Que tu tipo marginal supere en ${c.p.pensionDiferenciaMin} puntos al tipo al rescatar (ahora: ${porcentaje(diferencia)}).`;
  if (!enInvertir(c)) return "Llegar a la etapa Invertir.";
  return null;
}

function opcionPlanPensiones(c: Calculo): Desbloqueo {
  const { tipoMarginal: marginal, tipoRescate: rescate } = c.s.perfil;
  const diferencia = marginal !== null && rescate !== null ? marginal - rescate : null;
  const tope = c.p.pensionTope * 100;
  const ahorro = diferencia === null ? 0 : Math.round((tope * diferencia) / 100);
  const requisito = requisitoPension(c, diferencia);
  return {
    id: "plan_pensiones",
    titulo: "Plan de pensiones individual",
    disponible: requisito === null,
    requisito,
    texto: `Aportar ${eur(tope)} al año (${eur(Math.round(tope / 12))} al mes) te ahorraría unos ${eur(ahorro)} de IRPF cada año (tu marginal ${marginal === null ? "?" : porcentaje(marginal)} − ${rescate === null ? "?" : porcentaje(rescate)} al rescatar).`,
    porque: [
      "Lo aportado se resta de tu base del IRPF, pero al rescatarlo tributa como salario: solo compensa si ahora pagas un tipo mayor que el que pagarás al jubilarte, y mejor rescatarlo en varios años.",
      "El dinero queda bloqueado (solo se puede sacar lo aportado hace más de 10 años) y el límite es de 1.500 € al año o el 30 % de tus rendimientos del trabajo. Los tipos dependen de tu comunidad autónoma.",
    ].join(" "),
  };
}

function opcionAmortizar(c: Calculo): Desbloqueo | null {
  const opcionales = c.deudas.filter((d) => d.veredicto === "opcional");
  if (!opcionales.length) return null;
  const vinculada = opcionales.some((d) => d.deuda.vinculado) ? " Cuidado: si el precio dependía de mantener la financiación, amortizar puede hacerte perder el descuento." : "";
  return {
    id: "amortizar",
    titulo: "Amortizar deuda barata",
    disponible: enInvertir(c),
    requisito: enInvertir(c) ? null : "Llegar a la etapa Invertir.",
    texto: opcionales.map((d) => `«${d.deuda.nombre}»: amortizar te ahorra un ${porcentaje(d.taeEfectiva)} seguro.`).join(" "),
    porque: `${opcionales.map((d) => d.porque).join(" ")}${vinculada}`,
  };
}

function pesoEspeculativo(s: Situacion): number {
  const total = s.largoPlazo + s.especulativo;
  return total > 0 ? (s.especulativo / total) * 100 : 0;
}

function opcionEspeculativa(c: Calculo): Desbloqueo {
  const umbral = Math.round(c.p.especulativoMesesGasto * c.s.esenciales);
  const tope = TOPE_ESPECULATIVO[c.s.perfil.riesgo](c.p);
  const disponible = enInvertir(c) && tope > 0 && c.s.largoPlazo >= umbral;
  let requisito: string | null = null;
  if (tope === 0) requisito = "Con perfil conservador la regla no reserva parte especulativa.";
  else if (!disponible) requisito = `Tener ${eur(umbral)} invertidos a largo plazo (${c.p.especulativoMesesGasto} meses de gastos esenciales). Ahora: ${eur(c.s.largoPlazo)}.`;
  const total = c.s.largoPlazo + c.s.especulativo;
  return {
    id: "especulativo",
    titulo: "Parte especulativa: cripto y divisas",
    disponible,
    requisito,
    texto: `Puedes dedicar hasta un ${tope} % de lo invertido (unos ${eur(Math.round((total * tope) / 100))}) a cripto o divisas, como algo aparte que podrías perder. Ahora tienes un ${porcentaje(pesoEspeculativo(c.s), 1)}. Las acciones sueltas, como mucho un ${c.p.topeAccion} % cada una.`,
    porque: [
      "Ni las criptomonedas ni las divisas tienen una rentabilidad esperada fiable.",
      "Para alguien que cobra y gasta en euros, tener dólares o francos solo añade vaivenes y comisiones; tus fondos globales ya llevan mucha exposición al dólar (por eso existen versiones con la divisa cubierta).",
      "Una divisa tiene sentido si vas a gastar en ella (una meta en esa moneda). Por eso cripto y divisas se limitan a una parte pequeña.",
    ].join(" "),
  };
}

function opcionReequilibrar(c: Calculo): Desbloqueo {
  const lt = c.s.largoPlazo;
  const rvActual = lt > 0 ? (c.s.rentaVariable / lt) * 100 : 0;
  const desvio = rvActual - c.rvObjetivo;
  const disponible = enInvertir(c) && c.s.fondos >= 2;
  const mover = Math.abs(c.s.rentaVariable - (lt * c.rvObjetivo) / 100);
  const meses = c.aporte > 0 ? Math.ceil(mover / c.aporte) : null;
  const traspaso = meses !== null && meses > 6 ? `; tardarías unos ${meses} meses, así que mejor haz un traspaso entre fondos de unos ${eur(mover)}` : "";
  const texto =
    Math.abs(desvio) > c.p.desvio
      ? `Tu cartera tiene un ${porcentaje(rvActual, 0)} en bolsa y tu perfil pide un ${c.rvObjetivo} %. Lleva las aportaciones nuevas a ${desvio > 0 ? "renta fija" : "bolsa"}${traspaso}.`
      : `Tu reparto (${porcentaje(rvActual, 0)} en bolsa, objetivo ${c.rvObjetivo} %) está dentro del margen de ±${c.p.desvio} puntos. Revísalo una vez al año.`;
  return {
    id: "reequilibrar",
    titulo: "Reequilibrar la cartera",
    disponible,
    requisito: disponible ? null : "Tener al menos 2 fondos (por ejemplo, uno de bolsa mundial y otro de renta fija).",
    texto,
    porque:
      "Con el tiempo la parte que más sube pesa más y la cartera arriesga más de lo que elegiste. Primero se corrige con las aportaciones nuevas; si tardarías más de 6 meses, con un traspaso entre fondos (no tributa). Vender ETF o acciones, lo último, porque sí tributa.",
  };
}

function desbloqueos(c: Calculo): Desbloqueo[] {
  return [opcionPlanEmpresa(c), opcionLetras(c), opcionPlanPensiones(c), opcionAmortizar(c), opcionEspeculativa(c), opcionReequilibrar(c)].filter(
    (opcion): opcion is Desbloqueo => opcion !== null,
  );
}

// ── Avisos ─────────────────────────────────────────────────────────────────────────────────────────────

function avisosPrestamos(c: Calculo): Aviso[] {
  const { s, p } = c;
  const avisos: Aviso[] = [];
  for (const prestamo of s.prestamosPorTerminar) {
    const dias = diasEntre(s.hoy, prestamo.fin);
    if (dias < 0 || dias > p.avisoPrestamoMeses * 30.5) continue;
    avisos.push({
      nivel: "info",
      texto: `En ${nombreMes(mesDe(prestamo.fin))} terminas «${prestamo.nombre}»: +${eur(prestamo.cuota)} al mes libres. La regla sugiere llevarlos enteros a ahorro los ${p.cuotaLiberadaMeses} primeros meses.`,
    });
  }
  for (const prestamo of s.prestamosTerminados) {
    const hasta = sumarMeses(prestamo.fin, p.cuotaLiberadaMeses);
    if (hasta < s.hoy) continue;
    avisos.push({
      nivel: "logro",
      texto: `Has terminado «${prestamo.nombre}»: sus ${eur(prestamo.cuota)} al mes van enteros a ahorro hasta ${nombreMes(mesDe(hasta))}; después decides qué hacer con ellos.`,
    });
  }
  return avisos;
}

function avisosMercado(c: Calculo): Aviso[] {
  const { s, p } = c;
  const avisos: Aviso[] = [];
  const viejos = [...s.cuentasMercado, ...(s.letras ? [s.letras] : [])].filter((producto) => datoViejo(producto, s.hoy, p));
  if (viejos.length) {
    avisos.push({ nivel: "atencion", texto: `Verifica estos datos de mercado, tienen más de ${p.datoViejoDias} días: ${viejos.map((v) => v.nombre).join(", ")} (Ajustes → Datos de mercado).` });
  }
  for (const producto of s.cuentasMercado) {
    if (producto.finPromocion && producto.finPromocion >= s.hoy && diasEntre(s.hoy, producto.finPromocion) <= 30) {
      avisos.push({ nivel: "info", texto: `La promoción de «${producto.nombre}» termina el ${formatoFecha(producto.finPromocion)}.` });
    }
  }
  return avisos;
}

function avisosRiesgo(c: Calculo): Aviso[] {
  const { s, p } = c;
  const avisos: Aviso[] = [];
  for (const { entidad, saldo } of s.saldosPorEntidad) {
    if (saldo > s.limiteFgd) avisos.push({ nivel: "atencion", texto: `Tienes ${eur(saldo)} en ${entidad}: el fondo de garantía solo cubre ${eur(s.limiteFgd)} por persona y entidad.` });
  }
  const tope = TOPE_ESPECULATIVO[s.perfil.riesgo](p);
  const peso = pesoEspeculativo(s);
  if (s.especulativo > 0 && peso > tope) {
    avisos.push({ nivel: "atencion", texto: `Tu parte especulativa (${porcentaje(peso, 1)}) supera el tope de tu perfil (${tope} %): la regla sugiere no añadir más.` });
  }
  if (s.largoPlazo > 0 && (s.mayorAccion / s.largoPlazo) * 100 > p.topeAccion) {
    avisos.push({ nivel: "atencion", texto: `Una sola acción pesa un ${porcentaje((s.mayorAccion / s.largoPlazo) * 100, 1)} de tu inversión (tope ${p.topeAccion} %).` });
  }
  if (c.presupuesto.correccion > 0) {
    avisos.push({
      nivel: "info",
      texto: `En tus últimos cierres ahorraste menos de lo previsto: el ocio baja ${eur(c.presupuesto.correccion)} hasta que se equilibre. Puede que haya gastos que no estés apuntando.`,
    });
  }
  return avisos;
}

/** El aviso de cambio de etapa lo añade quien guarda el historial (servicios/situacion.ts). */
export function evaluar(s: Situacion, p: Parametros): Resultado {
  const c = calcular(s, p);
  const plan = PLANES[c.etapa](c);
  return {
    etapa: c.etapa,
    numero: c.indice + 1,
    nombre: NOMBRE_ETAPA[c.etapa],
    acciones: [...plan.acciones, ...accionesMetas(c)],
    progreso: plan.progreso,
    siguiente: textoSiguiente(c),
    desbloqueos: desbloqueos(c),
    avisos: [...avisosPrestamos(c), ...avisosMercado(c), ...avisosRiesgo(c)],
    presupuesto: c.presupuesto,
    liquidezLibre: c.liquidezLibre,
    colchonObjetivo: c.colchonObjetivo,
    fondoObjetivo: c.fondoObjetivo,
    fondoMeses: c.fondoMeses,
    rentabilidades: c.rentabilidades,
    rentaVariableObjetivo: c.rvObjetivo,
  };
}
