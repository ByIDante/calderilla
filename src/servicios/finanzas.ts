import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { diasEntre, mesDe, primerDia, sumarMeses, ultimoDia, type Fecha, type Mes } from "../dominio/fechas.ts";
import {
  cuadroAmortizacion,
  cuotaFinalPendiente,
  cuotaMensual,
  cuotasRestantesPrestamo,
  finCuotas,
  interesesTotales,
  pendienteEn,
  taeDe,
  type Amortizacion,
  type Prestamo,
} from "../dominio/prestamo.ts";
import {
  cobrosEnMes,
  devengoAcumulado,
  estadoEn,
  importeEn,
  mensualEn,
  ocurrencias,
  pagasEnMes,
  provisionAcumulada,
  VECES_AL_ANIO,
  type Frecuencia,
  type PagaExtra,
  type Recurrente,
  type VersionImporte,
} from "../dominio/recurrencia.ts";
import type { Deuda } from "../reglas/deuda.ts";
import type { PrestamoFin } from "../reglas/tipos.ts";

export interface RecurrenteCompleto extends Recurrente {
  categoriaId: number | null;
  categoria: string | null;
  clase: "fijo" | "estimacion";
  nota: string | null;
  /** Palabras con las que se reconocen sus cargos en el banco (p. ej. «netflix»); null si no se sabe. */
  patron: string | null;
  versiones: VersionImporte[];
  prestamo: (Prestamo & { id: number }) | null;
  pagasExtra: PagaExtra[];
}

interface FilaRecurrente {
  id: number;
  tipo: "ingreso" | "gasto";
  nombre: string;
  categoria_id: number | null;
  categoria: string | null;
  frecuencia: Frecuencia;
  inicio: string;
  fin: string | null;
  esencial: number;
  clase: "fijo" | "estimacion";
  nota: string | null;
  patron: string | null;
}

interface FilaPrestamo {
  id: number;
  recurrente_id: number;
  capital: number;
  tin: number;
  tae: number | null;
  plazo_meses: number;
  primera_cuota: string;
  comision_amortizacion: number;
  vinculado: number;
  cuota_final: number;
}

export function leerRecurrentes(bd: BaseDatos, id?: number): RecurrenteCompleto[] {
  const filas = bd.todos<FilaRecurrente>(
    `SELECT r.*, c.nombre AS categoria FROM recurrentes r LEFT JOIN categorias c ON c.id = r.categoria_id ${id ? "WHERE r.id = ?" : ""} ORDER BY r.tipo DESC, r.nombre`,
    ...(id ? [id] : []),
  );
  const versiones = new Map<number, VersionImporte[]>();
  for (const v of bd.todos<{ recurrente_id: number; valido_desde: string; importe: number }>("SELECT recurrente_id, valido_desde, importe FROM recurrentes_importes ORDER BY valido_desde")) {
    versiones.set(v.recurrente_id, [...(versiones.get(v.recurrente_id) ?? []), { validoDesde: v.valido_desde, importe: v.importe }]);
  }
  const prestamos = new Map(bd.todos<FilaPrestamo>("SELECT * FROM prestamos").map((p) => [p.recurrente_id, p]));
  const pagas = new Map<number, PagaExtra[]>();
  for (const p of bd.todos<{ recurrente_id: number; nombre: string | null; meses: string; importe: number | null }>("SELECT recurrente_id, nombre, meses, importe FROM pagas_extra ORDER BY id")) {
    const paga = { nombre: p.nombre, meses: p.meses.split(",").map(Number), importe: p.importe };
    pagas.set(p.recurrente_id, [...(pagas.get(p.recurrente_id) ?? []), paga]);
  }
  const amortizaciones = new Map<number, Amortizacion[]>();
  for (const a of bd.todos<{ prestamo_id: number; fecha: string; importe: number; modo: Amortizacion["modo"] }>("SELECT prestamo_id, fecha, importe, modo FROM amortizaciones ORDER BY fecha")) {
    amortizaciones.set(a.prestamo_id, [...(amortizaciones.get(a.prestamo_id) ?? []), { fecha: a.fecha, importe: a.importe, modo: a.modo }]);
  }
  return filas.map((fila) => {
    const prestamo = prestamos.get(fila.id);
    return {
      id: fila.id,
      tipo: fila.tipo,
      nombre: fila.nombre,
      categoriaId: fila.categoria_id,
      categoria: fila.categoria,
      frecuencia: fila.frecuencia,
      inicio: fila.inicio,
      fin: fila.fin,
      esencial: fila.esencial === 1,
      clase: fila.clase,
      nota: fila.nota,
      patron: fila.patron,
      versiones: versiones.get(fila.id) ?? [],
      pagasExtra: pagas.get(fila.id) ?? [],
      prestamo: prestamo
        ? {
            id: prestamo.id,
            capital: prestamo.capital,
            tin: prestamo.tin,
            tae: prestamo.tae,
            plazoMeses: prestamo.plazo_meses,
            primeraCuota: prestamo.primera_cuota,
            comisionAmortizacion: prestamo.comision_amortizacion,
            vinculado: prestamo.vinculado === 1,
            cuotaFinal: prestamo.cuota_final,
            amortizaciones: amortizaciones.get(prestamo.id) ?? [],
          }
        : null,
    };
  });
}

