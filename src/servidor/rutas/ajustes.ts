import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { html } from "hono/html";
import { carpetaAjustes, carpetasSugeridas } from "../../config/ajustes.ts";
import { importeEditable, numeroEditable } from "../../dominio/dinero.ts";
import { formatoFecha } from "../../dominio/fechas.ts";
import { PARAMETROS, type ClaveParametro } from "../../reglas/parametros.ts";
import { NOMBRE_ESTABILIDAD, NOMBRE_RIESGO } from "../../reglas/tipos.ts";
import { ESTABILIDADES, guardarParametros, guardarPerfil, leerMercado, leerParametros, leerPerfil, RIESGOS, type PerfilCompleto } from "../../servicios/configuracion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { aviso, botonAccion, campo, eur, pct, selector, type Html } from "../vistas/comun.ts";

const SITUACIONES: [PerfilCompleto["situacionLaboral"], string][] = [
  ["asalariado", "Asalariado"],
  ["funcionario", "Funcionario"],
  ["autonomo", "Autónomo"],
  ["otra", "Otra"],
];

function formularioPerfil(perfil: PerfilCompleto): Html {
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
        "Conservador 25 % en bolsa · moderado 50 % · dinámico 70 % · agresivo 90 %. Elige el que podrías aguantar viendo tu inversión caer un 30 % sin vender.",
      )}
    </div>
    <div class="fila-campos">
      ${campo({ etiqueta: "Tu tipo marginal de IRPF", nombre: "tipoMarginal", valor: numeroEditable(perfil.tipoMarginal), sufijo: "%", ayuda: "El de tu último tramo (estatal + autonómico). Sale en tu declaración o en un simulador de nómina." })}
      ${campo({ etiqueta: "Tipo que calculas al jubilarte", nombre: "tipoRescate", valor: numeroEditable(perfil.tipoRescate), sufijo: "%", ayuda: "Para valorar un plan de pensiones. Si no lo sabes, 19–24 % es habitual con una pensión media." })}
      ${campo({ etiqueta: "Lo que aporta tu empresa a tu plan al año", nombre: "aportacionEmpresa", valor: importeEditable(perfil.aportacionEmpresa), sufijo: "€" })}
      ${campo({ etiqueta: "Comunidad autónoma", nombre: "comunidad", valor: perfil.comunidad, ayuda: "Solo como recordatorio: los tramos del IRPF cambian según la comunidad." })}
    </div>
    <div class="botones"><button class="boton boton-principal" type="submit">Guardar perfil</button></div>
  </form>`;
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

export function rutasAjustes(app: Hono, estado: Estado) {
  app.get("/bienvenida", (c) => {
    const sugeridas = carpetasSugeridas();
    return render(
        c,
        estado,
        { titulo: "Bienvenido a Calderilla", seccion: "bienvenida" },
        html`<section class="tarjeta">
          <h2>¿Dónde guardo tus datos?</h2>
          <p>
            Elige una carpeta que se sincronice entre tus ordenadores (Google Drive, Dropbox, OneDrive, Syncthing…). Calderilla guarda allí una copia cada vez que cambias algo,
            y nunca sobrescribe una copia anterior: si usas la app en dos ordenadores a la vez, te avisa y eliges qué versión vale.
          </p>
          <p class="apagado">Si en el otro ordenador ya usas Calderilla, elige la misma carpeta y se cargarán tus datos.</p>
          ${sugeridas.length
            ? html`<p>Carpetas que he encontrado en este ordenador:</p>
                <ul>${sugeridas.map((s) => html`<li><code>${s}</code></li>`)}</ul>`
            : ""}
          <form method="post" action="/bienvenida" class="formulario">
            ${campo({ etiqueta: "Carpeta de datos", nombre: "carpeta", valor: sugeridas[0] ?? "", requerido: true, ayuda: "Ruta completa. Si no existe, se crea." })}
            <div class="botones"><button class="boton boton-principal" type="submit">Usar esta carpeta</button></div>
          </form>
          <p class="apagado pequeno">Los ajustes de este ordenador (esta carpeta, claves…) se guardan aparte, en <code>${carpetaAjustes()}</code>, y no se suben a ningún sitio.</p>
        </section>`,
    );
  });

  app.post("/bienvenida", async (c) => {
    const carpeta = (await Formulario.de(c)).texto("carpeta");
    if (!carpeta || !path.isAbsolute(carpeta)) return redirigir(c, "/bienvenida", { error: "Escribe la ruta completa de la carpeta." });
    try {
      mkdirSync(carpeta, { recursive: true });
      if (!statSync(carpeta).isDirectory()) throw new Error("No es una carpeta.");
      const habiaDatos = existsSync(path.join(carpeta, "copias"));
      estado.usarCarpeta(carpeta);
      return habiaDatos
        ? redirigir(c, "/", { ok: "Datos cargados desde la carpeta." })
        : redirigir(c, "/ajustes", { ok: "¡Listo! Empieza por tu perfil: cambia las recomendaciones." });
    } catch (error) {
      return redirigir(c, "/bienvenida", { error: `No se puede usar esa carpeta: ${(error as Error).message}` });
    }
  });

  app.get("/ajustes", (c) => {
    const base = bd(estado);
    const sync = estado.sync!;
    const { copias } = sync.listar();
    const local = sync.estadoLocal();
    const ultima = copias.find((copia) => copia.id === local.base);
    const categorias = base.todos<{ id: number; nombre: string; tipo: string }>("SELECT id, nombre, tipo FROM categorias WHERE archivada = 0 ORDER BY tipo, nombre");
    return render(
      c,
      estado,
      { titulo: "Ajustes", seccion: "ajustes" },
      html`
        <section class="tarjeta">
          <h2>Tu perfil</h2>
          ${formularioPerfil(leerPerfil(base))}
        </section>
        <div class="rejilla">
          <section class="tarjeta">
            <h2>Reglas</h2>
            <ul class="lista-plana">
              <li><a href="/ajustes/mercado">Datos de mercado</a><span class="apagado pequeno">tipos de cuentas, Letras, IRPF…</span></li>
              <li><a href="/ajustes/parametros">Parámetros de la escalera</a><span class="apagado pequeno">umbrales y porcentajes</span></li>
            </ul>
          </section>
          <section class="tarjeta">
            <h2>Este ordenador</h2>
            <ul class="lista-plana">
              <li><span>Nombre</span><span>${estado.ajustes.equipoNombre}</span></li>
              <li><span>Carpeta de datos</span><code class="pequeno">${estado.ajustes.carpetaDatos}</code></li>
              <li><span>Última copia</span><span>${ultima ? `${ultima.marca.slice(6, 8)}/${ultima.marca.slice(4, 6)}/${ultima.marca.slice(0, 4)} ${ultima.marca.slice(8, 10)}:${ultima.marca.slice(10, 12)} UTC` : "ninguna"}</span></li>
              <li><span>Copias guardadas</span><span>${copias.length}</span></li>
              <li><span>Cambios sin copiar</span><span>${local.sucio ? "sí (se copian en unos segundos)" : "no"}</span></li>
            </ul>
            <div class="botones" style="margin-top:10px">
              ${botonAccion("/ajustes/copiar", "Guardar copia ahora")}
              <a class="boton" href="/ajustes/exportar" hx-boost="false">Exportar a JSON</a>
            </div>
            <details style="margin-top:12px">
              <summary>Cambiar la carpeta de datos</summary>
              <form method="post" action="/ajustes/carpeta" class="formulario" style="margin-top:8px">
                ${campo({ etiqueta: "Nueva carpeta", nombre: "carpeta", valor: estado.ajustes.carpetaDatos, ayuda: "Antes de cambiar se guarda una copia en la carpeta actual. Si la nueva ya tiene datos de Calderilla, se cargan." })}
                <div class="botones"><button class="boton" type="submit">Cambiar</button></div>
              </form>
            </details>
          </section>
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
    });
    return redirigir(c, "/ajustes", { ok: "Perfil guardado." });
  });

  app.post("/ajustes/categorias", async (c) => {
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const tipo = ["esencial", "otro", "ocio", "ingreso"].find((t) => t === f.texto("tipo"));
    if (!nombre || !tipo) return redirigir(c, "/ajustes", { error: "Indica el nombre de la categoría." });
    bd(estado).ejecutar("INSERT OR IGNORE INTO categorias (nombre, tipo) VALUES (?, ?)", nombre, tipo);
    return redirigir(c, "/ajustes", { ok: `Categoría «${nombre}» añadida.` });
  });

  app.post("/ajustes/copiar", (c) => {
    const decision = estado.sync!.comprobar();
    if (estado.sync!.estado.tipo === "error") return redirigir(c, "/ajustes", { error: "No se ha podido guardar la copia." });
    return redirigir(c, "/ajustes", { ok: decision?.tipo === "nada" ? "No había cambios: la última copia ya está al día." : "Copia guardada." });
  });

  app.post("/ajustes/carpeta", async (c) => {
    const carpeta = (await Formulario.de(c)).texto("carpeta");
    if (!carpeta || !path.isAbsolute(carpeta)) return redirigir(c, "/ajustes", { error: "Escribe la ruta completa de la carpeta." });
    if (carpeta === estado.ajustes.carpetaDatos) return redirigir(c, "/ajustes");
    try {
      mkdirSync(carpeta, { recursive: true });
      estado.sync?.comprobar();
      estado.usarCarpeta(carpeta);
      return redirigir(c, "/ajustes", { ok: "Carpeta cambiada." });
    } catch (error) {
      return redirigir(c, "/ajustes", { error: `No se puede usar esa carpeta: ${(error as Error).message}` });
    }
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

  // ── Conflictos de sincronización ──
  app.get("/ajustes/conflicto", (c) => {
    const sync = estado.sync!;
    if (sync.estado.tipo !== "conflicto") return redirigir(c, "/");
    const { versiones, localConCambios } = sync.estado;
    const resumenes = versiones.map((v) => sync.resumen(v));
    const local = sync.resumen(null);
    const todas = localConCambios ? [local, ...resumenes] : resumenes;
    // Lo que solo aparece en una versión ayuda a reconocer cuál tiene los últimos cambios
    const soloEn = (r: ReturnType<typeof sync.resumen>) => r.nombres.filter((nombre) => todas.some((otra) => otra !== r && !otra.nombres.includes(nombre)));
    const tarjeta = (titulo: string, r: ReturnType<typeof sync.resumen>, eleccion: string) => html`<article class="version">
      <h3>${titulo}</h3>
      ${soloEn(r).length
        ? html`<p class="pequeno"><b>Solo en esta versión:</b> ${soloEn(r).join(", ")}</p>`
        : html`<p class="apagado pequeno">No tiene nada que no esté en las demás (pueden cambiar importes o saldos).</p>`}
      <ul class="lista-plana">
        <li><span>Guardada en</span><span>${r.equipo}</span></li>
        <li><span>Último cambio</span><span>${r.guardada ? new Date(r.guardada).toLocaleString("es-ES") : "?"}</span></li>
        <li><span>Ingresos y gastos fijos</span><span>${r.recurrentes}</span></li>
        <li><span>Apuntes</span><span>${r.apuntes}</span></li>
        <li><span>Cuentas</span><span>${r.cuentas}</span></li>
        <li><span>Inversiones</span><span>${r.activos}</span></li>
      </ul>
      ${botonAccion("/ajustes/conflicto", "Quedarme con esta", { estilo: "secundario", campos: { eleccion }, confirmar: "Las otras versiones quedarán apartadas en la carpeta de copias. ¿Seguir?" })}
    </article>`;
    return render(
      c,
      estado,
      { titulo: "Hay dos versiones de tus datos", seccion: "ajustes" },
      html`
        ${aviso(
          "atencion",
          "Se han guardado cambios en dos sitios a la vez (en otro ordenador, o aquí mientras la carpeta no estaba sincronizada). Calderilla no mezcla nada por su cuenta: elige con qué versión sigues. Las demás no se borran, quedan apartadas en la carpeta de copias.",
        )}
        <div class="opciones">
          ${localConCambios ? tarjeta("Este ordenador (con cambios sin guardar)", local, "local") : ""}
          ${versiones.map((v, i) => tarjeta(`Versión de ${resumenes[i]!.equipo}`, resumenes[i]!, v.archivo))}
        </div>
      `,
    );
  });

  app.post("/ajustes/conflicto", async (c) => {
    const eleccion = (await Formulario.de(c)).texto("eleccion");
    try {
      estado.sync!.resolver(eleccion);
      return redirigir(c, "/", { ok: "Conflicto resuelto." });
    } catch (error) {
      return redirigir(c, "/ajustes/conflicto", { error: (error as Error).message });
    }
  });
}
