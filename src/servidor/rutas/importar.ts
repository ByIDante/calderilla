import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { formatoFecha } from "../../dominio/fechas.ts";
import { adivinar, firma, interpretar, leerArchivo, type Configuracion, type Filas } from "../../importar/extracto.ts";
import { leerCuentas } from "../../servicios/cuentas.ts";
import { importar, leerReglas, perfilPorFirma, proponer } from "../../servicios/importacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, casilla, eur, selector, vacio } from "../vistas/comun.ts";

interface Pendiente {
  archivo: string;
  filas: Filas;
  cuentaId: number | null;
  creado: number;
}

/** Extractos subidos a la espera de confirmar las columnas (solo en memoria, 1 hora). */
const pendientes = new Map<string, Pendiente>();
const CADUCIDAD_MS = 3_600_000;
const TAMANO_MAXIMO = 10 * 1024 * 1024;

function limpiarCaducados() {
  for (const [token, p] of pendientes) if (Date.now() - p.creado > CADUCIDAD_MS) pendientes.delete(token);
}

/** La configuración de columnas viene en la URL (al cambiar un desplegable) o en el formulario final. */
function leerConfiguracion(valores: (nombre: string) => string | undefined, base: Configuracion): Configuracion {
  const numero = (nombre: string, actual: number | null) => {
    const valor = valores(nombre);
    if (valor === undefined) return actual;
    return valor === "" ? null : Number(valor);
  };
  const formato = valores("formatoFecha");
  return {
    filaCabecera: numero("filaCabecera", base.filaCabecera) ?? 0,
    fecha: numero("fecha", base.fecha) ?? 0,
    concepto: numero("concepto", base.concepto) ?? 0,
    importe: numero("importe", base.importe),
    cargo: numero("cargo", base.cargo),
    abono: numero("abono", base.abono),
    formatoFecha: formato === "ymd" || formato === "mdy" || formato === "dmy" ? formato : base.formatoFecha,
    invertirSigno: valores("cambiado") === undefined ? base.invertirSigno : valores("invertirSigno") === "1",
  };
}

function pendienteDe(c: Context): [string, Pendiente] | null {
  limpiarCaducados();
  const token = c.req.param("token") ?? "";
  const pendiente = pendientes.get(token);
  return pendiente ? [token, pendiente] : null;
}