export interface DatosRecurrente {
  tipo: "ingreso" | "gasto";
  nombre: string;
  categoriaId: number | null;
  frecuencia: Frecuencia;
  inicio: Fecha;
  fin: Fecha | null;
  esencial: boolean;
  clase: "fijo" | "estimacion";
  nota: string | null;
  importe: Centimos;
  prestamo: Omit<Prestamo, "primeraCuota"> | null;
  /** Si no se indica, al guardar se conserva el que tenga */
  patron?: string | null;
  /** Solo en ingresos. Si no se indica, al guardar se conservan las que tenga */
  pagasExtra?: PagaExtra[];
}

/**
 * Con préstamo, la fecha de fin y la cuota salen del préstamo (la cuota se puede corregir a mano). El gasto de
 * cada mes acaba con la última cuota normal: la cuota final se paga aparte (y cuenta como deuda hasta entonces).
 */
function normalizar(datos: DatosRecurrente, amortizaciones: readonly Amortizacion[] = []): DatosRecurrente {
  if (!datos.prestamo) return datos;
  const prestamo = { ...datos.prestamo, primeraCuota: datos.inicio, amortizaciones };
  return {
    ...datos,
    tipo: "gasto",
    frecuencia: "mensual",
    fin: finCuotas(prestamo),
    importe: datos.importe || cuotaMensual(prestamo.capital, prestamo.tin, prestamo.plazoMeses, prestamo.cuotaFinal ?? 0),
  };
}

/** Cambia las pagas extra de un ingreso por estas (sin ninguna, se quitan). */
export function guardarPagasExtra(bd: BaseDatos, recurrenteId: number, pagas: readonly PagaExtra[]) {
  bd.ejecutar("DELETE FROM pagas_extra WHERE recurrente_id = ?", recurrenteId);
  for (const paga of pagas) {
    bd.ejecutar("INSERT INTO pagas_extra (recurrente_id, nombre, meses, importe) VALUES (?, ?, ?, ?)", recurrenteId, paga.nombre, paga.meses.join(","), paga.importe);
  }
}

function guardarPagas(bd: BaseDatos, recurrenteId: number, datos: DatosRecurrente) {
  if (datos.pagasExtra === undefined) return;
  guardarPagasExtra(bd, recurrenteId, datos.tipo === "ingreso" ? datos.pagasExtra : []);
}

