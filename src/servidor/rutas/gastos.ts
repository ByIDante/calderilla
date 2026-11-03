import type { Context, Hono } from "hono";
import { html } from "hono/html";
import type { BaseDatos } from "../../datos/db.ts";
import { esFecha, formatoFecha, mesDe, sumarMesesAMes, type Fecha } from "../../dominio/fechas.ts";
import { finPrestamo } from "../../dominio/prestamo.ts";
import { desgloseAnual, estadoEn, finPorCuotas, FRECUENCIAS, mensualEn, type PagaExtra } from "../../dominio/recurrencia.ts";
import { claveConcepto } from "../../importar/periodicos.ts";
import {
  actualizarRecurrente,
  amortizar,
  borrarRecurrente,
  crearRecurrente,
  ingresosDelMes,
  leerRecurrentes,
  terminarRecurrente,
  type DatosRecurrente,
  type RecurrenteCompleto,
} from "../../servicios/finanzas.ts";
import { aceptarPropuestas, calcularPropuestas, ignorarPropuesta, marcarTraspasos, type Eleccion } from "../../servicios/periodicos.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { frasePresupuesto, mesesDeOpcion, necesitaDesglose } from "../vistas/cobros.ts";
import { aviso, eurR } from "../vistas/comun.ts";
import { vistaDetectar } from "../vistas/detectar.ts";
import { valoresDe, vistaCuadro, vistaFormulario, vistaLista, type Categoria, type Valores } from "../vistas/gastos.ts";

/** Las pagas extra del formulario (hasta 3; la 2 y la 3 solo si marcaste «Añadir otra»), o qué falla. */
export function leerPagas(f: Formulario): { pagas: PagaExtra[] } | { error: string } {
  if (f.texto("tipo") !== "ingreso" || f.texto("pagas") !== "1") return { pagas: [] };
  const pagas: PagaExtra[] = [];
  for (const n of [1, 2, 3]) {
    if (n > 1 && !f.casilla(`paga_otra_${n}`)) break;
    const cuando = f.texto(`paga_cuando_${n}`);
    const meses = cuando === "elegir" ? f.enteros(`paga_meses_${n}`).filter((m) => m >= 1 && m <= 12) : mesesDeOpcion(cuando || "jun-dic");
    if (!meses?.length) return { error: `Elige en qué meses llega la paga extra ${n}.` };
    const escrito = f.texto(`paga_importe_${n}`);
    const importe = escrito ? f.importe(`paga_importe_${n}`) : null;
    if (escrito && (importe === null || importe <= 0)) return { error: `El importe de la paga extra ${n} tiene que ser mayor que cero (o déjalo vacío para que sea como un cobro normal).` };
    pagas.push({ nombre: f.opcional(`paga_nombre_${n}`), meses: [...new Set(meses)].sort((a, b) => a - b), importe });
  }
  return { pagas };
}

/**
 * Con cuota final y la casilla marcada, una meta para ir apartándola: la crea o, si ya está, la pone al día
 * (importe y fecha del pago final). Si se desmarca no se borra: lo ahorrado para ella es tuyo.
 */
function metaCuotaFinal(base: BaseDatos, datos: DatosRecurrente, apartar: boolean) {
  const final = datos.prestamo?.cuotaFinal ?? 0;
  if (!apartar || !final) return;
  const fecha = finPrestamo({ ...datos.prestamo!, primeraCuota: datos.inicio });
  const nombre = `Cuota final de «${datos.nombre}»`;
  // La que ya tengas para esa cuota (aunque la llamaras de otra forma): el mismo importe hacia la misma fecha
  const existente = base.uno<{ id: number }>(
    `SELECT id FROM metas WHERE cumplida = 0 AND (nombre = ? OR (abs(objetivo - ?) <= 100 AND abs(julianday(fecha) - julianday(?)) <= 45))
     ORDER BY nombre = ? DESC LIMIT 1`,
    nombre,
    final,
    fecha,
    nombre,
  );
  if (existente) base.ejecutar("UPDATE metas SET objetivo = ?, fecha = ? WHERE id = ?", final, fecha, existente.id);
  else base.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES (?, ?, ?, 0)", nombre, final, fecha);
}

/** Los valores para volver a pintar el formulario tal como llegó (las casillas de meses se repiten) */
function valoresEnviados(f: Formulario): Valores {
  return { ...f.todos(), ...Object.fromEntries([1, 2, 3].map((n) => [`paga_meses_${n}`, f.textos(`paga_meses_${n}`).join(",")])) };
}

