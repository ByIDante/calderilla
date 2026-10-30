import type { Hono } from "hono";
import { mesDe, nombreMes, nombreMesCorto, sumarDias, sumarMesesAMes } from "../../dominio/fechas.ts";
import { importeEn, ocurrencias } from "../../dominio/recurrencia.ts";
import { avisosPresupuesto, presupuestoPorCategoria } from "../../servicios/presupuesto.ts";
import { contexto } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { vistaResumen } from "../vistas/resumen.ts";

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
    const ctx = contexto(base, hoy);
    const mes = mesDe(hoy);

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
      }),
    );
  });
}
