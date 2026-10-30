import type { Centimos } from "../dominio/dinero.ts";
import { diasDelMes, diasEntre, indiceMes, mesDe, mesDesdeIndice, sumarDias, type Fecha, type Mes } from "../dominio/fechas.ts";
import type { Frecuencia } from "../dominio/recurrencia.ts";

/*
 * Lo que se repite en tus movimientos: cargos que llegan cada mes, cada 2, 3, 6 o 12 meses (alquiler,
 * Netflix, la luz, el seguro…), la nómina, lo que gastas de media en cada categoría y los traspasos entre tus
 * propias cuentas. Son funciones puras: reciben movimientos y devuelven lo encontrado, sin tocar la base.
 */

export interface ApunteDetectable {
  id: number;
  fecha: Fecha;
  importe: Centimos;
  concepto: string;
  categoriaId: number | null;
  cuentaId: number | null;
}

export type Canal = "tarjeta" | "recibo" | "transferencia" | "otro";

// ── La clave de un concepto ──

const MESES = new Set(
  ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre"].flatMap((m) => [m, m.slice(0, 3), m.slice(0, 4)]),
);
const TARJETA = new Set(["tarj", "tarjeta", "tpv", "compra", "compras", "card", "purchase", "contactless"]);
const RECIBO = new Set(["recibo", "recibos", "adeudo", "domiciliacion", "domiciliado", "sepa", "mandato", "direct", "debit", "cargo"]);
const TRANSFERENCIA = new Set(["transferencia", "transf", "trf", "traspaso", "transfer", "enviada", "enviado", "orden", "ordenante", "beneficiario"]);
/** Palabras que dicen cómo se pagó o adornan el concepto, no quién cobra */
const RUIDO = new Set([
  ...TARJETA,
  ...RECIBO,
  ...TRANSFERENCIA,
  "pago", "pagos", "payment", "factura", "fra", "periodo", "ref", "referencia", "favor", "recibido", "recibida", "inmediata", "periodica", "realizada", "emitida",
  "abono", "ingreso", "concepto", "operacion", "devolucion", "anulacion", "reembolso", "refund", "cuota", "importe", "fecha", "num", "numero", "cliente",
  "con", "del", "las", "los", "para", "por", "una", "the", "and", "www", "com", "net", "org", "sl", "slu", "sa", "sau", "sll", "scoop", "coop",
]);
/** Conceptos que nunca son un gasto fijo de verdad */
const LISTA_NEGRA = /(liquidacion|cajero|reintegro|intereses|comision|retencion)/;

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function trocear(texto: string): { utiles: string[]; canal: Canal } {
  const normal = normalizar(texto);
  if (LISTA_NEGRA.test(normal)) return { utiles: [], canal: "otro" };
  let canal: Canal = "otro";
  const utiles: string[] = [];
  for (const token of normal.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (canal === "otro") {
      if (TARJETA.has(token)) canal = "tarjeta";
      else if (RECIBO.has(token)) canal = "recibo";
      else if (TRANSFERENCIA.has(token)) canal = "transferencia";
    }
    if (/\d/.test(token) || token.length <= 2 || RUIDO.has(token) || MESES.has(token)) continue;
    utiles.push(token);
  }
  return { utiles, canal };
}

/**
 * La «clave» de un concepto: sus 2 primeras palabras con sentido, sin cifras (fechas, tarjetas, referencias),
 * meses ni palabras de canal. «RECIBO NETFLIX.COM 12/10» y «COMPRA TARJ 4589 NETFLIX.COM» dan «netflix».
 * En lo traído del banco (texto · quien cobra) manda quien cobra. Vacía si no hay nada fiable.
 */
export function claveConcepto(concepto: string): { clave: string; canal: Canal; palabras: string[] } {
  const partes = concepto.split(" · ");
  const completo = trocear(concepto);
  for (const texto of partes.length > 1 ? [partes.at(-1)!, concepto] : [concepto]) {
    const { utiles } = trocear(texto);
    const clave = utiles.slice(0, 2).join(" ");
    if (clave.length >= 3) return { clave, canal: completo.canal, palabras: completo.utiles };
  }
  return { clave: "", canal: completo.canal, palabras: completo.utiles };
}

/** ¿Aparecen todas las palabras del patrón en el concepto? (palabras enteras: «dia» no casa con «diario») */
export function casaPatron(patron: string, concepto: string): boolean {
  const palabras = new Set(claveConcepto(concepto).palabras);
  const buscadas = patron.split(" ").filter(Boolean);
  return buscadas.length > 0 && buscadas.every((p) => palabras.has(p));
}

// ── Cargos que se repiten ──

