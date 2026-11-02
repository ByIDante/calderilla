import type { Context, Hono } from "hono";
import { importeEditable, numeroEditable } from "../../dominio/dinero.ts";
import { mesDe } from "../../dominio/fechas.ts";
import { FRECUENCIAS } from "../../dominio/recurrencia.ts";
import { leerAportaciones, totalMensual } from "../../servicios/aportaciones.ts";
import { importeDelMes, PARAMETROS_PRUEBA, simular, sinCambios, type Base, type CambioMeta, type ParametroPrueba, type Prueba } from "../../servicios/calculadora.ts";
import { construir } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario } from "../formulario.ts";
import { resultadoCalculadora, vistaCalculadora, type DatosCalculadora } from "../vistas/calculadora.ts";

/** Hasta cuánto tiene sentido cada regla: los «de cada 100 €» no pasan de 100; los meses del fondo, de 5 años */
const MAXIMO: Record<ParametroPrueba, number> = {
  proporcionColchon: 100,
  proporcionDeuda: 100,
  proporcionFondo: 100,
  proporcionMetas: 100,
  proporcionInvertir: 100,
  ocioMinimoPct: 100,
  ocioMinimoEur: 1_000_000,
  fondoMesesEstable: 60,
  fondoMesesNormal: 60,
  fondoMesesInestable: 60,
  colchonMinimo: 10_000_000,
};

/**
 * Los cambios que has escrito en la Calculadora. Un campo vacío o con el valor de verdad no cuenta como
 * cambio, así que sin tocar nada la prueba es idéntica a tus números.
 */
export function leerPrueba(f: Formulario, base: Base): Prueba {
  const prueba = sinCambios();
  for (const { recurrente: r } of base.presupuesto.lineas) {
    if (f.casilla(`quitar_${r.id}`)) {
      prueba.quitados.add(r.id);
      continue;
    }
    const importe = f.importe(`importe_${r.id}`);
    if (importe !== null && importe >= 0 && importe !== importeDelMes(r, base.hoy)) prueba.importes.set(r.id, importe);
  }
  for (const n of [1, 2, 3]) {
    const importe = f.importe(`nuevo_importe_${n}`);
    if (!importe || importe <= 0) continue;
    const tipo = f.texto(`nuevo_tipo_${n}`);
    prueba.nuevos.push({
      fila: n,
      tipo: tipo === "ingreso" ? "ingreso" : "gasto",
      esencial: tipo === "esencial",
      nombre: f.texto(`nuevo_nombre_${n}`) || `Prueba ${n}`,
      importe,
      frecuencia: FRECUENCIAS.find((x) => x === f.texto(`nuevo_frecuencia_${n}`)) ?? "mensual",
    });
  }
  const liquidez = f.importe("liquidez");
  if (liquidez !== null && liquidez !== base.situacion.liquidez) prueba.liquidez = liquidez;
  const ocioGastado = f.importe("ocio_gastado");
  if (ocioGastado !== null && ocioGastado >= 0 && ocioGastado !== base.situacion.ocioGastado) prueba.ocioGastado = ocioGastado;

  for (const meta of base.situacion.metas) {
    if (meta.id === undefined) continue;
    if (f.casilla(`quitar_meta_${meta.id}`)) {
      prueba.metasQuitadas.add(meta.id);
      continue;
    }
    const cambio: CambioMeta = {};
    const objetivo = f.importe(`meta_objetivo_${meta.id}`);
    if (objetivo !== null && objetivo > 0 && objetivo !== meta.objetivo) cambio.objetivo = objetivo;
    const ahorrado = f.importe(`meta_ahorrado_${meta.id}`);
    if (ahorrado !== null && ahorrado >= 0 && ahorrado !== meta.ahorrado) cambio.ahorrado = ahorrado;
    const fecha = f.fecha(`meta_fecha_${meta.id}`);
    if (fecha && fecha !== meta.fecha) cambio.fecha = fecha;
    if (Object.keys(cambio).length) prueba.metas.set(meta.id, cambio);
  }
  const objetivo = f.importe("meta_nueva_objetivo");
  const fecha = f.fecha("meta_nueva_fecha");
  if (objetivo && objetivo > 0 && fecha) {
    prueba.metaNueva = { nombre: f.texto("meta_nueva_nombre") || "Meta de prueba", objetivo, ahorrado: Math.max(f.importe("meta_nueva_ahorrado") ?? 0, 0), fecha };
  }

  for (const clave of PARAMETROS_PRUEBA) {
    const valor = f.numero(`p_${clave}`);
    if (valor !== null && valor >= 0 && valor <= MAXIMO[clave] && valor !== base.parametros[clave]) prueba.parametros[clave] = valor;
  }
  return prueba;
}

/** Lo que sale en cada campo al abrir la Calculadora: tus números de verdad */
function valoresReales(base: Base): Record<string, string> {
  const valores: Record<string, string> = {
    liquidez: importeEditable(base.situacion.liquidez),
    ocio_gastado: importeEditable(base.situacion.ocioGastado),
  };
  for (const { recurrente: r } of base.presupuesto.lineas) valores[`importe_${r.id}`] = importeEditable(importeDelMes(r, base.hoy));
  for (const meta of base.situacion.metas) {
    valores[`meta_objetivo_${meta.id}`] = importeEditable(meta.objetivo);
    valores[`meta_ahorrado_${meta.id}`] = importeEditable(meta.ahorrado);
    valores[`meta_fecha_${meta.id}`] = meta.fecha;
  }
  for (const clave of PARAMETROS_PRUEBA) valores[`p_${clave}`] = numeroEditable(base.parametros[clave]);
  return valores;
}

export function rutasCalculadora(app: Hono, estado: Estado) {
  // Solo lee: por eso todo va por GET (nada que guardar, y no se programa ninguna copia de los datos)
  const calcular = (c: Context): { datos: DatosCalculadora; valores: Record<string, string> } => {
    const base = construir(bd(estado), estado.hoy());
    const f = Formulario.deConsulta(c);
    const prueba = leerPrueba(f, base);
    return {
      datos: {
        base,
        prueba,
        real: simular(base, sinCambios()),
        simulada: simular(base, prueba),
        automatico: totalMensual(leerAportaciones(bd(estado)), mesDe(base.hoy)),
      },
      valores: { ...valoresReales(base), ...f.todos() },
    };
  };

  app.get("/calculadora", (c) => {
    const { datos, valores } = calcular(c);
    return render(c, estado, { titulo: "Calculadora", seccion: "calculadora" }, vistaCalculadora(datos, valores));
  });

  app.get("/calculadora/resultado", (c) => c.html(resultadoCalculadora(calcular(c).datos, { conLineas: true })));
}
