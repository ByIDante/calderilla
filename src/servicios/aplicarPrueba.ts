import type { BaseDatos } from "../datos/db.ts";
import { euros as eur } from "../dominio/dinero.ts";
import { formatoFecha, type Fecha } from "../dominio/fechas.ts";
import { ETIQUETA_FRECUENCIA, NOMBRE_FRECUENCIA } from "../dominio/recurrencia.ts";
import { PARAMETROS } from "../reglas/parametros.ts";
import { importeDelMes, type Base, type Prueba } from "./calculadora.ts";
import { guardarParametros } from "./configuracion.ts";
import { actualizarRecurrente, amortizar, crearRecurrente, terminarRecurrente, type RecurrenteCompleto } from "./finanzas.ts";

/*
 * «Aplicar estos cambios de verdad»: lo que has probado en la Calculadora, convertido en cambios de tus datos.
 * Cada cambio se marca por separado. Lo que no es una decisión sino un hecho (el dinero de tus cuentas, lo que
 * llevas gastado en ocio) no se aplica: eso lo dicen tus saldos y tus movimientos.
 */

export interface CambioAplicable {
  clave: string;
  texto: string;
  /** Se puede aplicar desde aquí */
  aplicable: boolean;
  /** Viene marcado (un adelanto de préstamo no: solo si ya lo has pagado) */
  marcado: boolean;
  nota?: string;
  /** Dónde se cambia lo que no se aplica desde aquí */
  enlace?: { ruta: string; texto: string };
}

export function cambiosAplicables(bd: BaseDatos, base: Base, prueba: Prueba): CambioAplicable[] {
  const r = (id: number) => base.recurrentes.find((x) => x.id === id)!;
  const conCuenta = new Set(bd.todos<{ id: number }>("SELECT id FROM metas WHERE cuenta_id IS NOT NULL").map((m) => m.id));
  const cambios: CambioAplicable[] = [];
  for (const [id, importe] of prueba.importes) {
    const x = r(id);
    cambios.push(
      x.prestamo
        ? { clave: `importe:${id}`, texto: `«${x.nombre}»: cuota de ${eur(importe)}`, aplicable: false, marcado: false, nota: "La cuota de un préstamo sale de sus datos.", enlace: { ruta: `/gastos/${id}`, texto: "Cambiar el préstamo" } }
        : {
            clave: `importe:${id}`,
            texto: `«${x.nombre}»: de ${eur(importeDelMes(x, base.hoy))} a ${eur(importe)} ${NOMBRE_FRECUENCIA[x.frecuencia]}, desde hoy`,
            aplicable: true,
            marcado: true,
            nota: "Los meses anteriores conservan su importe.",
          },
    );
  }
  for (const id of prueba.quitados) cambios.push({ clave: `quitar:${id}`, texto: `«${r(id).nombre}»: deja de contar desde hoy`, aplicable: true, marcado: true, nota: "Su historial se conserva." });
  for (const n of prueba.nuevos) {
    const que = n.tipo === "ingreso" ? "Nuevo ingreso" : n.esencial ? "Nuevo gasto esencial" : "Nuevo gasto no esencial";
    cambios.push({ clave: `nuevo:${n.fila}`, texto: `${que} «${n.nombre}»: ${eur(n.importe)} (${ETIQUETA_FRECUENCIA[n.frecuencia].toLowerCase()}), desde hoy`, aplicable: true, marcado: true });
  }
  for (const [id, cambio] of prueba.metas) {
    const meta = base.situacion.metas.find((m) => m.id === id)!;
    // Si va unida a una cuenta, lo ahorrado es el saldo de esa cuenta: no se cambia a mano
    const ahorrado = cambio.ahorrado !== undefined && !conCuenta.has(id);
    const partes = [
      cambio.objetivo === undefined ? null : `objetivo ${eur(cambio.objetivo)}`,
      ahorrado ? `ahorrado ${eur(cambio.ahorrado!)}` : null,
      cambio.fecha === undefined ? null : `para el ${formatoFecha(cambio.fecha)}`,
    ].filter(Boolean);
    const nota = cambio.ahorrado !== undefined && !ahorrado ? "Lo ahorrado sale del saldo de su cuenta: eso no se cambia aquí." : undefined;
    cambios.push(
      partes.length
        ? { clave: `meta:${id}`, texto: `Meta «${meta.nombre}»: ${partes.join(", ")}`, aplicable: true, marcado: true, nota }
        : { clave: `meta:${id}`, texto: `Meta «${meta.nombre}»: ahorrado ${eur(cambio.ahorrado!)}`, aplicable: false, marcado: false, nota },
    );
  }
  for (const id of prueba.metasQuitadas) {
    const meta = base.situacion.metas.find((m) => m.id === id)!;
    cambios.push({ clave: `quitar-meta:${id}`, texto: `Borrar la meta «${meta.nombre}»`, aplicable: true, marcado: false, nota: "Se borra del todo: márcalo solo si ya no la quieres." });
  }
  if (prueba.metaNueva) {
    const m = prueba.metaNueva;
    cambios.push({ clave: "meta-nueva", texto: `Nueva meta «${m.nombre}»: ${eur(m.objetivo)} para el ${formatoFecha(m.fecha)}`, aplicable: true, marcado: true });
  }
  for (const [clave, valor] of Object.entries(prueba.parametros)) {
    const def = PARAMETROS[clave as keyof typeof PARAMETROS];
    cambios.push({ clave: `parametro:${clave}`, texto: `Regla «${def.etiqueta}»: ${valor} ${def.unidad} (ahora ${base.parametros[clave as keyof typeof PARAMETROS]})`, aplicable: true, marcado: true });
  }
  for (const [id, a] of prueba.adelantos) {
    cambios.push({
      clave: `adelanto:${id}`,
      texto: `Apuntar que has adelantado ${eur(a.importe)} de «${r(id).nombre}» hoy, ${a.modo === "plazo" ? "para acabar antes" : "para pagar menos al mes"}`,
      aplicable: true,
      marcado: false,
      nota: "Márcalo solo si ya lo has pagado de verdad.",
    });
  }
  if (prueba.liquidez !== null) {
    cambios.push({ clave: "liquidez", texto: `Dinero en tus cuentas: ${eur(prueba.liquidez)}`, aplicable: false, marcado: false, nota: "Eso lo dicen tus saldos.", enlace: { ruta: "/cuentas", texto: "Actualizar los saldos" } });
  }
  if (prueba.ocioGastado !== null) {
    cambios.push({ clave: "ocio", texto: `Ya gastado en ocio: ${eur(prueba.ocioGastado)}`, aplicable: false, marcado: false, nota: "Eso lo dicen tus movimientos.", enlace: { ruta: "/ocio", texto: "Ver el ocio" } });
  }
  if (prueba.ahorroAutomatico !== null) {
    cambios.push({
      clave: "automatico",
      texto: `Ahorro automático: ${eur(prueba.ahorroAutomatico)} al mes`,
      aplicable: false,
      marcado: false,
      nota: "Cámbialo también en tu banco.",
      enlace: { ruta: "/cuentas#ahorro-automatico", texto: "Cambiar el ahorro automático" },
    });
  }
  return cambios;
}