export interface Periodico {
  /** Clave del concepto y signo: identifica el grupo */
  clave: string;
  nombre: string;
  tipo: "gasto" | "ingreso";
  /** Cada cuántos meses llega: 1, 2, 3, 6 o 12 */
  meses: number;
  /** Cómo se guarda (la app no tiene «cada 2 meses»: eso va como mensual estimado a mitad de importe) */
  frecuencia: Frecuencia;
  clase: "fijo" | "estimacion";
  /** Importe de cada cargo (positivo) */
  importe: Centimos;
  /** Lo que pesa al mes en el presupuesto */
  mensual: Centimos;
  /** En los fijos, cada cambio de precio con su fecha (el primero es el inicio) */
  escalones: { desde: Fecha; importe: Centimos }[];
  /** Fecha prevista del primer cargo, con el día habitual (no el de un cargo que se adelantó o retrasó) */
  inicio: Fecha;
  /** Margen en días para reconocer sus cargos */
  tolerancia: number;
  ultimo: Fecha;
  veces: number;
  categoriaId: number | null;
  cuentaId: number | null;
  canal: Canal;
  ejemplo: string;
  apunteIds: number[];
  /** Un único cargo grande (seguro, impuesto) que puede ser anual: se pregunta */
  unico: boolean;
}

const PERIODOS = [
  { meses: 1, tolerancia: 7, minimo: 3 },
  { meses: 2, tolerancia: 10, minimo: 2 },
  { meses: 3, tolerancia: 12, minimo: 2 },
  { meses: 6, tolerancia: 15, minimo: 2 },
  { meses: 12, tolerancia: 20, minimo: 2 },
];
const FRECUENCIA: Record<number, Frecuencia> = { 1: "mensual", 2: "mensual", 3: "trimestral", 6: "semestral", 12: "anual" };