export function rutasImportar(app: Hono, estado: Estado) {
  app.get("/importar", (c) => {
    const base = bd(estado);
    const cuentas = leerCuentas(base, estado.hoy());
    const historial = base.todos<{ fecha: string; archivo: string; filas: number; nuevas: number }>("SELECT fecha, archivo, filas, nuevas FROM importaciones ORDER BY id DESC LIMIT 10");
    const reglas = leerReglas(base);
    const categorias = base.todos<{ id: number; nombre: string }>("SELECT id, nombre FROM categorias WHERE archivada = 0 ORDER BY nombre");
    return render(
      c,
      estado,
      { titulo: "Importar un extracto", seccion: "ocio" },
      html`
        <section class="tarjeta">
          <p>
            Descarga los movimientos desde la web de tu banco (CSV o Excel) y súbelos aquí. Los gastos que coincidan con tus gastos fijos se reconocen solos y no se cuentan dos
            veces; los de ocio cuentan para tu presupuesto de ocio; y si subes el mismo extracto dos veces, no se duplica nada.
          </p>
          <form method="post" action="/importar" enctype="multipart/form-data" class="formulario" hx-boost="false">
            <div class="fila-campos">
              <div class="campo">
                <label for="campo-archivo">Extracto</label>
                <input id="campo-archivo" type="file" name="archivo" accept=".csv,.txt,.xls,.xlsx,.ods" required />
              </div>
              ${selector("Cuenta (opcional)", "cuenta", [["", "Sin cuenta"], ...cuentas.map((x) => [String(x.id), x.nombre] as const)], "")}
            </div>
            <div class="botones"><button class="boton boton-principal" type="submit">Subir y revisar</button></div>
          </form>
        </section>
        <div class="rejilla">
          <section class="tarjeta">
            <h2>Categorías automáticas</h2>
            <p class="apagado pequeno">Si el concepto contiene el texto, el movimiento va a esa categoría.</p>
            <ul class="lista-plana">
              ${reglas.map(
                (r) => html`<li><span>«${r.patron}» → ${r.categoria}</span>${botonAccion(`/importar/reglas/${r.id}/borrar`, "Quitar", { estilo: "enlace" })}</li>`,
              )}
            </ul>
            <form method="post" action="/importar/reglas" class="formulario" style="margin-top:10px">
              <div class="fila-campos">
                ${campo({ etiqueta: "Si el concepto contiene", nombre: "patron", requerido: true })}
                ${selector("Categoría", "categoria", categorias.map((x) => [String(x.id), x.nombre] as const), "")}
              </div>
              <div class="botones"><button class="boton" type="submit">Añadir regla</button></div>
            </form>
          </section>
          <section class="tarjeta">
            <h2>Últimas importaciones</h2>
            ${historial.length
              ? html`<ul class="lista-plana">
                  ${historial.map((h) => html`<li><span>${formatoFecha(h.fecha)} · ${h.archivo}</span><span class="apagado">${h.nuevas} nuevos de ${h.filas}</span></li>`)}
                </ul>`
              : vacio("Aún no has importado nada.")}
          </section>
        </div>
      `,
    );
  });

  app.post("/importar", async (c) => {
    const cuerpo = await c.req.parseBody();
    const archivo = cuerpo.archivo;
    if (!(archivo instanceof File) || archivo.size === 0) return redirigir(c, "/importar", { error: "Elige el archivo del extracto." });
    if (archivo.size > TAMANO_MAXIMO) return redirigir(c, "/importar", { error: "El archivo es demasiado grande (máximo 10 MB)." });
    let filas: Filas;
    try {
      filas = leerArchivo(archivo.name, new Uint8Array(await archivo.arrayBuffer()));
    } catch (error) {
      return redirigir(c, "/importar", { error: `No se pudo leer el archivo: ${(error as Error).message}` });
    }
    if (filas.length < 2) return redirigir(c, "/importar", { error: "El archivo no tiene movimientos." });
    const token = randomBytes(12).toString("hex");
    const cuenta = Number(cuerpo.cuenta);
    pendientes.set(token, { archivo: archivo.name, filas, cuentaId: Number.isInteger(cuenta) && cuenta > 0 ? cuenta : null, creado: Date.now() });
    return redirigir(c, `/importar/${token}`);
  });

  app.post("/importar/reglas", async (c) => {
    const f = await Formulario.de(c);
    const patron = f.texto("patron").toLowerCase();
    const categoria = f.entero("categoria");
    if (!patron || !categoria) return redirigir(c, "/importar", { error: "Indica el texto y la categoría." });
    bd(estado).ejecutar("INSERT INTO reglas_categoria (patron, categoria_id) VALUES (?, ?) ON CONFLICT (patron) DO UPDATE SET categoria_id = excluded.categoria_id", patron, categoria);
    return redirigir(c, "/importar", { ok: `Regla «${patron}» guardada.` });
  });

  app.post("/importar/reglas/:id/borrar", (c) => {
    bd(estado).ejecutar("DELETE FROM reglas_categoria WHERE id = ?", idDe(c));
    return redirigir(c, "/importar", { ok: "Regla quitada." });
  });

  app.get("/importar/:token", (c) => {
    const encontrado = pendienteDe(c);
    if (!encontrado) return redirigir(c, "/importar", { error: "Ese extracto ya no está: vuelve a subirlo." });
    const [token, pendiente] = encontrado;
    const base = bd(estado);
    const adivinada = adivinar(pendiente.filas);
    const guardado = perfilPorFirma(base, firma(pendiente.filas, adivinada.filaCabecera));
    const cfg = leerConfiguracion((n) => c.req.query(n), guardado?.configuracion ?? adivinada);
    const { movimientos, errores } = interpretar(pendiente.filas, cfg);
    const propuestas = proponer(base, movimientos, pendiente.cuentaId);
    const categorias = new Map(base.todos<{ id: number; nombre: string; tipo: string }>("SELECT id, nombre, tipo FROM categorias").map((x) => [x.id, x]));
    const titulos = pendiente.filas[cfg.filaCabecera] ?? [];
    const columnas = [["", "—"] as const, ...titulos.map((t, i) => [String(i), `${i + 1}. ${t || "(sin título)"}`] as const)];
    const nuevas = propuestas.filter((p) => !p.duplicado).length;
    const valorColumna = (v: number | null) => (v === null ? "" : String(v));
    return render(
      c,
      estado,
      { titulo: `Revisar ${pendiente.archivo}`, seccion: "ocio" },
      html`
        <section class="tarjeta">
          <h2>¿Qué es cada columna?</h2>
          ${guardado ? html`<p class="apagado">Reconocido el formato «${guardado.nombre}».</p>` : html`<p class="apagado">Lo he adivinado por los títulos; corrige lo que no cuadre.</p>`}
          <form method="get" action="/importar/${token}" class="formulario">
            <input type="hidden" name="cambiado" value="1" />
            <div class="fila-campos">
              ${selector(
                "Fila de títulos",
                "filaCabecera",
                pendiente.filas.slice(0, 15).map((f, i) => [String(i), `${i + 1}: ${f.slice(0, 3).join(" · ").slice(0, 60)}`] as const),
                String(cfg.filaCabecera),
              )}
              ${selector("Fecha", "fecha", columnas, valorColumna(cfg.fecha))} ${selector("Concepto", "concepto", columnas, valorColumna(cfg.concepto))}
              ${selector("Formato de fecha", "formatoFecha", [["dmy", "día/mes/año"], ["ymd", "año-mes-día"], ["mdy", "mes/día/año"]], cfg.formatoFecha)}
            </div>
            <div class="fila-campos">
              ${selector("Importe (una columna)", "importe", columnas, valorColumna(cfg.importe), "Si tu banco separa cargos y abonos, deja esto en «—».")}
              ${selector("Cargos", "cargo", columnas, valorColumna(cfg.cargo))} ${selector("Abonos", "abono", columnas, valorColumna(cfg.abono))}
            </div>
            ${casilla("Los gastos vienen en positivo (invertir el signo)", "invertirSigno", cfg.invertirSigno)}
            <div class="botones"><button class="boton" type="submit">Aplicar</button></div>
          </form>
        </section>
        <section class="tarjeta">
          <div class="tarjeta-cabecera">
            <h2>${movimientos.length} movimientos</h2>
            <span class="apagado pequeno">${nuevas} nuevos · ${propuestas.length - nuevas} ya importados${errores ? ` · ${errores} filas sin fecha o importe` : ""}</span>
          </div>
          ${propuestas.length
            ? html`<div class="tabla-contenedor">
                <table class="tabla-apilable">
                  <thead><tr><th>Fecha</th><th>Concepto</th><th class="numero">Importe</th><th>Categoría</th><th>Nota</th></tr></thead>
                  <tbody>
                    ${propuestas.slice(0, 200).map((p) => {
                      const categoria = p.categoriaId ? categorias.get(p.categoriaId) : undefined;
                      return html`<tr class="${p.duplicado ? "finalizado" : ""}">
                        <td>${formatoFecha(p.fecha)}</td><td>${p.concepto}</td>
                        <td class="numero ${p.importe < 0 ? "" : "positivo"}">${eur(p.importe)}</td>
                        <td>${categoria ? html`${categoria.nombre}${categoria.tipo === "ocio" ? html` <span class="etiqueta etiqueta-neutra">ocio</span>` : ""}` : html`<span class="apagado">sin categoría</span>`}</td>
                        <td class="pequeno">${p.duplicado ? "ya importado" : p.recurrente ? `es «${p.recurrente}» (ya contado)` : ""}</td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
              </div>`
            : vacio("Con estas columnas no sale ningún movimiento: revisa la fila de títulos, la fecha y el importe.")}
          ${nuevas
            ? html`<form method="post" action="/importar/${token}" class="formulario" style="margin-top:12px">
                ${Object.entries(cfg).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v === null ? "" : v === true ? "1" : v === false ? "" : String(v)}" />`)}
                <input type="hidden" name="cambiado" value="1" />
                ${campo({ etiqueta: "Recordar este formato como", nombre: "perfil", valor: guardado?.nombre ?? "", marcador: "BBVA, CaixaBank…", ayuda: "Opcional: la próxima vez se reconocerá solo." })}
                <div class="botones">
                  <button class="boton boton-principal" type="submit">Importar ${nuevas} movimientos</button>
                  <a class="boton" href="/importar">Cancelar</a>
                </div>
              </form>`
            : ""}
        </section>
      `,
    );
  });

  app.post("/importar/:token", async (c) => {
    const encontrado = pendienteDe(c);
    if (!encontrado) return redirigir(c, "/importar", { error: "Ese extracto ya no está: vuelve a subirlo." });
    const [token, pendiente] = encontrado;
    const f = await Formulario.de(c);
    const campos = f.todos();
    const cfg = leerConfiguracion((n) => campos[n], adivinar(pendiente.filas));
    const base = bd(estado);
    const { movimientos } = interpretar(pendiente.filas, cfg);
    const propuestas = proponer(base, movimientos, pendiente.cuentaId);
    const nombrePerfil = f.texto("perfil");
    const resultado = importar(base, propuestas, {
      cuentaId: pendiente.cuentaId,
      archivo: pendiente.archivo,
      hoy: estado.hoy(),
      perfil: nombrePerfil ? { nombre: nombrePerfil, firma: firma(pendiente.filas, cfg.filaCabecera), configuracion: cfg } : null,
    });
    pendientes.delete(token);
    return redirigir(c, "/ocio", { ok: `Importados ${resultado.nuevas} movimientos${resultado.duplicadas ? ` (${resultado.duplicadas} ya estaban)` : ""}.` });
  });
}

