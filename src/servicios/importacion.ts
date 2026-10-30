import type { BaseDatos } from "../datos/db.ts";
import { diasEntre, sumarDias, type Fecha } from "../dominio/fechas.ts";
import { estadoEn, importeEn, ocurrencias, type Frecuencia } from "../dominio/recurrencia.ts";
import { categoriaPorReglas, huellas, type Configuracion, type Movimiento, type Regla } from "../importar/extracto.ts";
import { casaPatron } from "../importar/periodicos.ts";
import { leerRecurrentes, type RecurrenteCompleto } from "./finanzas.ts";
import { marcarTraspasos } from "./periodicos.ts";

export interface Propuesta extends Movimiento {
  huella: string;
  duplicado: boolean;
  categoriaId: number | null;
  /** Gasto o ingreso fijo con el que coincide: ya está contado en el presupuesto. */
  recurrenteId: number | null;
  recurrente: string | null;
}

/** Margen para reconocer un cargo fijo en el extracto: ±5 % del importe y ±5 días de la fecha. */
const MARGEN_IMPORTE = 0.05;
const MARGEN_DIAS = 5;
/** Con el texto del banco (patrón) se reconoce aunque se adelante o retrase más, según cada cuánto llega */
const MARGEN_DIAS_PATRON: Record<Frecuencia, number> = { mensual: 7, trimestral: 12, semestral: 15, anual: 20 };

export function leerReglas(bd: BaseDatos): (Regla & { id: number; categoria: string })[] {
  return bd.todos<{ id: number; patron: string; categoria_id: number; categoria: string }>(
    "SELECT r.id, r.patron, r.categoria_id, c.nombre AS categoria FROM reglas_categoria r JOIN categorias c ON c.id = r.categoria_id ORDER BY r.patron",
  ).map((r) => ({ id: r.id, patron: r.patron, categoriaId: r.categoria_id, categoria: r.categoria }));
}

/** Cargos de gastos fijos que ya tienen un movimiento: recurrente → fechas de los movimientos emparejados. */
export type Emparejados = Map<number, Fecha[]>;

export function emparejadosEnBd(bd: BaseDatos): Emparejados {
  const usados: Emparejados = new Map();
  for (const fila of bd.todos<{ recurrente_id: number; fecha: string }>("SELECT recurrente_id, fecha FROM apuntes WHERE recurrente_id IS NOT NULL")) {
    usados.set(fila.recurrente_id, [...(usados.get(fila.recurrente_id) ?? []), fila.fecha]);
  }
  return usados;
}

/**
 * El gasto o ingreso fijo al que corresponde un movimiento, el que mejor encaje de los posibles:
 * - Si el gasto fijo sabe cómo aparece en el banco (patrón, p. ej. «netflix»), tiene que salir ese texto. Basta
 *   con un importe parecido (±25 %; en lo estimado, de la mitad a 4 veces, que la luz llega cada 2 meses) y
 *   una fecha cercana a un cargo previsto según cada cuánto llega. Así se reconoce aunque suba de precio.
 * - Si no lo sabe: mismo sentido, ±5 % del importe y ±5 días de un cargo previsto que aún no tenga
 *   movimiento. Si una regla de categorías dice otra cosa (un restaurante de 49 € cerca de la factura del
 *   móvil de 50 €), no se empareja. Las estimaciones sin patrón («Comida, 300 €») nunca: un súper de 290 € no
 *   es «la comida del mes».
 */
export function coincidencia(
  m: Pick<Movimiento, "fecha" | "importe"> & { concepto?: string },
  recurrentes: readonly RecurrenteCompleto[],
  usados: Emparejados = new Map(),
  categoriaRegla: number | null = null,
): RecurrenteCompleto | null {
  const tipo = m.importe < 0 ? "gasto" : "ingreso";
  const importe = Math.abs(m.importe);
  let mejor: { r: RecurrenteCompleto; puntos: number } | null = null;
  for (const r of recurrentes) {
    if (r.tipo !== tipo) continue;
    const conPatron = Boolean(r.patron && m.concepto !== undefined);
    if (conPatron && !casaPatron(r.patron!, m.concepto!)) continue;
    if (!conPatron && (r.clase === "estimacion" || (categoriaRegla !== null && r.categoriaId !== null && r.categoriaId !== categoriaRegla))) continue;
    const dias = conPatron ? MARGEN_DIAS_PATRON[r.frecuencia] : MARGEN_DIAS;
    if (estadoEn(r, sumarDias(m.fecha, dias)) === "proximo") continue;
    for (const fecha of ocurrencias(r, sumarDias(m.fecha, -dias), sumarDias(m.fecha, dias))) {
      if ((usados.get(r.id) ?? []).some((otra) => Math.abs(diasEntre(otra, fecha)) <= dias)) continue;
      const previsto = importeEn(r.versiones, fecha);
      const proporcion = previsto > 0 ? importe / previsto : Infinity;
      const vale = !conPatron ? Math.abs(previsto - importe) <= previsto * MARGEN_IMPORTE : r.clase === "estimacion" ? proporcion >= 0.5 && proporcion <= 4 : Math.abs(proporcion - 1) <= 0.25;
      if (!vale) continue;
      // Cuanto más cerca de lo previsto en importe y fecha, mejor; y por encima de todo, que salga su texto
      const puntos = (conPatron ? 0 : 100) + Math.abs(proporcion - 1) * 10 + Math.abs(diasEntre(m.fecha, fecha)) / 10;
      if (!mejor || puntos < mejor.puntos) mejor = { r, puntos };
    }
  }
  if (mejor) usados.set(mejor.r.id, [...(usados.get(mejor.r.id) ?? []), m.fecha]);
  return mejor?.r ?? null;
}