/** Convierte el formulario en datos válidos, o devuelve qué falla. */
export function leerGasto(f: Formulario, categorias: Categoria[]): { datos: DatosRecurrente } | { error: string } {
  const tipo = f.texto("tipo") === "ingreso" ? "ingreso" : "gasto";
  const nombre = f.texto("nombre");
  const inicio = f.fecha("inicio");
  const esPrestamo = f.casilla("prestamo") && tipo === "gasto";
  const frecuencia = FRECUENCIAS.find((x) => x === f.texto("frecuencia")) ?? "mensual";
  const importe = f.importe("importe");
  const categoriaId = f.entero("categoria");

  if (!nombre) return { error: "Falta el concepto." };
  const pagas = leerPagas(f);
  if ("error" in pagas) return pagas;
  if (!inicio) return { error: "Falta la fecha del primer cargo (o es incorrecta)." };
  if (categoriaId !== null && !categorias.some((c) => c.id === categoriaId)) return { error: "Esa categoría no existe." };

  let prestamo: DatosRecurrente["prestamo"] = null;
  if (esPrestamo) {
    const capital = f.importe("capital");
    const tin = f.numero("tin");
    const plazo = f.entero("plazo");
    if (!capital || capital <= 0) return { error: "Indica el capital prestado." };
    if (tin === null || tin < 0 || tin > 100) return { error: "Indica el TIN del préstamo (0 si es sin intereses)." };
    if (!plazo || plazo < 1 || plazo > 600) return { error: "Indica el plazo en meses." };
    const tae = f.numero("tae");
    if (tae !== null && (tae < 0 || tae > 100)) return { error: "La TAE debe estar entre 0 y 100 %." };
    const cuotaFinal = f.importe("cuota_final") ?? 0;
    if (cuotaFinal < 0 || cuotaFinal >= capital) return { error: "La cuota final tiene que ser menor que lo prestado (o déjala vacía si no tiene)." };
    prestamo = { capital, tin, tae: f.numero("tae"), plazoMeses: plazo, comisionAmortizacion: f.numero("comision") ?? 0, vinculado: f.casilla("vinculado"), cuotaFinal };
  } else if (importe === null || importe <= 0) {
    return { error: "Indica el importe (mayor que cero)." };
  }

  let fin: Fecha | null = null;
  if (!esPrestamo && f.texto("fin_modo") === "fecha") {
    fin = f.fecha("fin");
    if (!fin) return { error: "Indica la fecha del último cargo." };
    if (fin < inicio) return { error: "La fecha de fin no puede ser anterior al primer cargo." };
  } else if (!esPrestamo && f.texto("fin_modo") === "cuotas") {
    const cuotas = f.entero("cuotas");
    if (!cuotas || cuotas < 1) return { error: "Indica cuántos pagos son." };
    fin = finPorCuotas(inicio, frecuencia, cuotas);
  }

  return {
    datos: {
      tipo,
      nombre,
      categoriaId,
      frecuencia: esPrestamo ? "mensual" : frecuencia,
      inicio,
      fin,
      // Un préstamo siempre es esencial: dejar de pagarlo no es una opción
      esencial: tipo === "gasto" && (esPrestamo || f.casilla("esencial")),
      clase: f.texto("clase") === "estimacion" ? "estimacion" : "fijo",
      nota: f.opcional("nota"),
      // Mismo formato que la detección: minúsculas y sin acentos, solo palabras
      patron: claveConcepto(f.texto("patron")).palabras.join(" ") || null,
      importe: importe ?? 0,
      prestamo,
      pagasExtra: esPrestamo ? [] : pagas.pagas,
    },
  };
}

function categorias(estado: Estado): Categoria[] {
  return bd(estado).todos<Categoria>("SELECT id, nombre, tipo FROM categorias WHERE archivada = 0 ORDER BY tipo = 'ingreso' DESC, nombre");
}

function valoresNuevos(c: Context, hoy: Fecha): Valores {
  const tipo = c.req.query("tipo") === "ingreso" ? "ingreso" : "gasto";
  return { tipo, frecuencia: "mensual", inicio: hoy, fin_modo: "sin", clase: "fijo", esencial: tipo === "gasto" ? "1" : "", prestamo: c.req.query("prestamo") ? "1" : "", desde: hoy };
}