function guardarPrestamo(bd: BaseDatos, recurrenteId: number, datos: DatosRecurrente) {
  if (!datos.prestamo) {
    bd.ejecutar("DELETE FROM prestamos WHERE recurrente_id = ?", recurrenteId);
    return;
  }
  const p = datos.prestamo;
  bd.ejecutar(
    `INSERT INTO prestamos (recurrente_id, capital, tin, tae, plazo_meses, primera_cuota, comision_amortizacion, vinculado, cuota_final) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (recurrente_id) DO UPDATE SET capital = excluded.capital, tin = excluded.tin, tae = excluded.tae, plazo_meses = excluded.plazo_meses,
       primera_cuota = excluded.primera_cuota, comision_amortizacion = excluded.comision_amortizacion, vinculado = excluded.vinculado, cuota_final = excluded.cuota_final`,
    recurrenteId,
    p.capital,
    p.tin,
    p.tae,
    p.plazoMeses,
    datos.inicio,
    p.comisionAmortizacion,
    p.vinculado ? 1 : 0,
    p.cuotaFinal ?? 0,
  );
}

export function crearRecurrente(bd: BaseDatos, entrada: DatosRecurrente): number {
  const datos = normalizar(entrada);
  return bd.transaccion(() => {
    const { id } = bd.ejecutar(
      "INSERT INTO recurrentes (tipo, nombre, categoria_id, frecuencia, inicio, fin, esencial, clase, nota, patron) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      datos.tipo,
      datos.nombre,
      datos.categoriaId,
      datos.frecuencia,
      datos.inicio,
      datos.fin,
      datos.esencial ? 1 : 0,
      datos.clase,
      datos.nota,
      datos.patron || null,
    );
    bd.ejecutar("INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, ?, ?)", id, datos.inicio, datos.importe);
    guardarPrestamo(bd, id, datos);
    guardarPagas(bd, id, datos);
    return id;
  });
}

/**
 * Guarda los cambios. Si cambia el importe, se crea una versión nueva desde `desde`: los meses anteriores
 * conservan el importe que tenían. Si `desde` es anterior o igual al inicio, se corrige el importe original.
 */
export function actualizarRecurrente(bd: BaseDatos, id: number, entrada: DatosRecurrente, desde: Fecha) {
  const [actual] = leerRecurrentes(bd, id);
  if (!actual) throw new Error("No existe ese ingreso o gasto.");
  const datos = normalizar(entrada, actual.prestamo?.amortizaciones);
  bd.transaccion(() => {
    bd.ejecutar(
      "UPDATE recurrentes SET tipo = ?, nombre = ?, categoria_id = ?, frecuencia = ?, inicio = ?, fin = ?, esencial = ?, clase = ?, nota = ? WHERE id = ?",
      datos.tipo,
      datos.nombre,
      datos.categoriaId,
      datos.frecuencia,
      datos.inicio,
      datos.fin,
      datos.esencial ? 1 : 0,
      datos.clase,
      datos.nota,
      id,
    );
    if (datos.patron !== undefined) bd.ejecutar("UPDATE recurrentes SET patron = ? WHERE id = ?", datos.patron || null, id);
    if (importeEn(actual.versiones, desde) !== datos.importe) {
      if (desde <= datos.inicio) {
        bd.ejecutar("DELETE FROM recurrentes_importes WHERE recurrente_id = ? AND valido_desde <= ?", id, datos.inicio);
        bd.ejecutar("INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, ?, ?)", id, datos.inicio, datos.importe);
      } else {
        bd.ejecutar(
          "INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, ?, ?) ON CONFLICT (recurrente_id, valido_desde) DO UPDATE SET importe = excluded.importe",
          id,
          desde,
          datos.importe,
        );
      }
    }
    guardarPrestamo(bd, id, datos);
    // Un gasto no tiene pagas extra: si era un ingreso y pasa a gasto, se quitan
    guardarPagas(bd, id, datos.tipo === "gasto" ? { ...datos, pagasExtra: [] } : datos);
  });
}

/**
 * El préstamo tras un pago anticipado, sin guardar nada: su cuadro nuevo manda en la fecha de fin y, si se
 * reduce la cuota, en el importe desde la siguiente cuota. Lo usan `amortizar` y la Calculadora.
 */
