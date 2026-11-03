import type { Context, Hono } from "hono";
import { importeEditable, leerImporte, numeroEditable } from "../../dominio/dinero.ts";
import { FRECUENCIAS } from "../../dominio/recurrencia.ts";
import { aplicarPrueba, cambiosAplicables } from "../../servicios/aplicarPrueba.ts";
import { importeDelMes, PARAMETROS_PRUEBA, simular, sinCambios, type Base, type CambioMeta, type ParametroPrueba, type Prueba } from "../../servicios/calculadora.ts";
import { construir } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { resultadoCalculadora, vistaAplicar, vistaCalculadora, type DatosCalculadora } from "../vistas/calculadora.ts";

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
  const automatico = f.importe("ahorro_automatico");
  if (automatico !== null && automatico >= 0 && automatico !== base.situacion.ahorroAutomatico) prueba.ahorroAutomatico = automatico;

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
  for (const { recurrente: r } of base.presupuesto.lineas.filter((l) => l.recurrente.prestamo)) {
    const importe = f.importe(`adelantar_${r.id}`);
    if (importe && importe > 0) prueba.adelantos.set(r.id, { importe, modo: f.texto(`modo_${r.id}`) === "cuota" ? "cuota" : "plazo" });
  }
  return prueba;
}

/**
 * Aplica un botón rápido sobre lo que ya hay en el formulario (se suma a lo que hayas cambiado): sube los
 * ingresos un 5 % o los gastos un 10 % (no las cuotas de los préstamos, que son fijas), o quita lo no esencial
 * o todos los ingresos.
 */
export function aplicarRapido(valores: Record<string, string>, rapido: string, base: Base) {
  const lineas = base.presupuesto.lineas.map((l) => l.recurrente);
  const multiplicar = (lista: typeof lineas, factor: number) => {
    for (const r of lista) {
      const actual = leerImporte(valores[`importe_${r.id}`] ?? "") ?? importeDelMes(r, base.hoy);
      valores[`importe_${r.id}`] = importeEditable(Math.round(actual * factor));
    }
  };
  const quitar = (lista: typeof lineas) => {
    for (const r of lista) valores[`quitar_${r.id}`] = "1";
  };
  if (rapido === "sueldo") multiplicar(lineas.filter((r) => r.tipo === "ingreso"), 1.05);
  if (rapido === "precios") multiplicar(lineas.filter((r) => r.tipo === "gasto" && !r.prestamo), 1.1);
  if (rapido === "no_esenciales") quitar(lineas.filter((r) => r.tipo === "gasto" && !r.esencial));
  if (rapido === "sin_ingresos") quitar(lineas.filter((r) => r.tipo === "ingreso"));
}

/** Lo que sale en cada campo al abrir la Calculadora: tus números de verdad */
function valoresReales(base: Base): Record<string, string> {
  const valores: Record<string, string> = {
    liquidez: importeEditable(base.situacion.liquidez),
    ocio_gastado: importeEditable(base.situacion.ocioGastado),
    ahorro_automatico: importeEditable(base.situacion.ahorroAutomatico),
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

/** Lo que has cambiado, como iría en la dirección: solo los campos que no coinciden con tus números de verdad */
function consultaDe(valores: Record<string, string>, reales: Record<string, string>): string {
  return new URLSearchParams(Object.entries(valores).filter(([nombre, valor]) => valor !== "" && valor !== reales[nombre])).toString();
}

export function rutasCalculadora(app: Hono, estado: Estado) {
  /** Tu prueba: lo escrito encima de tus números de verdad (un botón rápido lo cambia antes de leerlo) */
  const probar = (campos: Record<string, string>) => {
    const base = construir(bd(estado), estado.hoy());
    const { rapido, ok: _ok, error: _error, ...escrito } = campos;
    const reales = valoresReales(base);
    const valores = { ...reales, ...escrito };
    if (rapido) aplicarRapido(valores, rapido, base);
    return { base, valores, consulta: consultaDe(valores, reales), prueba: leerPrueba(new Formulario(valores), base) };
  };
  // Probar solo lee: por eso va por GET (nada que guardar, y no se programa ninguna copia de los datos)
  const calcular = (c: Context): { datos: DatosCalculadora; valores: Record<string, string> } => {
    const { base, valores, consulta, prueba } = probar(Formulario.deConsulta(c).todos());
    return { datos: { base, prueba, real: simular(base, sinCambios()), simulada: simular(base, prueba), consulta }, valores };
  };

  app.get("/calculadora", (c) => {
    const { datos, valores } = calcular(c);
    return render(c, estado, { titulo: "Calculadora", seccion: "calculadora" }, vistaCalculadora(datos, valores));
  });

  app.get("/calculadora/resultado", (c) => c.html(resultadoCalculadora(calcular(c).datos, { conLineas: true })));

  // «Aplicar estos cambios de verdad»: primero se ven y se eligen; nada se guarda hasta confirmarlo
  app.get("/calculadora/aplicar", (c) => {
    const { base, consulta, prueba } = probar(Formulario.deConsulta(c).todos());
    return render(c, estado, { titulo: "Aplicar los cambios", seccion: "calculadora" }, vistaAplicar(cambiosAplicables(bd(estado), base, prueba), consulta));
  });

  app.post("/calculadora/aplicar", async (c) => {
    const f = await Formulario.de(c);
    const { aplicar: _, ...campos } = f.todos();
    const { base, consulta, prueba } = probar(campos);
    const n = aplicarPrueba(bd(estado), base, prueba, new Set(f.textos("aplicar")), estado.hoy());
    if (!n) return redirigir(c, `/calculadora/aplicar?${consulta}`, { error: "No has marcado ningún cambio." });
    return redirigir(c, "/", { ok: `Hecho: ${n === 1 ? "1 cambio aplicado" : `${n} cambios aplicados`} a tus datos. Desde hoy cuentan en todas las pantallas.` });
  });
}