export function rutasGastos(app: Hono, estado: Estado) {
  app.get("/gastos", (c) => {
    const hoy = estado.hoy();
    const recurrentes = leerRecurrentes(bd(estado));
    const mensual = new Map(recurrentes.map((r) => [r.id, mensualEn(r, r.versiones, mesDe(hoy))]));
    const propuestas = calcularPropuestas(bd(estado), hoy).total;
    // Mes a mes solo si algún ingreso no es un importe al mes sin más (pagas extra, cada 2 semanas…)
    const conDesglose = recurrentes.some((r) => r.tipo === "ingreso" && estadoEn(r, hoy) !== "finalizado" && necesitaDesglose(r));
    const mesAMes = conDesglose ? Array.from({ length: 12 }, (_, i) => ingresosDelMes(recurrentes, sumarMesesAMes(mesDe(hoy), i))) : [];
    return render(c, estado, { titulo: "Ingresos y gastos", seccion: "gastos" }, vistaLista(recurrentes, hoy, mensual, propuestas, mesAMes));
  });

  // «Esto cuenta como X € al mes»: mientras rellenas el formulario, con la misma cuenta que el presupuesto
  app.get("/gastos/al-mes", (c) => {
    const f = Formulario.deConsulta(c);
    const frecuencia = FRECUENCIAS.find((x) => x === f.texto("frecuencia")) ?? "mensual";
    const importe = f.importe("importe");
    const pagas = leerPagas(f);
    if (f.casilla("prestamo") || !importe || importe <= 0 || "error" in pagas || (frecuencia === "mensual" && !pagas.pagas.length)) return c.html("");
    const hoy = estado.hoy();
    const inicio = f.fecha("inicio") ?? hoy;
    const r: RecurrenteCompleto = {
      id: 0,
      tipo: f.texto("tipo") === "ingreso" ? "ingreso" : "gasto",
      nombre: "",
      frecuencia,
      inicio,
      fin: null,
      esencial: false,
      categoriaId: null,
      categoria: null,
      clase: "fijo",
      nota: null,
      patron: null,
      versiones: [{ validoDesde: inicio, importe }],
      prestamo: null,
      pagasExtra: pagas.pagas,
    };
    const d = desgloseAnual(r, r.versiones, inicio);
    return c.html(html`Esto cuenta como <b>${eurR(d.alMes)} al mes</b> en tu presupuesto: ${frasePresupuesto(d, r.tipo)}`);
  });

  // Lo que se repite en tus movimientos (va antes de /gastos/:id para que «detectar» no se tome por un id)
  app.get("/gastos/detectar", (c) => {
    const base = bd(estado);
    marcarTraspasos(base, estado.hoy());
    return render(c, estado, { titulo: "Encontrado en tus movimientos", seccion: "gastos" }, vistaDetectar(calcularPropuestas(base, estado.hoy())));
  });

  app.post("/gastos/detectar", async (c) => {
    const f = await Formulario.de(c);
    const elecciones: Eleccion[] = f.textos("ids").map((id) => {
      // «nuevo», «unir:<id del gasto que ya tienes>» o «ahorro:<id de la cuenta>»
      const [como, numero] = f.texto(`como_${id}`).split(":");
      const referencia = /^\d+$/.test(numero ?? "") ? Number(numero) : null;
      return {
        id,
        nombre: f.texto(`nombre_${id}`) || undefined,
        esencial: f.casilla(`esencial_${id}`),
        como: como === "ahorro" ? "ahorro" : "gasto",
        destino: como === "ahorro" ? referencia : null,
        unir: como === "unir" ? referencia : null,
        pagas: f.casilla(`pagas_${id}`),
      };
    });
    if (!elecciones.length) return redirigir(c, "/gastos/detectar", { error: "Marca primero lo que quieres añadir." });
    const r = aceptarPropuestas(bd(estado), estado.hoy(), elecciones);
    const partes = [
      r.creados && `${r.creados} ${r.creados === 1 ? "añadido" : "añadidos"} a ingresos y gastos`,
      r.vinculados && `${r.vinculados} ${r.vinculados === 1 ? "unido" : "unidos"} a lo que ya tenías`,
      r.ahorros && `${r.ahorros} como ahorro automático`,
      r.precios && `${r.precios} ${r.precios === 1 ? "precio actualizado" : "precios actualizados"}`,
      r.pagas && `${r.pagas === 1 ? "pagas extra apuntadas en 1 ingreso" : `pagas extra apuntadas en ${r.pagas} ingresos`}`,
      r.estimaciones && `${r.estimaciones} ${r.estimaciones === 1 ? "estimación" : "estimaciones"} de gasto variable`,
    ].filter(Boolean);
    return redirigir(c, "/gastos/detectar", {
      ok: partes.length ? `Hecho: ${partes.join(", ")}.` : undefined,
      error: r.errores.length ? r.errores.join(" ") : undefined,
    });
  });

  app.post("/gastos/detectar/ignorar", async (c) => {
    const f = await Formulario.de(c);
    const hecho = ignorarPropuesta(bd(estado), estado.hoy(), f.texto("id"));
    return redirigir(c, "/gastos/detectar", hecho ? { ok: "Ignorado: no volverá a salir." } : { error: "Eso ya no está en la lista." });
  });

  app.get("/gastos/nuevo", (c) => {
    const hoy = estado.hoy();
    const valores = valoresNuevos(c, hoy);
    const titulo = valores.prestamo ? "Nuevo préstamo" : valores.tipo === "ingreso" ? "Nuevo ingreso" : "Nuevo gasto";
    return render(c, estado, { titulo, seccion: "gastos" }, vistaFormulario({ accion: "/gastos", valores, categorias: categorias(estado), editando: null, hoy }));
  });

  app.post("/gastos", async (c) => {
    const f = await Formulario.de(c);
    const lista = categorias(estado);
    const leido = leerGasto(f, lista);
    if ("error" in leido) {
      return render(
        c,
        estado,
        { titulo: "Nuevo", seccion: "gastos" },
        html`${aviso("error", leido.error)}${vistaFormulario({ accion: "/gastos", valores: valoresEnviados(f), categorias: lista, editando: null, hoy: estado.hoy() })}`,
      );
    }
    crearRecurrente(bd(estado), leido.datos);
    metaCuotaFinal(bd(estado), leido.datos, f.casilla("meta_cuota_final"));
    return redirigir(c, "/gastos", { ok: `Guardado «${leido.datos.nombre}».` });
  });

  app.get("/gastos/:id", (c) => {
    const hoy = estado.hoy();
    const [r] = leerRecurrentes(bd(estado), idDe(c));
    if (!r) return c.notFound();
    return render(c, estado, { titulo: r.nombre, seccion: "gastos" }, vistaFormulario({ accion: `/gastos/${r.id}`, valores: valoresDe(r, hoy), categorias: categorias(estado), editando: r, hoy }));
  });

  app.post("/gastos/:id", async (c) => {
    const id = idDe(c);
    const [r] = leerRecurrentes(bd(estado), id);
    if (!r) return c.notFound();
    const f = await Formulario.de(c);
    const lista = categorias(estado);
    const leido = leerGasto(f, lista);
    const hoy = estado.hoy();
    if ("error" in leido) {
      return render(
        c,
        estado,
        { titulo: r.nombre, seccion: "gastos" },
        html`${aviso("error", leido.error)}${vistaFormulario({ accion: `/gastos/${id}`, valores: valoresEnviados(f), categorias: lista, editando: r, hoy })}`,
      );
    }
    actualizarRecurrente(bd(estado), id, leido.datos, f.fecha("desde") ?? hoy);
    metaCuotaFinal(bd(estado), leido.datos, f.casilla("meta_cuota_final"));
    return redirigir(c, "/gastos", { ok: `Guardado «${leido.datos.nombre}».` });
  });

  app.post("/gastos/:id/terminar", async (c) => {
    const id = idDe(c);
    const f = await Formulario.de(c);
    const fecha = f.texto("fecha");
    if (!esFecha(fecha)) return redirigir(c, `/gastos/${id}`, { error: "Indica la fecha del último cargo." });
    terminarRecurrente(bd(estado), id, fecha);
    return redirigir(c, "/gastos", { ok: "Hecho: deja de contar a partir de esa fecha." });
  });

  app.post("/gastos/:id/amortizar", async (c) => {
    const id = idDe(c);
    const f = await Formulario.de(c);
    const importe = f.importe("importe");
    if (!importe || importe <= 0) return redirigir(c, `/gastos/${id}`, { error: "Indica cuánto amortizas." });
    const resultado = amortizar(bd(estado), id, { fecha: f.fecha("fecha") ?? estado.hoy(), importe, modo: f.texto("modo") === "cuota" ? "cuota" : "plazo" });
    return redirigir(c, `/gastos/${id}`, {
      ok: `Amortización apuntada: te ahorras unos ${eurR(resultado.interesesAntes - resultado.interesesDespues)} de intereses y terminas el ${formatoFecha(resultado.fin)}. Actualiza el saldo de la cuenta de la que salió el dinero.`,
    });
  });

  app.post("/gastos/:id/borrar", (c) => {
    borrarRecurrente(bd(estado), idDe(c));
    return redirigir(c, "/gastos", { ok: "Borrado." });
  });

  app.get("/gastos/:id/cuadro", (c) => {
    const [r] = leerRecurrentes(bd(estado), idDe(c));
    if (!r) return c.notFound();
    return render(c, estado, { titulo: `Cuadro de amortización: ${r.nombre}`, seccion: "gastos" }, vistaCuadro(r, estado.hoy()));
  });
}
