import type { BaseDatos } from "../datos/db.ts";
import { eurosRedondos as eur } from "../dominio/dinero.ts";
import { formatoFecha, mesDe, primerDia, sumarDias, sumarMesesAMes, type Fecha, type Mes } from "../dominio/fechas.ts";
import { estadoEn, importeEn, NOMBRE_FRECUENCIA, ocurrencias } from "../dominio/recurrencia.ts";
import { casaPatron } from "../importar/periodicos.ts";
import type { Aviso } from "../reglas/tipos.ts";
import { leerPerfil } from "./configuracion.ts";
import type { RecurrenteCompleto } from "./finanzas.ts";

/*
 * Cosas de tus datos que suelen ser un error al apuntar y que cambian mucho las cifras: un gasto apuntado dos
 * veces, o un gasto fijo que empieza más tarde que sus cargos en el banco. Solo avisa: tú decides.
 */

/**
 * Dos gastos (o ingresos) fijos con el mismo importe y frecuencia: ¿son el mismo? Las estimaciones no cuentan, y
 * con categorías distintas (el gimnasio y el móvil a 30 €) tampoco.
 */
function duplicados(recurrentes: readonly RecurrenteCompleto[], hoy: Fecha): Aviso[] {
  const vivos = recurrentes.filter((r) => estadoEn(r, hoy) !== "finalizado" && r.clase === "fijo" && !r.prestamo);
  const avisos: Aviso[] = [];
  vivos.forEach((a, i) => {
    for (const b of vivos.slice(i + 1)) {
      const [x, y] = [importeEn(a.versiones, hoy), importeEn(b.versiones, hoy)];
      if (a.tipo !== b.tipo || a.frecuencia !== b.frecuencia || Math.min(x, y) < 1000 || Math.abs(x - y) > Math.max(x, y) * 0.01) continue;
      if (a.categoriaId !== null && b.categoriaId !== null && a.categoriaId !== b.categoriaId) continue;
      avisos.push({
        nivel: "atencion",
        texto: `«${a.nombre}» y «${b.nombre}» cuestan lo mismo (${eur(x)} ${NOMBRE_FRECUENCIA[a.frecuencia]}): ¿son el mismo? Si lo son, quita uno para no contarlo dos veces.`,
        enlace: { ruta: `/gastos/${b.id}`, texto: `Revisar «${b.nombre}»` },
      });
    }
  });
  return avisos;
}

/**
 * Un fijo cuyos cargos en el banco empiezan bastante antes que él (más de 10 días): los meses de antes no lo
 * cuentan, ni en el presupuesto ni en sus cierres. Se miran sus movimientos unidos y los que llevan su texto.
 */
function empiezanTarde(bd: BaseDatos, recurrentes: readonly RecurrenteCompleto[], hoy: Fecha): Aviso[] {
  const avisos: Aviso[] = [];
  const sueltos = bd.todos<{ fecha: string; importe: number; concepto: string }>(
    "SELECT fecha, importe, concepto FROM apuntes WHERE recurrente_id IS NULL AND coalesce(traspaso, 0) = 0 ORDER BY fecha",
  );
  for (const r of recurrentes.filter((x) => estadoEn(x, hoy) !== "finalizado")) {
    const unido = bd.uno<{ fecha: string | null }>("SELECT min(fecha) AS fecha FROM apuntes WHERE recurrente_id = ?", r.id)?.fecha ?? null;
    const conTexto = r.patron ? sueltos.find((a) => (a.importe > 0) === (r.tipo === "ingreso") && casaPatron(r.patron!, a.concepto))?.fecha : undefined;
    const primero = [unido, conTexto].filter((f): f is string => Boolean(f)).sort()[0];
    if (!primero || primero >= sumarDias(r.inicio, -10)) continue;
    avisos.push({
      nivel: "info",
      texto: `«${r.nombre}» tiene movimientos en el banco desde el ${formatoFecha(primero)}, pero en tu presupuesto empieza el ${formatoFecha(r.inicio)}: los meses de antes no lo cuentan.`,
      enlace: { ruta: `/gastos/${r.id}`, texto: "Cambiar la fecha" },
    });
  }
  return avisos;
}

/**
 * Lo prudente de un ingreso que varía (autónomo, comisiones): lo que cobraste en un mes flojo, el segundo más
 * bajo de los últimos 6 meses completos con cobros unidos a él. Si cobras más, sobra; rara vez falta. Hacen
 * falta al menos 3 meses; con 3 o 4, el más bajo.
 */