const mediana = (valores: readonly number[]): number => {
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[mitad]! : Math.round((orden[mitad - 1]! + orden[mitad]!) / 2);
};
const masFrecuente = <T>(valores: readonly T[]): T | null => {
  const cuentas = new Map<T, number>();
  for (const v of valores) if (v !== null) cuentas.set(v, (cuentas.get(v) ?? 0) + 1);
  return [...cuentas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Posición en meses con decimales (15 de marzo ≈ marzo + 0,47): para medir distancias entre fechas en meses */
function posicion(fecha: Fecha): number {
  const dia = Number(fecha.slice(8, 10));
  return indiceMes(fecha) + (dia - 1) / 30.44;
}

/** El día del mes en que suele llegar, contando que el 30 y el 2 están cerca (nómina que llega del 27 al 2) */
function diaHabitual(fechas: readonly Fecha[]): number {
  const dias = fechas.map((f) => Number(f.slice(8, 10)));
  let mejor = { dia: 1, distancia: Infinity };
  for (let dia = 1; dia <= 31; dia++) {
    const distancia = dias.reduce((suma, d) => suma + Math.min(Math.abs(dia - d), 31 - Math.abs(dia - d)), 0);
    if (distancia < mejor.distancia) mejor = { dia, distancia };
  }
  return mejor.dia;
}

function fechaEnMes(indice: number, dia: number): Fecha {
  const mes = mesDesdeIndice(indice);
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${mes}-${String(Math.min(dia, diasDelMes(a, m))).padStart(2, "0")}`;
}

/**
 * ¿Encajan estos cargos en huecos cada `meses` meses? Un cargo por hueco, cada uno a ±tolerancia días de su
 * fecha prevista y cubriendo al menos el 75 % de los huecos. Devuelve la fecha prevista del primero.
 */
function encaja(cargos: readonly ApunteDetectable[], meses: number, tolerancia: number, dia: number): Fecha | null {
  const primero = cargos[0]!;
  // El primer hueco: el día habitual en el mes del primer cargo, o en el de al lado si queda más cerca
  const base = [-1, 0, 1]
    .map((d) => fechaEnMes(indiceMes(primero.fecha) + d, dia))
    .sort((a, b) => Math.abs(diasEntre(a, primero.fecha)) - Math.abs(diasEntre(b, primero.fecha)))[0]!;
  const huecos = new Set<number>();
  for (const cargo of cargos) {
    const k = Math.round((posicion(cargo.fecha) - posicion(base)) / meses);
    const prevista = fechaEnMes(indiceMes(base) + k * meses, dia);
    if (Math.abs(diasEntre(prevista, cargo.fecha)) > tolerancia || huecos.has(k)) return null;
    huecos.add(k);
  }
  const total = Math.max(...huecos) + 1;
  return huecos.size / total >= 0.75 ? base : null;
}

/**
 * Los fijos cambian de precio de vez en cuando (Netflix sube): tramos de importe que se mantienen. Es fijo si
 * cambia como mucho 2 veces y cada precio, salvo el último, se repitió al menos dos veces (40, 55 y 70 € son
 * una factura que varía, no tres precios).
 */
function escalones(cargos: readonly ApunteDetectable[]): { desde: Fecha; importe: Centimos }[] | null {
  const lista: { desde: Fecha; importe: Centimos; veces: number }[] = [];
  for (const cargo of cargos) {
    const importe = Math.abs(cargo.importe);
    const ultimo = lista.at(-1);
    if (ultimo && Math.abs(importe - ultimo.importe) <= Math.max(1, ultimo.importe * 0.01)) ultimo.veces++;
    else lista.push({ desde: cargo.fecha, importe, veces: 1 });
  }
  const asentados = lista.slice(0, -1).every((tramo) => tramo.veces >= 2);
  return lista.length <= 3 && asentados ? lista.map(({ desde, importe }) => ({ desde, importe })) : null;
}

function nombreDe(clave: string): string {
  return clave.charAt(0).toUpperCase() + clave.slice(1);
}

/**
 * Fijo (siempre lo mismo, con algún cambio de precio) o estimado (una factura que varía hasta un ±60 %
 * alrededor de lo normal, con la media de los últimos 12 meses: la luz cambia de invierno a verano).
 */
function clasificarImporte(cargos: readonly ApunteDetectable[], meses: number): { clase: "fijo" | "estimacion"; importe: Centimos; pasos: { desde: Fecha; importe: Centimos }[] | null } | null {
  const pasos = escalones(cargos);
  if (pasos) return { clase: "fijo", importe: pasos.at(-1)!.importe, pasos };
  const importes = cargos.map((c) => Math.abs(c.importe));
  const centro = mediana(importes);
  if (!importes.every((i) => Math.abs(i - centro) <= centro * 0.6)) return null;
  const recientes = importes.slice(-Math.max(1, Math.round(12 / meses)));
  return { clase: "estimacion", importe: Math.round(recientes.reduce((s, i) => s + i, 0) / recientes.length), pasos: null };
}

/** Intenta reconocer un grupo de cargos (misma clave y signo) como algo periódico */
function reconocer(clave: string, cargos: ApunteDetectable[], ultimoPorCuenta: ReadonlyMap<number | null, Fecha>): Periodico | null {
  cargos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  const dia = diaHabitual(cargos.map((c) => c.fecha));
  const canal = claveConcepto(cargos.at(-1)!.concepto).canal;
  for (const periodo of PERIODOS) {
    const inicio = cargos.length >= periodo.minimo ? encaja(cargos, periodo.meses, periodo.tolerancia, dia) : null;
    const importe = inicio ? clasificarImporte(cargos, periodo.meses) : null;
    if (!inicio || !importe) continue;
    // Las compras con tarjeta solo son gasto fijo si son siempre lo mismo (una suscripción)
    if (canal === "tarjeta" && importe.clase === "estimacion") return null;
    // ¿Sigue activo? Se mira hasta dónde llegan los movimientos de esa cuenta, no la fecha de hoy
    const cuentaId = masFrecuente(cargos.map((c) => c.cuentaId));
    const ultimo = cargos.at(-1)!.fecha;
    const hastaCuenta = ultimoPorCuenta.get(cuentaId) ?? ultimo;
    if (diasEntre(ultimo, hastaCuenta) > periodo.meses * 31 + periodo.tolerancia) return null;
    const bimestral = periodo.meses === 2;
    return {
      clave,
      nombre: nombreDe(clave.split(":")[1] ?? clave),
      tipo: cargos[0]!.importe < 0 ? "gasto" : "ingreso",
      meses: periodo.meses,
      frecuencia: FRECUENCIA[periodo.meses]!,
      // Cada 2 meses: mensual y estimado, a mitad de importe (la app no tiene «bimestral»)
      clase: bimestral ? "estimacion" : importe.clase,
      importe: importe.importe,
      mensual: Math.round(importe.importe / periodo.meses),
      escalones: importe.pasos && !bimestral ? importe.pasos : [{ desde: inicio, importe: importe.importe }],
      inicio,
      tolerancia: periodo.tolerancia,
      ultimo,
      veces: cargos.length,
      categoriaId: masFrecuente(cargos.map((c) => c.categoriaId)),
      cuentaId,
      canal,
      ejemplo: cargos.at(-1)!.concepto,
      apunteIds: cargos.map((c) => c.id),
      unico: false,
    };
  }
  return null;
}

/** Separa por importe: «APPLE» puede ser iCloud a 2,99 y Apple Music a 10,99, cada uno con su mes */
function porImporte(cargos: readonly ApunteDetectable[]): ApunteDetectable[][] {
  const orden = [...cargos].sort((a, b) => Math.abs(a.importe) - Math.abs(b.importe));
  const grupos: ApunteDetectable[][] = [];
  for (const cargo of orden) {
    const grupo = grupos.at(-1);
    if (grupo && Math.abs(cargo.importe) <= Math.abs(grupo[0]!.importe) * 1.6) grupo.push(cargo);
    else grupos.push([cargo]);
  }
  return grupos;
}

/** Quita las devoluciones y el cargo que anulan (mismo importe, misma clave, en 60 días) */
function sinDevoluciones(apuntes: readonly ApunteDetectable[]): ApunteDetectable[] {
  const quitados = new Set<number>();
  for (const devolucion of apuntes.filter((a) => a.importe > 0 && /(devoluc|anulac|reembolso|refund)/.test(normalizar(a.concepto)))) {
    const clave = claveConcepto(devolucion.concepto).clave;
    const cargo = apuntes.find(
      (a) => !quitados.has(a.id) && a.importe === -devolucion.importe && Math.abs(diasEntre(a.fecha, devolucion.fecha)) <= 60 && claveConcepto(a.concepto).clave === clave,
    );
    if (cargo) {
      quitados.add(cargo.id);
      quitados.add(devolucion.id);
    }
  }
  return apuntes.filter((a) => !quitados.has(a.id));
}

const PALABRAS_ANUAL = /(seguro|poliza|mutua|asegura|ibi|impuesto|tasa|itv|vehiculo|circulacion|colegio|matricula|dominio|licencia|anual)/;

/** Un cargo suelto y grande de un seguro o un impuesto puede ser anual: con 3 meses de banco no habrá dos */
function posibleAnual(clave: string, cargo: ApunteDetectable, categoriasAnuales: ReadonlySet<number>): Periodico | null {
  const pareceAnual = PALABRAS_ANUAL.test(normalizar(cargo.concepto)) || (cargo.categoriaId !== null && categoriasAnuales.has(cargo.categoriaId));
  if (cargo.importe > -5000 || !pareceAnual) return null;
  return {
    clave,
    nombre: nombreDe(clave.split(":")[1] ?? clave),
    tipo: "gasto",
    meses: 12,
    frecuencia: "anual",
    clase: "fijo",
    importe: -cargo.importe,
    mensual: Math.round(-cargo.importe / 12),
    escalones: [{ desde: cargo.fecha, importe: -cargo.importe }],
    inicio: cargo.fecha,
    tolerancia: 20,
    ultimo: cargo.fecha,
    veces: 1,
    categoriaId: cargo.categoriaId,
    cuentaId: cargo.cuentaId,
    canal: claveConcepto(cargo.concepto).canal,
    ejemplo: cargo.concepto,
    apunteIds: [cargo.id],
    unico: true,
  };
}

/**
 * Busca lo que se repite. `apuntes`: los movimientos sin gasto fijo y que no son traspaso.
 * `ultimoPorCuenta`: hasta qué fecha llegan los movimientos de cada cuenta (para saber si algo sigue activo).
 * `categoriasAnuales`: categorías en las que un único cargo grande puede ser anual (Seguros, Impuestos).
 */
export function detectarPeriodicos(
  apuntes: readonly ApunteDetectable[],
  ultimoPorCuenta: ReadonlyMap<number | null, Fecha>,
  categoriasAnuales: ReadonlySet<number> = new Set(),
): Periodico[] {
  const grupos = new Map<string, ApunteDetectable[]>();
  for (const apunte of sinDevoluciones(apuntes)) {
    const { clave } = claveConcepto(apunte.concepto);
    if (!clave || apunte.importe === 0) continue;
    const id = `${apunte.importe < 0 ? "-" : "+"}:${clave}`;
    grupos.set(id, [...(grupos.get(id) ?? []), apunte]);
  }
  const encontrados: Periodico[] = [];
  for (const [clave, cargos] of grupos) {
    // Primero el grupo entero; si no encaja (dos cargos en el mismo mes), cada franja de importe por separado
    const entero = reconocer(clave, [...cargos], ultimoPorCuenta);
    if (entero) {
      encontrados.push(entero);
      continue;
    }
    const partes = porImporte(cargos)
      .map((parte) => reconocer(clave, parte, ultimoPorCuenta))
      .filter((p): p is Periodico => p !== null);
    encontrados.push(...partes);
    const anual = cargos.length === 1 ? posibleAnual(clave, cargos[0]!, categoriasAnuales) : null;
    if (anual) encontrados.push(anual);
  }
  return encontrados.sort((a, b) => b.mensual - a.mensual);
}

// ── Gasto variable de cada mes ──

export interface Estimacion {
  categoriaId: number | null;
  /** Mediana de lo gastado al mes */
  mensual: Centimos;
  meses: { mes: Mes; total: Centimos }[];
}

/**
 * Lo que gastas al mes en cada categoría en cosas que varían (súper, gasolina…): la mediana de los últimos
 * 3 meses completos con movimientos importados. `apuntes`: gastos sin gasto fijo, que no son traspaso ni
 * algo periódico ya encontrado. Devuelve también la categoría null (lo que no tiene categoría).
 */
export function estimacionesPorCategoria(apuntes: readonly ApunteDetectable[], cubiertos: { desde: Fecha; hasta: Fecha } | null): Estimacion[] {
  if (!cubiertos) return [];
  // Meses completos: desde el primero que empieza dentro de lo importado hasta el último que acaba dentro
  const primero = cubiertos.desde.endsWith("-01") ? indiceMes(cubiertos.desde) : indiceMes(cubiertos.desde) + 1;
  const fin = mesDe(sumarDias(cubiertos.hasta, 1)) !== mesDe(cubiertos.hasta) ? indiceMes(cubiertos.hasta) : indiceMes(cubiertos.hasta) - 1;
  const meses = Array.from({ length: Math.max(0, fin - primero + 1) }, (_, i) => mesDesdeIndice(primero + i)).slice(-3);
  if (meses.length < 2) return [];
  const totales = new Map<number | null, Map<Mes, number>>();
  for (const a of apuntes) {
    const mes = mesDe(a.fecha);
    if (a.importe >= 0 || !meses.includes(mes)) continue;
    const porMes = totales.get(a.categoriaId) ?? new Map<Mes, number>();
    porMes.set(mes, (porMes.get(mes) ?? 0) - a.importe);
    totales.set(a.categoriaId, porMes);
  }
  return [...totales].map(([categoriaId, porMes]) => {
    const lista = meses.map((mes) => ({ mes, total: porMes.get(mes) ?? 0 }));
    return { categoriaId, mensual: mediana(lista.map((m) => m.total)), meses: lista };
  });
}

// ── Traspasos entre tus cuentas ──

const PALABRAS_TRASPASO = /\b(transf\w*|traspaso\w*|trf|envio|enviada|enviado|transfer\w*|aportacion\w*|deposit\w*)\b/;

/**
 * Parejas de movimientos que son el mismo dinero pasando de una cuenta tuya a otra: lo que sale de una y
 * entra en otra, mismo importe, como mucho a 5 días. Para no confundirlo con una compra y un Bizum que
 * coinciden, los dos conceptos dicen que es una transferencia o uno nombra el banco del otro.
 */
export function emparejarTraspasos(apuntes: readonly ApunteDetectable[], entidades: ReadonlyMap<number, string>): [number, number][] {
  const conPalabra = (a: ApunteDetectable) => PALABRAS_TRASPASO.test(normalizar(a.concepto));
  const nombra = (a: ApunteDetectable, cuentaId: number | null) => {
    const entidad = cuentaId === null ? "" : normalizar(entidades.get(cuentaId) ?? "").trim();
    return entidad.length >= 3 && normalizar(a.concepto).includes(entidad);
  };
  const entradas = new Map<number, ApunteDetectable[]>();
  for (const a of apuntes) if (a.importe > 0 && a.cuentaId !== null) entradas.set(a.importe, [...(entradas.get(a.importe) ?? []), a]);
  const usados = new Set<number>();
  const parejas: [number, number][] = [];
  for (const salida of [...apuntes].filter((a) => a.importe < 0 && a.cuentaId !== null).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const candidata = (entradas.get(-salida.importe) ?? [])
      .filter((e) => !usados.has(e.id) && e.cuentaId !== salida.cuentaId && Math.abs(diasEntre(salida.fecha, e.fecha)) <= 5)
      .filter((e) => (conPalabra(salida) && conPalabra(e)) || nombra(salida, e.cuentaId) || nombra(e, salida.cuentaId))
      .sort((a, b) => Math.abs(diasEntre(salida.fecha, a.fecha)) - Math.abs(diasEntre(salida.fecha, b.fecha)))[0];
    if (candidata) {
      usados.add(candidata.id);
      parejas.push([salida.id, candidata.id]);
    }
  }
  return parejas;
}
