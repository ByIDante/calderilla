import type { Hono } from "hono";
import { html } from "hono/html";
import type { BaseDatos } from "../../datos/db.ts";
import { importeEditable, leerNumero, numeroEditable } from "../../dominio/dinero.ts";
import { formatoFecha, mesDe } from "../../dominio/fechas.ts";
import { brutoDeNeto, estimarIrpf, type Tramo } from "../../reglas/irpf.ts";
import { PARAMETROS, type ClaveParametro } from "../../reglas/parametros.ts";
import { PREGUNTAS, puntuar } from "../../reglas/cuestionario.ts";
import { NOMBRE_ESTABILIDAD, NOMBRE_RIESGO } from "../../reglas/tipos.ts";
import { ESTABILIDADES, guardarParametros, guardarPerfil, leerMercado, leerParametros, leerPerfil, RIESGOS, type PerfilCompleto } from "../../servicios/configuracion.ts";
import { leerRecurrentes, presupuestoMes } from "../../servicios/finanzas.ts";
import { titularSugerido } from "../../servicios/titular.ts";
import { bd, render, type Estado } from "../estado.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { aviso, campo, eur, pct, selector, type Html } from "../vistas/comun.ts";

const SITUACIONES: [PerfilCompleto["situacionLaboral"], string][] = [
  ["asalariado", "Asalariado"],
  ["funcionario", "Funcionario"],
  ["autonomo", "Autónomo"],
  ["otra", "Otra"],
];

function formularioPerfil(perfil: PerfilCompleto, titularSugerido: string | null): Html {
  return html`<form method="post" action="/ajustes/perfil" class="formulario">
    <div class="fila-campos">
      ${selector("Situación laboral", "situacionLaboral", SITUACIONES, perfil.situacionLaboral)}
      ${selector(
        "Estabilidad de tus ingresos",
        "estabilidad",
        ESTABILIDADES.map((e) => [e, NOMBRE_ESTABILIDAD[e]] as const),
        perfil.estabilidad,
        "Decide cuántos meses de gastos debe tener tu fondo de emergencia.",
      )}
      ${selector(
        "Perfil de riesgo",
        "riesgo",
        RIESGOS.map((r) => [r, NOMBRE_RIESGO[r]] as const),
        perfil.riesgo,
        "Conservador 25 % en bolsa · moderado 50 % · dinámico 70 % · agresivo 90 %. Si dudas, haz el cuestionario.",
      )}
    </div>
    <div class="fila-campos">
      ${campo({ etiqueta: "Tu tipo marginal de IRPF", nombre: "tipoMarginal", valor: numeroEditable(perfil.tipoMarginal), sufijo: "%", ayuda: "El de tu último tramo (estatal + autonómico). Sale en tu declaración o en un simulador de nómina." })}
      ${campo({ etiqueta: "Tipo que calculas al jubilarte", nombre: "tipoRescate", valor: numeroEditable(perfil.tipoRescate), sufijo: "%", ayuda: "Para valorar un plan de pensiones. Si no lo sabes, 19–24 % es habitual con una pensión media." })}
      ${campo({ etiqueta: "Lo que aporta tu empresa a tu plan al año", nombre: "aportacionEmpresa", valor: importeEditable(perfil.aportacionEmpresa), sufijo: "€" })}
      ${campo({ etiqueta: "Comunidad autónoma", nombre: "comunidad", valor: perfil.comunidad, ayuda: "Solo como recordatorio: los tramos del IRPF cambian según la comunidad." })}
    </div>
    ${campo({
      etiqueta: "Tu nombre y apellidos, como salen en el banco",
      nombre: "titular",
      valor: perfil.titular,
      marcador: titularSugerido ?? "Nombre Apellido Apellido",
      ayuda: titularSugerido && !perfil.titular
        ? `Si lo dejas vacío se usa «${titularSugerido}», el de tus cuentas. Sirve para reconocer lo que pasas a cuentas tuyas que no importas (Trade Republic, por ejemplo).`
        : "Sirve para reconocer lo que pasas a cuentas tuyas que no importas (Trade Republic, por ejemplo): no es un gasto, es tu dinero.",
    })}
    <div class="botones">
      <button class="boton boton-principal" type="submit">Guardar perfil</button>
      <a class="boton" href="/ajustes/cuestionario">Calcular mi perfil con 5 preguntas</a>
    </div>
  </form>`;
}