export function conAmortizacion(r: RecurrenteCompleto, a: Amortizacion): RecurrenteCompleto {
  if (!r.prestamo) throw new Error("Ese gasto no es un préstamo.");
  const prestamo = { ...r.prestamo, amortizaciones: [...(r.prestamo.amortizaciones ?? []), a] };
  const siguiente = cuadroAmortizacion(prestamo).find((fila) => fila.fecha > a.fecha && fila.cuota > 0);
  const versiones =
    a.modo === "cuota" && siguiente ? [...r.versiones.filter((v) => v.validoDesde !== siguiente.fecha), { validoDesde: siguiente.fecha, importe: siguiente.cuota }] : r.versiones;
  return { ...r, prestamo, fin: finCuotas(prestamo), versiones };
}

/**
 * Pago anticipado de un préstamo. El préstamo manda: se recalcula su cuadro y, con él, la fecha de fin
 * del gasto y (si se reduce la cuota) el importe a partir de la siguiente cuota.
 */
export function amortizar(bd: BaseDatos, recurrenteId: number, a: Amortizacion): { interesesAntes: number; interesesDespues: number; fin: Fecha } {
  const [r] = leerRecurrentes(bd, recurrenteId);
  if (!r?.prestamo) throw new Error("Ese gasto no es un préstamo.");
  const despues = conAmortizacion(r, a);
  bd.transaccion(() => {
    bd.ejecutar("INSERT INTO amortizaciones (prestamo_id, fecha, importe, modo) VALUES (?, ?, ?, ?)", r.prestamo!.id, a.fecha, a.importe, a.modo);
    bd.ejecutar("UPDATE recurrentes SET fin = ? WHERE id = ?", despues.fin, recurrenteId);
    for (const version of despues.versiones.filter((v) => !r.versiones.includes(v))) {
      bd.ejecutar(
        "INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, ?, ?) ON CONFLICT (recurrente_id, valido_desde) DO UPDATE SET importe = excluded.importe",
        recurrenteId,
        version.validoDesde,
        version.importe,
      );
    }
  });
  return { interesesAntes: interesesTotales(r.prestamo), interesesDespues: interesesTotales(despues.prestamo!), fin: despues.fin! };
}

/** «Quitar»: deja de contar a partir de `fecha`, pero el historial se conserva. */
export function terminarRecurrente(bd: BaseDatos, id: number, fecha: Fecha) {
  bd.ejecutar("UPDATE recurrentes SET fin = ? WHERE id = ?", fecha, id);
}

/** Solo para errores al apuntar: borra el gasto y su historial. */
export function borrarRecurrente(bd: BaseDatos, id: number) {
  bd.transaccion(() => {
    bd.ejecutar("UPDATE apuntes SET recurrente_id = NULL WHERE recurrente_id = ?", id);
    bd.ejecutar("DELETE FROM recurrentes WHERE id = ?", id);
  });
}

export interface LineaPresupuesto {
  recurrente: RecurrenteCompleto;
  mensual: Centimos;
}

export interface PresupuestoMes {
  ingresos: Centimos;
  esenciales: Centimos;
  noEsenciales: Centimos;
  lineas: LineaPresupuesto[];
}

/** Ingresos y gastos de un mes, con los no mensuales repartidos. */
export function presupuestoMes(recurrentes: readonly RecurrenteCompleto[], mes: Mes): PresupuestoMes {
  const lineas = recurrentes.map((recurrente) => ({ recurrente, mensual: mensualEn(recurrente, recurrente.versiones, mes) })).filter((linea) => linea.mensual > 0);
  const suma = (filtro: (r: RecurrenteCompleto) => boolean) => lineas.filter((l) => filtro(l.recurrente)).reduce((total, l) => total + l.mensual, 0);
  return {
    ingresos: suma((r) => r.tipo === "ingreso"),
    esenciales: suma((r) => r.tipo === "gasto" && r.esencial),
    noEsenciales: suma((r) => r.tipo === "gasto" && !r.esencial),
    lineas,
  };
}