export function ingresoPrudente(bd: BaseDatos, r: RecurrenteCompleto, hoy: Fecha): { importe: number; meses: { mes: Mes; total: number }[] } | null {
  const hasta = sumarMesesAMes(mesDe(hoy), -1);
  const meses = bd.todos<{ mes: string; total: number }>(
    "SELECT substr(fecha, 1, 7) AS mes, sum(importe) AS total FROM apuntes WHERE recurrente_id = ? AND importe > 0 AND fecha BETWEEN ? AND ? GROUP BY mes ORDER BY mes",
    r.id,
    primerDia(sumarMesesAMes(hasta, -5)),
    `${hasta}-31`,
  );
  if (meses.length < 3) return null;
  const orden = meses.map((m) => m.total).sort((a, b) => a - b);
  return { importe: meses.length >= 5 ? orden[1]! : orden[0]!, meses };
}

/** Ingresos que varían: si lo apuntado se aleja de lo prudente, y si tu perfil aún dice que tus ingresos son estables. */
function variables(bd: BaseDatos, recurrentes: readonly RecurrenteCompleto[], hoy: Fecha): Aviso[] {
  const lista = recurrentes.filter((r) => r.tipo === "ingreso" && r.clase === "estimacion" && estadoEn(r, hoy) !== "finalizado");
  const avisos: Aviso[] = [];
  for (const r of lista) {
    const prudente = ingresoPrudente(bd, r, hoy);
    const apuntado = importeEn(r.versiones, hoy);
    if (prudente && Math.abs(prudente.importe - apuntado) > Math.max(prudente.importe, apuntado) * 0.1) {
      avisos.push({
        nivel: "info",
        texto: `«${r.nombre}» varía: con tus últimos meses, lo prudente es ${eur(prudente.importe)} (un mes flojo) y tienes apuntados ${eur(apuntado)}.`,
        enlace: { ruta: `/gastos/${r.id}`, texto: "Revisarlo" },
      });
    }
  }
  if (lista.length && leerPerfil(bd).estabilidad !== "inestable") {
    avisos.push({
      nivel: "info",
      texto: `Tienes ingresos que varían («${lista.map((r) => r.nombre).join("», «")}»): marca en tu perfil que tus ingresos son inestables, para que el fondo de emergencia te cubra más meses.`,
      enlace: { ruta: "/ajustes", texto: "Ir a tu perfil" },
    });
  }
  return avisos;
}

/** Todo lo que conviene revisar de tus datos. */
export function revisarDatos(bd: BaseDatos, recurrentes: readonly RecurrenteCompleto[], hoy: Fecha): Aviso[] {
  return [...duplicados(recurrentes, hoy), ...empiezanTarde(bd, recurrentes, hoy), ...variables(bd, recurrentes, hoy)];
}

/**
 * Al cerrar un mes: los ingresos fijos que llegan el último día o el anterior, para poner el saldo de después
 * de cobrarlos. Se miran los cobros del banco unidos a cada ingreso y, si ese mes aún no está importado, el día
 * previsto (la nómina no siempre llega el mismo día).
 */
export function cobrosAlCerrar(bd: BaseDatos, recurrentes: readonly RecurrenteCompleto[], ultimoDia: Fecha): { nombre: string; fecha: Fecha; importe: number }[] {
  const desde = sumarDias(ultimoDia, -1);
  const cobros: { nombre: string; fecha: Fecha; importe: number }[] = [];
  for (const r of recurrentes.filter((x) => x.tipo === "ingreso")) {
    const reales = bd.todos<{ fecha: string; importe: number }>(
      "SELECT fecha, importe FROM apuntes WHERE recurrente_id = ? AND importe > 0 AND fecha BETWEEN ? AND ?",
      r.id,
      `${ultimoDia.slice(0, 8)}01`,
      ultimoDia,
    );
    if (reales.length) cobros.push(...reales.filter((a) => a.fecha >= desde).map((a) => ({ nombre: r.nombre, fecha: a.fecha, importe: a.importe })));
    else cobros.push(...ocurrencias(r, desde, ultimoDia).map((fecha) => ({ nombre: r.nombre, fecha, importe: importeEn(r.versiones, fecha) })));
  }
  return cobros;
}
