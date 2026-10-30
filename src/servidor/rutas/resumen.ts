import type { Context, Hono } from "hono";
import { mesDe, nombreMes, nombreMesCorto, primerDia, sumarDias, sumarMesesAMes, ultimoDia } from "../../dominio/fechas.ts";
import { importeEn, ocurrencias } from "../../dominio/recurrencia.ts";
import { NOMBRE_ETAPA, type Etapa } from "../../reglas/tipos.ts";
import { leerAportaciones, totalMensual } from "../../servicios/aportaciones.ts";
import { leerRecurrentes, presupuestoMes } from "../../servicios/finanzas.ts";
import { avisosPresupuesto, gastoPorCategoriaMeses, presupuestoPorCategoria } from "../../servicios/presupuesto.ts";
import { contexto, ocioGastadoEn } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { vistaMesPasado, vistaResumen } from "../vistas/resumen.ts";

export function rutasResumen(app: Hono, estado: Estado) {
  app.post("/avisos/ocultar", async (c) => {
    const clave = (await Formulario.de(c)).texto("clave");
    if (/^[0-9a-f]{16}$/.test(clave)) {
      const base = bd(estado);
      base.ejecutar("INSERT OR REPLACE INTO avisos_ocultos (clave, ocultado) VALUES (?, ?)", clave, estado.hoy());
      // Los cerrados hace más de medio año ya no hace falta recordarlos
      base.ejecutar("DELETE FROM avisos_ocultos WHERE ocultado < ?", sumarDias(estado.hoy(), -180));
    }
    return redirigir(c, "/");
  });

  app.get("/", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const mes = mesDe(hoy);
    const pedido = c.req.query("mes") ?? "";
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) && pedido < mes) return mesPasado(c, estado, pedido);
    const ctx = contexto(base, hoy);

    const cierres = base
      .todos<{ mes: string; ahorro_plan: number; ahorro_real: number | null; patrimonio: number; resumen: string | null }>(
        "SELECT mes, ahorro_plan, ahorro_real, patrimonio, resumen FROM cierres_mes ORDER BY mes DESC LIMIT 12",
      )
      .reverse();
    const mesAnterior = sumarMesesAMes(mes, -1);
    // Solo se pide cerrar meses en los que ya usabas la app (desde el primer saldo apuntado)
    const primerSaldo = base.uno<{ fecha: string | null }>("SELECT min(fecha) AS fecha FROM saldos")?.fecha ?? null;
    const empezado = primerSaldo !== null && mesAnterior >= mesDe(primerSaldo);
    const cierrePendiente = empezado && !base.uno("SELECT 1 FROM cierres_mes WHERE mes = ?", mesAnterior) ? mesAnterior : null;
    const presupuesto = presupuestoPorCategoria(base, mes, hoy);
    ctx.resultado.avisos.push(...avisosPresupuesto(presupuesto));
    const ocultos = new Set(base.todos<{ clave: string }>("SELECT clave FROM avisos_ocultos").map((f) => f.clave));

    const proximos = ctx.recurrentes
      .filter((r) => r.frecuencia !== "mensual" && r.tipo === "gasto")
      .flatMap((r) => ocurrencias(r, hoy, sumarDias(hoy, 90)).map((fecha) => ({ nombre: r.nombre, fecha, importe: importeEn(r.versiones, fecha) })))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const porCategoria = new Map<string, number>();
    for (const linea of ctx.presupuesto.lineas.filter((l) => l.recurrente.tipo === "gasto")) {
      const nombre = linea.recurrente.categoria ?? "Sin categoría";
      porCategoria.set(nombre, (porCategoria.get(nombre) ?? 0) + linea.mensual);
    }

    return render(
      c,
      estado,
      { titulo: `Resumen de ${nombreMes(mes)}`, seccion: "resumen" },
      vistaResumen({
        ctx,
        cierrePendiente,
        ocultos,
        presupuesto,
        proximos,
        cierres: cierres.map((cierre) => ({
          etiqueta: nombreMesCorto(cierre.mes),
          plan: cierre.ahorro_plan,
          real: cierre.ahorro_real,
          // Valor de mercado si se guardó; si no, a precio de compra
          patrimonio: (JSON.parse(cierre.resumen ?? "{}") as { patrimonioMercado?: number }).patrimonioMercado ?? cierre.patrimonio,
        })),
        porCategoria: [...porCategoria].sort((a, b) => b[1] - a[1]),
        gastoMeses: gastoPorCategoriaMeses(base, mes),
        automatico: totalMensual(leerAportaciones(base), mes),
        ultimoCierre: cierres.length ? { mes: cierres.at(-1)!.mes, plan: cierres.at(-1)!.ahorro_plan, real: cierres.at(-1)!.ahorro_real } : null,
      }),
    );
  });
}

/** Cómo fue un mes ya pasado: lo previsto, lo que dijo su cierre y lo que se gastó según los movimientos. */
function mesPasado(c: Context, estado: Estado, mes: string) {
  const base = bd(estado);
  const recurrentes = leerRecurrentes(base);
  const plan = presupuestoMes(recurrentes, mes);
  const cierre = base.uno<{ ahorro_plan: number; ahorro_real: number | null; ocio_plan: number; ocio_gastado: number; etapa: Etapa; patrimonio: number; resumen: string | null }>(
    "SELECT ahorro_plan, ahorro_real, ocio_plan, ocio_gastado, etapa, patrimonio, resumen FROM cierres_mes WHERE mes = ?",
    mes,
  );
  const gastos = base.todos<{ categoria: string | null; total: number }>(
    `SELECT c.nombre AS categoria, -sum(a.importe) AS total FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id
     WHERE a.importe < 0 AND a.fecha BETWEEN ? AND ? GROUP BY c.nombre ORDER BY total DESC`,
    primerDia(mes),
    ultimoDia(mes),
  );
  return render(
    c,
    estado,
    { titulo: `Así fue ${nombreMes(mes)}`, seccion: "resumen" },
    vistaMesPasado({
      mes,
      plan,
      cierre: cierre
        ? {
            ...cierre,
            etapa: NOMBRE_ETAPA[cierre.etapa] ?? cierre.etapa,
            patrimonio: (JSON.parse(cierre.resumen ?? "{}") as { patrimonioMercado?: number }).patrimonioMercado ?? cierre.patrimonio,
          }
        : null,
      ocioGastado: ocioGastadoEn(base, ultimoDia(mes)),
      gastos: gastos.map((g) => [g.categoria ?? "Sin categoría", g.total] as [string, number]),
      hoy: estado.hoy(),
    }),
  );
}
