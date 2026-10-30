// Fechas como texto "AAAA-MM-DD" y meses como "AAAA-MM": se guardan y comparan tal cual en SQLite.
export type Fecha = string;
export type Mes = string;

const dos = (n: number) => String(n).padStart(2, "0");

export function fechaDe(fecha: Date): Fecha {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

export function hoy(): Fecha {
  return fechaDe(new Date());
}

export function esFecha(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = partes(texto);
  return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(a, m);
}

function partes(fecha: Fecha): [number, number, number] {
  const [a = 0, m = 1, d = 1] = fecha.split("-").map(Number);
  return [a, m, d];
}

export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

export function mesDe(fecha: Fecha): Mes {
  return fecha.slice(0, 7);
}

/** Número de mes absoluto para poder restar meses: 2026-10 → 2026 × 12 + 9. */
export function indiceMes(fechaOMes: Fecha | Mes): number {
  const [a, m] = partes(fechaOMes.length === 7 ? `${fechaOMes}-01` : fechaOMes);
  return a * 12 + (m - 1);
}

export function mesDesdeIndice(indice: number): Mes {
  return `${Math.floor(indice / 12)}-${dos((indice % 12) + 1)}`;
}

export function sumarMesesAMes(mes: Mes, n: number): Mes {
  return mesDesdeIndice(indiceMes(mes) + n);
}

/** Meses de `desde` a `hasta` (positivo si `hasta` es posterior). Solo cuenta el mes, no el día. */
export function diferenciaMeses(desde: Fecha | Mes, hasta: Fecha | Mes): number {
  return indiceMes(hasta) - indiceMes(desde);
}

/**
 * Suma meses conservando el día del mes de `fecha`; si el mes destino es más corto, usa su último día
 * (31 de enero + 1 mes = 28 o 29 de febrero).
 */
export function sumarMeses(fecha: Fecha, n: number): Fecha {
  const [, , d] = partes(fecha);
  const destino = mesDesdeIndice(indiceMes(fecha) + n);
  const [a, m] = partes(`${destino}-01`);
  return `${destino}-${dos(Math.min(d, diasDelMes(a, m)))}`;
}

export function primerDia(mes: Mes): Fecha {
  return `${mes}-01`;
}

export function ultimoDia(mes: Mes): Fecha {
  const [a, m] = partes(`${mes}-01`);
  return `${mes}-${dos(diasDelMes(a, m))}`;
}

export function diasEntre(desde: Fecha, hasta: Fecha): number {
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

export function sumarDias(fecha: Fecha, dias: number): Fecha {
  const [a, m, d] = partes(fecha);
  const resultado = new Date(Date.UTC(a, m - 1, d + dias));
  return `${resultado.getUTCFullYear()}-${dos(resultado.getUTCMonth() + 1)}-${dos(resultado.getUTCDate())}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "octubre de 2026" */
export function nombreMes(mes: Mes): string {
  const [a, m] = partes(`${mes}-01`);
  return `${MESES[m - 1]} de ${a}`;
}

/** "oct 2026" */
export function nombreMesCorto(mes: Mes): string {
  const [a, m] = partes(`${mes}-01`);
  return `${MESES[m - 1]?.slice(0, 3)} ${a}`;
}

/** "30/10/2026" */
export function formatoFecha(fecha: Fecha | null | undefined): string {
  if (!fecha) return "";
  const [a, m, d] = partes(fecha);
  return `${dos(d)}/${dos(m)}/${a}`;
}