export function proponer(bd: BaseDatos, movimientos: readonly Movimiento[], cuentaId: number | null): Propuesta[] {
  const reglas = leerReglas(bd);
  const recurrentes = leerRecurrentes(bd);
  const existentes = new Set(bd.todos<{ hash_dedupe: string }>("SELECT hash_dedupe FROM apuntes WHERE hash_dedupe IS NOT NULL").map((f) => f.hash_dedupe));
  const lista = huellas(movimientos, cuentaId);
  const usados = emparejadosEnBd(bd);
  return movimientos.map((m, i) => {
    const duplicado = existentes.has(lista[i]!);
    const porRegla = categoriaPorReglas(m.concepto, reglas);
    // Un movimiento ya importado no gasta un cargo previsto: ya lo tiene asignado
    const recurrente = duplicado ? null : coincidencia(m, recurrentes, usados, porRegla);
    return {
      ...m,
      huella: lista[i]!,
      duplicado,
      categoriaId: porRegla ?? recurrente?.categoriaId ?? null,
      recurrenteId: recurrente?.id ?? null,
      recurrente: recurrente?.nombre ?? null,
    };
  });
}

export function importar(
  bd: BaseDatos,
  propuestas: readonly Propuesta[],
  datos: { cuentaId: number | null; archivo: string; hoy: Fecha; perfil: { nombre: string; firma: string; configuracion: Configuracion } | null },
): { nuevas: number; duplicadas: number } {
  const resultado = bd.transaccion(() => {
    const nuevas = propuestas.filter((p) => !p.duplicado);
    const { id: importacionId } = bd.ejecutar(
      "INSERT INTO importaciones (fecha, archivo, cuenta_id, filas, nuevas) VALUES (?, ?, ?, ?, ?)",
      datos.hoy,
      datos.archivo,
      datos.cuentaId,
      propuestas.length,
      nuevas.length,
    );
    for (const p of nuevas) {
      bd.ejecutar(
        "INSERT OR IGNORE INTO apuntes (fecha, importe, concepto, categoria_id, cuenta_id, recurrente_id, origen, importacion_id, hash_dedupe) VALUES (?, ?, ?, ?, ?, ?, 'csv', ?, ?)",
        p.fecha,
        p.importe,
        p.concepto,
        p.categoriaId,
        datos.cuentaId,
        p.recurrenteId,
        importacionId,
        p.huella,
      );
    }
    if (datos.perfil) {
      bd.ejecutar(
        "INSERT INTO perfiles_importacion (nombre, firma, configuracion) VALUES (?, ?, ?) ON CONFLICT (nombre) DO UPDATE SET firma = excluded.firma, configuracion = excluded.configuracion",
        datos.perfil.nombre,
        datos.perfil.firma,
        JSON.stringify(datos.perfil.configuracion),
      );
    }
    return { nuevas: nuevas.length, duplicadas: propuestas.length - nuevas.length };
  });
  // Lo que pasaste de una cuenta tuya a otra no es ni gasto ni ingreso (la otra mitad puede venir de otro banco)
  marcarTraspasos(bd, datos.hoy);
  return resultado;
}

/** Movimientos traídos del banco (Enable Banking): se reconocen por la referencia que da el propio banco. */
export function importarDelBanco(bd: BaseDatos, movimientos: readonly { idExterno: string; fecha: Fecha; importe: number; concepto: string }[], cuentaId: number, hoy: Fecha): number {
  if (!movimientos.length) return 0;
  const reglas = leerReglas(bd);
  const recurrentes = leerRecurrentes(bd);
  const usados = emparejadosEnBd(bd);
  const yaTraidos = new Set(bd.todos<{ hash_dedupe: string }>("SELECT hash_dedupe FROM apuntes WHERE origen = 'banco'").map((f) => f.hash_dedupe));
  const nuevos = bd.transaccion(() => {
    let nuevos = 0;
    for (const m of movimientos) {
      if (yaTraidos.has(`eb:${cuentaId}:${m.idExterno}`)) continue;
      const porRegla = categoriaPorReglas(m.concepto, reglas);
      const recurrente = coincidencia(m, recurrentes, usados, porRegla);
      const { cambios } = bd.ejecutar(
        "INSERT OR IGNORE INTO apuntes (fecha, importe, concepto, categoria_id, cuenta_id, recurrente_id, origen, id_externo, hash_dedupe) VALUES (?, ?, ?, ?, ?, ?, 'banco', ?, ?)",
        m.fecha,
        m.importe,
        m.concepto,
        porRegla ?? recurrente?.categoriaId ?? null,
        cuentaId,
        recurrente?.id ?? null,
        m.idExterno,
        `eb:${cuentaId}:${m.idExterno}`,
      );
      nuevos += cambios;
    }
    if (nuevos) bd.ejecutar("INSERT INTO importaciones (fecha, archivo, cuenta_id, filas, nuevas) VALUES (?, 'Enable Banking', ?, ?, ?)", hoy, cuentaId, movimientos.length, nuevos);
    return nuevos;
  });
  if (nuevos) marcarTraspasos(bd, hoy);
  return nuevos;
}

/** Formato guardado de un banco cuyo extracto tiene estos mismos títulos de columna. */
export function perfilPorFirma(bd: BaseDatos, firma: string): { nombre: string; configuracion: Configuracion } | null {
  const fila = bd.uno<{ nombre: string; configuracion: string }>("SELECT nombre, configuracion FROM perfiles_importacion WHERE firma = ?", firma);
  return fila ? { nombre: fila.nombre, configuracion: JSON.parse(fila.configuracion) as Configuracion } : null;
}