/**
 * Las escalas del IRPF para la estimación: la estatal y la de tu comunidad. Si no es Cataluña (la única que trae
 * la app), se usa la estatal también para la parte autonómica: suele parecerse, pero es una aproximación.
 */
function escalasIrpf(base: BaseDatos, comunidad: string): { estatal: Tramo[]; autonomica: Tramo[]; aproximada: boolean } | null {
  const tramos = (clave: string) => leerMercado(base).find((d) => d.clave === clave)?.valor as Tramo[] | undefined;
  const estatal = tramos("irpf_general_estatal");
  if (!estatal) return null;
  const cataluna = /catal/i.test(comunidad.normalize("NFD").replace(/[̀-ͯ]/g, "")) ? tramos("irpf_general_cataluna") : undefined;
  return { estatal, autonomica: cataluna ?? estatal, aproximada: !cataluna };
}

/** «¿Cuál es tu tipo marginal?»: con tu sueldo bruto o, si no lo sabes, con tu nómina neta */
function tarjetaIrpf(base: BaseDatos, hoy: string, consulta: { bruto: string; neto: string }): Html {
  const perfil = leerPerfil(base);
  const escalas = escalasIrpf(base, perfil.comunidad);
  // La nómina neta de cada mes, de tus ingresos fijos (para proponerla si no sabes el bruto)
  const ingresos = presupuestoMes(leerRecurrentes(base), mesDe(hoy)).ingresos;
  const bruto = leerNumero(consulta.bruto);
  const neto = leerNumero(consulta.neto);
  const estimacion = escalas && (bruto || neto) ? estimarIrpf(bruto ?? brutoDeNeto((neto ?? 0) * 12, escalas.estatal, escalas.autonomica), escalas.estatal, escalas.autonomica) : null;
  return html`<section class="tarjeta" id="irpf">
    <h2>¿Cuál es tu tipo marginal?</h2>
    <p class="apagado">
      Es lo que te ahorras de IRPF por cada euro que aportas a un plan de pensiones: con él se mira si te compensa. Aquí lo estimo con tu sueldo (asalariado, sin
      hijos ni deducciones); lo exacto está en tu declaración de la renta.
    </p>
    ${escalas?.aproximada
      ? html`<p class="apagado pequeno">
          Solo tengo la escala de Cataluña: para ${perfil.comunidad ? html`«${perfil.comunidad}»` : "tu comunidad"} uso la estatal también para la parte autonómica,
          que suele parecerse. Pon tu comunidad en tu perfil.
        </p>`
      : ""}
    <form method="get" action="/ajustes#irpf" class="formulario">
      <div class="fila-campos">
        ${campo({ etiqueta: "Sueldo bruto al año", nombre: "bruto", valor: consulta.bruto, sufijo: "€", ayuda: "Sale en tu contrato o en el certificado de retenciones." })}
        ${campo({
          etiqueta: "O tu nómina neta de cada mes",
          nombre: "neto",
          valor: consulta.neto || (bruto ? "" : ingresos ? importeEditable(ingresos) : ""),
          sufijo: "€",
          ayuda: "Si no sabes el bruto: lo que te llega cada mes, con las pagas extra repartidas (como en Ingresos y gastos).",
        })}
      </div>
      <div class="botones"><button class="boton" type="submit">Calcular</button></div>
    </form>
    ${estimacion
      ? html`<ul class="lista-plana bloque">
            <li><span>Sueldo bruto al año${bruto ? "" : " (calculado con tu neto)"}</span><span class="numero">${eur(Math.round(estimacion.bruto * 100))}</span></li>
            <li><span>Seguridad Social</span><span class="numero">${eur(Math.round(estimacion.cotizaciones * 100))}</span></li>
            <li><span>IRPF al año</span><span class="numero">${eur(Math.round(estimacion.cuota * 100))} (${pct(estimacion.tipoMedio, 1)} de media)</span></li>
            <li><span><b>Tu tipo marginal</b></span><span class="numero"><b>${pct(estimacion.marginal, 1)}</b></span></li>
          </ul>
          <p class="apagado pequeno">
            ${estimacion.marginal < 1
              ? "Con este sueldo casi no pagas IRPF: un plan de pensiones no te ahorraría impuestos."
              : `Por cada 100 € que aportes a un plan de pensiones te ahorrarías unos ${Math.round(estimacion.marginal)} € de IRPF.`}
          </p>
          <form method="post" action="/ajustes/irpf" class="botones">
            <input type="hidden" name="tipo" value="${Math.round(estimacion.marginal * 10) / 10}" />
            <button class="boton boton-principal" type="submit">Usar ${pct(Math.round(estimacion.marginal * 10) / 10, 1)} en mi perfil</button>
          </form>`
      : ""}
  </section>`;
}