/** Los datos de un ingreso o gasto para guardarlo con otro importe (sin tocar su préstamo, patrón ni pagas extra) */
function datosDe(r: RecurrenteCompleto, importe: number) {
  return { tipo: r.tipo, nombre: r.nombre, categoriaId: r.categoriaId, frecuencia: r.frecuencia, inicio: r.inicio, fin: r.fin, esencial: r.esencial, clase: r.clase, nota: r.nota, importe, prestamo: null };
}

/** Aplica los cambios elegidos (de los que se pueden aplicar). Devuelve cuántos. */
export function aplicarPrueba(bd: BaseDatos, base: Base, prueba: Prueba, elegidos: ReadonlySet<string>, hoy: Fecha): number {
  const validos = new Set(cambiosAplicables(bd, base, prueba).filter((c) => c.aplicable && elegidos.has(c.clave)).map((c) => c.clave));
  const r = (id: number) => base.recurrentes.find((x) => x.id === id)!;
  return bd.transaccion(() => {
    for (const [id, importe] of prueba.importes) if (validos.has(`importe:${id}`)) actualizarRecurrente(bd, id, datosDe(r(id), importe), hoy);
    for (const id of prueba.quitados) if (validos.has(`quitar:${id}`)) terminarRecurrente(bd, id, hoy);
    for (const n of prueba.nuevos) {
      if (!validos.has(`nuevo:${n.fila}`)) continue;
      crearRecurrente(bd, {
        tipo: n.tipo,
        nombre: n.nombre,
        categoriaId: null,
        frecuencia: n.frecuencia,
        inicio: hoy,
        fin: null,
        esencial: n.esencial,
        clase: "fijo",
        nota: "Creado desde la Calculadora.",
        importe: n.importe,
        prestamo: null,
      });
    }
    for (const [id, cambio] of prueba.metas) {
      if (!validos.has(`meta:${id}`)) continue;
      if (cambio.objetivo !== undefined) bd.ejecutar("UPDATE metas SET objetivo = ? WHERE id = ?", cambio.objetivo, id);
      if (cambio.fecha !== undefined) bd.ejecutar("UPDATE metas SET fecha = ? WHERE id = ?", cambio.fecha, id);
      if (cambio.ahorrado !== undefined) bd.ejecutar("UPDATE metas SET ahorrado = ? WHERE id = ? AND cuenta_id IS NULL", cambio.ahorrado, id);
    }
    for (const id of prueba.metasQuitadas) if (validos.has(`quitar-meta:${id}`)) bd.ejecutar("DELETE FROM metas WHERE id = ?", id);
    if (prueba.metaNueva && validos.has("meta-nueva")) {
      const m = prueba.metaNueva;
      bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES (?, ?, ?, ?)", m.nombre, m.objetivo, m.fecha, m.ahorrado);
    }
    const parametros = Object.fromEntries(Object.entries(prueba.parametros).filter(([clave]) => validos.has(`parametro:${clave}`)));
    if (Object.keys(parametros).length) guardarParametros(bd, parametros);
    for (const [id, a] of prueba.adelantos) if (validos.has(`adelanto:${id}`)) amortizar(bd, id, { fecha: hoy, importe: a.importe, modo: a.modo });
    return validos.size;
  });
}