export function provisiones(recurrentes: readonly RecurrenteCompleto[], fecha: Fecha): Centimos {
  return recurrentes.reduce((suma, r) => suma + provisionAcumulada(r, r.versiones, fecha), 0);
}

/**
 * Lo que cobras de verdad en un mes frente a lo que cuenta tu presupuesto (que reparte las pagas extra y los
 * meses con un cobro de más), y por qué cambia: «Paga extra de Nómina», «3 cobros de Nómina».
 */
export function ingresosDelMes(recurrentes: readonly RecurrenteCompleto[], mes: Mes): { mes: Mes; real: Centimos; presupuesto: Centimos; notas: string[] } {
  const ingresos = recurrentes.filter((r) => r.tipo === "ingreso");
  const notas: string[] = [];
  for (const r of ingresos) {
    for (const paga of pagasEnMes(r, r.versiones, mes)) notas.push(paga.nombre ? `Paga extra «${paga.nombre}» de ${r.nombre}` : `Paga extra de ${r.nombre}`);
    const veces = ocurrencias(r, primerDia(mes), ultimoDia(mes)).length;
    if (veces > Math.max(1, Math.floor(VECES_AL_ANIO[r.frecuencia] / 12))) notas.push(`${veces} cobros de ${r.nombre}`);
  }
  return {
    mes,
    real: ingresos.reduce((suma, r) => suma + cobrosEnMes(r, r.versiones, mes), 0),
    presupuesto: ingresos.reduce((suma, r) => suma + mensualEn(r, r.versiones, mes), 0),
    notas,
  };
}

/** Lo ganado y aún no cobrado de las pagas extra y los ingresos no mensuales (ver `devengoAcumulado`). */
export function devengos(recurrentes: readonly RecurrenteCompleto[], fecha: Fecha): Centimos {
  return recurrentes.reduce((suma, r) => suma + devengoAcumulado(r, r.versiones, fecha), 0);
}

export function deudas(recurrentes: readonly RecurrenteCompleto[], fecha: Fecha): Deuda[] {
  return recurrentes
    // Tras la última cuota normal, la cuota final sigue siendo deuda hasta que se paga
    .filter((r) => r.prestamo && (estadoEn(r, fecha) !== "finalizado" || cuotaFinalPendiente(r.prestamo, fecha)))
    .map((r) => {
      const prestamo = r.prestamo!;
      return {
        cuotaFinal: cuotaFinalPendiente(prestamo, fecha),
        nombre: r.nombre,
        pendiente: pendienteEn(prestamo, fecha),
        tae: taeDe(prestamo),
        cuota: importeEn(r.versiones, fecha),
        mesesRestantes: cuotasRestantesPrestamo(prestamo, fecha),
        comision: prestamo.comisionAmortizacion,
        vinculado: prestamo.vinculado,
      };
    })
    .filter((deuda) => deuda.pendiente > 0);
}

/** Préstamos (y gastos con fin) terminados en los últimos 12 meses y los que terminan en los próximos 12. */
export function finesProximos(recurrentes: readonly RecurrenteCompleto[], fecha: Fecha): { terminados: PrestamoFin[]; porTerminar: PrestamoFin[] } {
  const conFin = recurrentes.filter((r) => r.tipo === "gasto" && r.prestamo && r.fin);
  const aFin = (r: RecurrenteCompleto): PrestamoFin => ({ nombre: r.nombre, cuota: importeEn(r.versiones, r.fin!), fin: r.fin! });
  return {
    // El mes del último cargo aún cuenta como «por terminar»: la cuota sigue en los gastos de ese mes
    terminados: conFin.filter((r) => mesDe(r.fin!) < mesDe(fecha) && diasEntre(r.fin!, fecha) <= 366).map(aFin),
    porTerminar: conFin.filter((r) => mesDe(r.fin!) >= mesDe(fecha) && r.fin! <= sumarMeses(fecha, 12)).map(aFin),
  };
}