/** Exporta todas las tablas (salvo el estado de sincronización) a JSON. */
function exportar(estado: Estado): unknown {
  const base = bd(estado);
  const tablas = base.todos<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('meta') AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return {
    programa: "Calderilla",
    exportado: new Date().toISOString(),
    esquema: base.version(),
    tablas: Object.fromEntries(tablas.map(({ name }) => [name, base.todos(`SELECT * FROM ${name}`)])),
  };
}

/** Ajustes comunes al PC y al móvil. `tarjetasEquipo` pinta lo que solo tiene cada plataforma (este ordenador o este móvil). */
export function rutasAjustes(app: Hono, estado: Estado, tarjetasEquipo: () => Html) {
  app.get("/ajustes", (c) => {
    const base = bd(estado);
    const categorias = base.todos<{ id: number; nombre: string; tipo: string }>("SELECT id, nombre, tipo FROM categorias WHERE archivada = 0 ORDER BY tipo, nombre");
    return render(
      c,
      estado,
      { titulo: "Ajustes", seccion: "ajustes" },
      html`
        <section class="tarjeta">
          <h2>Tu perfil</h2>
          ${formularioPerfil(leerPerfil(base), titularSugerido(base))}
        </section>
        ${tarjetaIrpf(base, estado.hoy(), { bruto: c.req.query("bruto") ?? "", neto: c.req.query("neto") ?? "" })}
        <div class="rejilla">
          <section class="tarjeta">
            <h2>Reglas</h2>
            <ul class="lista-plana">
              <li><a href="/ajustes/mercado">Datos de mercado</a><span class="apagado pequeno">tipos de cuentas, Letras, IRPF…</span></li>
              <li><a href="/ajustes/parametros">Parámetros de la escalera</a><span class="apagado pequeno">umbrales y porcentajes</span></li>
            </ul>
          </section>
          ${tarjetasEquipo()}
          <section class="tarjeta">
            <h2>Categorías</h2>
            <ul class="lista-plana">${categorias.map((cat) => html`<li><span>${cat.nombre}</span><span class="apagado pequeno">${cat.tipo}</span></li>`)}</ul>
            <form method="post" action="/ajustes/categorias" class="formulario" style="margin-top:10px">
              <div class="fila-campos">
                ${campo({ etiqueta: "Nueva categoría", nombre: "nombre" })}
                ${selector("Tipo", "tipo", [["esencial", "Gasto esencial"], ["otro", "Gasto no esencial"], ["ocio", "Ocio"], ["ingreso", "Ingreso"]], "otro")}
              </div>
              <div class="botones"><button class="boton" type="submit">Añadir</button></div>
            </form>
          </section>
        </div>
      `,
    );
  });

  app.post("/ajustes/perfil", async (c) => {
    const f = await Formulario.de(c);
    const estabilidad = ESTABILIDADES.find((e) => e === f.texto("estabilidad"));
    const riesgo = RIESGOS.find((r) => r === f.texto("riesgo"));
    const situacion = SITUACIONES.find(([s]) => s === f.texto("situacionLaboral"))?.[0];
    if (!estabilidad || !riesgo || !situacion) return redirigir(c, "/ajustes", { error: "Revisa el perfil." });
    guardarPerfil(bd(estado), {
      estabilidad,
      riesgo,
      situacionLaboral: situacion,
      tipoMarginal: f.numero("tipoMarginal"),
      tipoRescate: f.numero("tipoRescate"),
      aportacionEmpresa: f.importe("aportacionEmpresa") ?? 0,
      comunidad: f.texto("comunidad"),
      titular: f.texto("titular"),
    });
    return redirigir(c, "/ajustes", { ok: "Perfil guardado." });
  });

  app.post("/ajustes/irpf", async (c) => {
    const tipo = (await Formulario.de(c)).numero("tipo");
    if (tipo === null || tipo < 0 || tipo > 60) return redirigir(c, "/ajustes", { error: "Ese tipo marginal no es válido." });
    guardarPerfil(bd(estado), { tipoMarginal: tipo });
    return redirigir(c, "/ajustes", { ok: `Tu tipo marginal es ahora el ${pct(tipo, 1)}.` });
  });

  app.get("/ajustes/cuestionario", (c) => {
    return render(
      c,
      estado,
      { titulo: "Tu perfil de riesgo", seccion: "ajustes" },
      html`
        <p><a href="/ajustes">← Ajustes</a></p>
        <p class="apagado">
          Mide cuánto riesgo aguantas y cuánto te puedes permitir; tu perfil es el menor de los dos. Responde pensando en lo que harías de verdad, no en lo que
          te gustaría hacer.
        </p>
        <form method="post" action="/ajustes/cuestionario" class="formulario">
          ${PREGUNTAS.map(
            (pregunta, i) => html`<fieldset>
              <legend>${i + 1}. ${pregunta.texto}</legend>
              ${pregunta.respuestas.map(
                (respuesta, j) => html`<div class="campo-casilla">
                  <input type="radio" id="p${i}-${j}" name="p${i}" value="${j}" required />
                  <label for="p${i}-${j}">${respuesta}</label>
                </div>`,
              )}
            </fieldset>`,
          )}
          <div class="botones"><button class="boton boton-principal" type="submit">Calcular y guardar</button></div>
        </form>
      `,
    );
  });

  app.post("/ajustes/cuestionario", async (c) => {
    const f = await Formulario.de(c);
    const respuestas = PREGUNTAS.map((_, i) => f.entero(`p${i}`));
    if (respuestas.some((r) => r === null)) return redirigir(c, "/ajustes/cuestionario", { error: "Responde a las cinco preguntas." });
    const resultado = puntuar(respuestas as number[]);
    guardarPerfil(bd(estado), { riesgo: resultado.perfil, estabilidad: resultado.estabilidad });
    return redirigir(c, "/ajustes", {
      ok: `Tu perfil: ${NOMBRE_RIESGO[resultado.perfil].toLowerCase()} (tolerancia ${resultado.tolerancia.toFixed(1)} de 3, capacidad ${resultado.capacidad.toFixed(1)} de 3). Estabilidad: ${resultado.estabilidad}. Guardado.`,
    });
  });

  app.post("/ajustes/categorias", async (c) => {
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const tipo = ["esencial", "otro", "ocio", "ingreso"].find((t) => t === f.texto("tipo"));
    if (!nombre || !tipo) return redirigir(c, "/ajustes", { error: "Indica el nombre de la categoría." });
    bd(estado).ejecutar("INSERT OR IGNORE INTO categorias (nombre, tipo) VALUES (?, ?)", nombre, tipo);
    return redirigir(c, "/ajustes", { ok: `Categoría «${nombre}» añadida.` });
  });

  app.get("/ajustes/exportar", (c) => {
    c.header("Content-Disposition", `attachment; filename="calderilla-${estado.hoy()}.json"`);
    return c.json(exportar(estado));
  });

  // ── Datos de mercado ──
  app.get("/ajustes/mercado", (c) => {
    const datos = leerMercado(bd(estado));
    const p = leerParametros(bd(estado));
    const hoy = estado.hoy();
    return render(
      c,
      estado,
      { titulo: "Datos de mercado", seccion: "ajustes" },
      html`
        <p><a href="/ajustes">← Ajustes</a></p>
        <p class="apagado">
          Las reglas usan estos datos para comparar opciones. Cambian con el tiempo: revísalos de vez en cuando (la fuente está enlazada). Si uno tiene más de
          ${p.datoViejoDias} días, la app te pedirá que lo verifiques y dejará de usarlo para recomendar.
        </p>
        ${datos.map((d) => {
          const editable = d.tipo === "cuenta" || d.tipo === "letras" || d.tipo === "referencia" || d.tipo === "limite";
          const viejo = (Date.parse(hoy) - Date.parse(d.comprobado)) / 86_400_000 > p.datoViejoDias;
          return html`<section class="tarjeta">
            <div class="tarjeta-cabecera">
              <h2>${d.nombre}</h2>
              <span class="apagado pequeno">comprobado el ${formatoFecha(d.comprobado)}${viejo ? " · verifícalo" : ""}${d.origen === "usuario" ? " · editado por ti" : ""}</span>
            </div>
            ${viejo ? aviso("atencion", "Este dato tiene tiempo: compruébalo en la fuente y guárdalo de nuevo.") : ""}
            ${d.nota ? html`<p class="apagado pequeno">${d.nota}</p>` : ""}
            ${d.fuente ? html`<p class="pequeno">Fuente: <a href="${d.fuente}" target="_blank" rel="noopener noreferrer">${d.fuente}</a></p>` : ""}
            ${editable
              ? html`<form method="post" action="/ajustes/mercado/${d.clave}" class="formulario">
                  <div class="fila-campos">
                    ${campo({ etiqueta: d.tipo === "limite" ? "Valor" : "Tipo", nombre: "valor", valor: numeroEditable(Number(d.valor)), sufijo: d.tipo === "limite" ? "€" : "%", id: `valor-${d.clave}` })}
                    ${d.tipo === "cuenta" ? campo({ etiqueta: "Fin de la promoción (opcional)", nombre: "fin", tipo: "date", valor: d.finPromocion, id: `fin-${d.clave}` }) : ""}
                    ${campo({ etiqueta: "Nota", nombre: "nota", valor: d.nota, id: `nota-${d.clave}` })}
                  </div>
                  <div class="botones">
                    <button class="boton" type="submit">Guardar (comprobado hoy)</button>
                    ${d.tipo === "cuenta" ? html`<button class="boton boton-peligro" type="submit" name="borrar" value="1">Quitar</button>` : ""}
                  </div>
                </form>`
              : html`<ul class="lista-plana">
                  ${(d.valor as { hasta: number | null; tipo: number }[]).map((t) => html`<li><span>${t.hasta === null ? "Resto" : `Hasta ${eur(t.hasta * 100)}`}</span><span>${pct(t.tipo)}</span></li>`)}
                </ul>`}
          </section>`;
        })}
        <section class="tarjeta">
          <h2>Añadir una cuenta remunerada para comparar</h2>
          <form method="post" action="/ajustes/mercado" class="formulario">
            <div class="fila-campos">
              ${campo({ etiqueta: "Entidad", nombre: "nombre", requerido: true })} ${campo({ etiqueta: "TAE", nombre: "valor", sufijo: "%", requerido: true })}
              ${campo({ etiqueta: "Nota", nombre: "nota", marcador: "Hasta 50.000 €, clientes nuevos…" })} ${campo({ etiqueta: "Fuente", nombre: "fuente", marcador: "https://…" })}
            </div>
            <div class="botones"><button class="boton boton-principal" type="submit">Añadir</button></div>
          </form>
        </section>
      `,
    );
  });

  app.post("/ajustes/mercado", async (c) => {
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const valor = f.numero("valor");
    if (!nombre || valor === null) return redirigir(c, "/ajustes/mercado", { error: "Indica la entidad y su TAE." });
    const clave = `cuenta_${nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_")}`;
    bd(estado).ejecutar(
      "INSERT OR REPLACE INTO datos_mercado (clave, nombre, tipo, valor, fuente, comprobado, nota, origen) VALUES (?, ?, 'cuenta', ?, ?, ?, ?, 'usuario')",
      clave,
      nombre,
      JSON.stringify(valor),
      f.opcional("fuente"),
      estado.hoy(),
      f.opcional("nota"),
    );
    return redirigir(c, "/ajustes/mercado", { ok: `Añadida «${nombre}».` });
  });

  app.post("/ajustes/mercado/:clave", async (c) => {
    const clave = c.req.param("clave");
    const f = await Formulario.de(c);
    if (f.casilla("borrar")) {
      bd(estado).ejecutar("DELETE FROM datos_mercado WHERE clave = ? AND tipo = 'cuenta'", clave);
      return redirigir(c, "/ajustes/mercado", { ok: "Quitada." });
    }
    const valor = f.numero("valor");
    if (valor === null) return redirigir(c, "/ajustes/mercado", { error: "El valor no es un número." });
    bd(estado).ejecutar(
      "UPDATE datos_mercado SET valor = ?, nota = ?, fin_promocion = ?, comprobado = ?, origen = 'usuario' WHERE clave = ?",
      JSON.stringify(valor),
      f.opcional("nota"),
      f.fecha("fin"),
      estado.hoy(),
      clave,
    );
    return redirigir(c, "/ajustes/mercado", { ok: "Dato guardado." });
  });

  // ── Parámetros ──
  app.get("/ajustes/parametros", (c) => {
    const actuales = leerParametros(bd(estado));
    const grupos = new Map<string, ClaveParametro[]>();
    for (const clave of Object.keys(PARAMETROS) as ClaveParametro[]) {
      const grupo = PARAMETROS[clave].grupo;
      grupos.set(grupo, [...(grupos.get(grupo) ?? []), clave]);
    }
    return render(
      c,
      estado,
      { titulo: "Parámetros de la escalera", seccion: "ajustes" },
      html`
        <p><a href="/ajustes">← Ajustes</a></p>
        <p class="apagado">Son los umbrales de las reglas. Los valores por defecto salieron del diseño; cámbialos si tu situación lo pide. Deja un campo con su valor por defecto para seguir las mejoras futuras del programa.</p>
        <form method="post" action="/ajustes/parametros" class="formulario">
          ${[...grupos].map(
            ([grupo, claves]) => html`<fieldset>
              <legend>${grupo}</legend>
              <div class="fila-campos">
                ${claves.map((clave) => {
                  const definicion = PARAMETROS[clave];
                  const ayuda = [("ayuda" in definicion ? definicion.ayuda : null) as string | null, `Por defecto: ${numeroEditable(definicion.defecto)} ${definicion.unidad}`].filter(Boolean).join(" ");
                  return campo({ etiqueta: definicion.etiqueta, nombre: clave, valor: numeroEditable(actuales[clave]), sufijo: definicion.unidad, ayuda });
                })}
              </div>
            </fieldset>`,
          )}
          <div class="botones">
            <button class="boton boton-principal" type="submit">Guardar</button>
            <button class="boton" type="submit" name="restablecer" value="1">Volver a los valores por defecto</button>
          </div>
        </form>
      `,
    );
  });

  app.post("/ajustes/parametros", async (c) => {
    const f = await Formulario.de(c);
    const cambios: Partial<Record<ClaveParametro, number>> = {};
    for (const clave of Object.keys(PARAMETROS) as ClaveParametro[]) {
      const valor = f.casilla("restablecer") ? PARAMETROS[clave].defecto : f.numero(clave);
      if (valor === null || valor < 0) return redirigir(c, "/ajustes/parametros", { error: `«${PARAMETROS[clave].etiqueta}» no es un número válido.` });
      cambios[clave] = valor;
    }
    guardarParametros(bd(estado), cambios);
    return redirigir(c, "/ajustes/parametros", { ok: f.casilla("restablecer") ? "Valores por defecto restablecidos." : "Parámetros guardados." });
  });
}
