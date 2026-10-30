import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { html } from "hono/html";
import { cliente, diasParaCaducar, guardarBancos, guardarClave, hayClave, leerBancos, sincronizarBancos, type Conexion } from "../../bancos/conexiones.ts";
import type { Banco } from "../../bancos/enablebanking.ts";
import { formatoFecha } from "../../dominio/fechas.ts";
import { leerCuentas } from "../../servicios/cuentas.ts";
import type { BaseDatos } from "../../datos/db.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { aviso, botonAccion, campo, selector, vacio } from "../vistas/comun.ts";

/** Autorizaciones empezadas y aún sin volver del banco (en memoria, 1 hora). */
const autorizaciones = new Map<string, { banco: Banco; creado: number }>();
let listaBancos: { bancos: Banco[]; obtenida: number } | null = null;

const redireccionLocal = (estado: Estado) => `http://127.0.0.1:${estado.ajustes.puerto}/bancos/volver`;
const ocultarIban = (iban: string | null) => (iban ? `···· ${iban.slice(-4)}` : "");

async function bancosDisponibles(): Promise<Banco[]> {
  const api = cliente();
  if (!api) return [];
  if (!listaBancos || Date.now() - listaBancos.obtenida > 86_400_000) listaBancos = { bancos: await api.bancos("ES"), obtenida: Date.now() };
  return listaBancos.bancos;
}

/**
 * Borra lo que trajo un banco: sus movimientos y saldos. La cuenta solo se borra si no queda nada tuyo en
 * ella (otros movimientos, saldos apuntados a mano, metas o aportaciones); si unes el banco a una cuenta que ya
 * tenías, esa cuenta se queda con lo suyo.
 */
export function borrarLoTraido(base: BaseDatos, cuentas: readonly number[]): number {
  return base.transaccion(() => {
    let movimientos = 0;
    for (const cuenta of cuentas) {
      movimientos += base.ejecutar("DELETE FROM apuntes WHERE cuenta_id = ? AND origen = 'banco'", cuenta).cambios;
      base.ejecutar("DELETE FROM saldos WHERE cuenta_id = ? AND origen = 'banco'", cuenta);
      base.ejecutar("DELETE FROM importaciones WHERE cuenta_id = ? AND archivo = 'Enable Banking'", cuenta);
      const enUso = base.uno<{ n: number }>(
        `SELECT (SELECT count(*) FROM apuntes WHERE cuenta_id = ?1) + (SELECT count(*) FROM saldos WHERE cuenta_id = ?1)
              + (SELECT count(*) FROM metas WHERE cuenta_id = ?1) + (SELECT count(*) FROM aportaciones WHERE cuenta_id = ?1) AS n`,
        cuenta,
      )?.n;
      if (!enUso) base.ejecutar("DELETE FROM cuentas WHERE id = ?", cuenta);
    }
    return movimientos;
  });
}

type Desenlace = { ok?: string; error?: string };

/** Cómo acabó cada autorización, para que la pestaña de Calderilla se entere aunque el banco vuelva en otra. */
const desenlaces = new Map<string, Desenlace & { creado: number }>();

function apuntarDesenlace(token: string | undefined, desenlace: Desenlace): Desenlace {
  if (token) desenlaces.set(token, { ...desenlace, creado: Date.now() });
  for (const [clave, d] of desenlaces) if (Date.now() - d.creado > 3_600_000) desenlaces.delete(clave);
  return desenlace;
}

/** Vuelta del banco: crea la sesión, da de alta una cuenta de Calderilla por cada cuenta del banco y trae los datos. */
async function terminar(estado: Estado, codigo: string | undefined, token: string | undefined, error?: string): Promise<Desenlace> {
  if (error) return apuntarDesenlace(token, { error: `El banco no autorizó el acceso: ${error}` });
  const pendiente = token ? autorizaciones.get(token) : undefined;
  if (!codigo || !pendiente) return { error: "No reconozco esta autorización (¿ha caducado?). Vuelve a conectar el banco." };
  autorizaciones.delete(token!);
  const api = cliente();
  if (!api) return apuntarDesenlace(token, { error: "Falta configurar Enable Banking." });
  const sesion = await api.crearSesion(codigo);
  const base = bd(estado);
  const config = leerBancos();
  // Al renovar el permiso (cada 180 días) se reutilizan las cuentas de Calderilla de antes: si no, se
  // duplicarían el saldo y los movimientos
  const anteriores = config.conexiones.filter((x) => x.banco === pendiente.banco.nombre);
  const mismaCuenta = (a: { uid: string; iban: string | null }, b: { uid: string; iban: string | null }) => a.uid === b.uid || (a.iban !== null && a.iban === b.iban);
  const conexion: Conexion = {
    sessionId: sesion.sessionId,
    banco: pendiente.banco.nombre,
    pais: pendiente.banco.pais,
    validoHasta: sesion.validoHasta,
    ultimaSincronizacion: anteriores.map((x) => x.ultimaSincronizacion).filter(Boolean).sort().at(-1) ?? null,
    cuentas: sesion.cuentas.map((cuenta) => {
      const previa = anteriores.flatMap((x) => x.cuentas).find((x) => mismaCuenta(x, cuenta));
      if (previa) return { ...cuenta, cuentaId: previa.cuentaId };
      return {
        ...cuenta,
        cuentaId: base.ejecutar(
          "INSERT INTO cuentas (nombre, tipo, entidad, moneda) VALUES (?, 'corriente', ?, ?)",
          [pendiente.banco.nombre, cuenta.nombre ?? "", ocultarIban(cuenta.iban)].filter(Boolean).join(" "),
          pendiente.banco.nombre,
          cuenta.moneda ?? "EUR",
        ).id,
      };
    }),
  };
  const sustituidas = new Set(anteriores.filter((x) => x.cuentas.some((c) => conexion.cuentas.some((n) => mismaCuenta(c, n)))).map((x) => x.sessionId));
  config.conexiones = [...config.conexiones.filter((x) => x.sessionId !== conexion.sessionId && !sustituidas.has(x.sessionId)), conexion];
  guardarBancos(config);
  const informe = await sincronizarBancos(() => bd(estado), estado.hoy());
  return apuntarDesenlace(token, {
    ok: `${pendiente.banco.nombre} vinculado: ${conexion.cuentas.length} cuentas, ${informe.nuevos} movimientos traídos.`,
    ...(informe.errores.length ? { error: informe.errores.join(" · ") } : {}),
  });
}

export function rutasBancos(app: Hono, estado: Estado) {
  app.get("/bancos", async (c) => {
    const config = leerBancos();
    const configurado = Boolean(config.appId && hayClave());
    const cuentas = leerCuentas(bd(estado), estado.hoy());
    let bancos: Banco[] = [];
    let errorLista: string | null = null;
    if (configurado) {
      try {
        bancos = await bancosDisponibles();
      } catch (error) {
        errorLista = (error as Error).message;
      }
    }
    const guia = html`<ol>
      <li>Crea una cuenta gratuita en <a href="https://enablebanking.com/" target="_blank" rel="noopener noreferrer">enablebanking.com</a> y entra en su panel de control.</li>
      <li>
        Registra una aplicación de tipo <b>Production</b> (o <b>Sandbox</b> si antes quieres probar con un banco de mentira). El navegador genera la <b>clave privada</b>: se
        descarga un archivo <code>.pem</code> que debes guardar.
      </li>
      <li>
        Como dirección de vuelta (<i>redirect URL</i>) pon <code>${redireccionLocal(estado)}</code>. Si no la acepta, pon una tuya en https (p. ej.
        <code>https://example.com/calderilla</code>): después de autorizar en el banco tendrás que copiar la dirección y pegarla aquí.
      </li>
      <li>En el panel, vincula tus propias cuentas (<i>Link accounts</i>): así la aplicación queda en <b>modo restringido</b>, que es gratis para uso personal.</li>
      <li>Pega aquí el ID de la aplicación y sube el archivo <code>.pem</code>.</li>
    </ol>`;
    const formularioClave = html`<form method="post" action="/bancos/configurar" enctype="multipart/form-data" class="formulario" hx-boost="false">
      <div class="fila-campos">
        ${campo({ etiqueta: "ID de la aplicación", nombre: "appId", valor: config.appId, requerido: true, marcador: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })}
        <div class="campo">
          <label for="campo-pem">Clave privada (.pem)</label>
          <input id="campo-pem" type="file" name="pem" accept=".pem" ${configurado ? "" : html`required`} />
          <p class="ayuda">Se guarda solo en este ordenador${configurado ? ". Déjalo vacío para mantener la actual" : ""}.</p>
        </div>
      </div>
      <div class="botones"><button class="boton boton-principal" type="submit">Guardar</button></div>
    </form>`;

    return render(
      c,
      estado,
      { titulo: "Bancos", seccion: "ajustes" },
      html`
        <p><a href="/ajustes">← Ajustes</a></p>
        <p class="apagado">
          Conexión automática con tu banco (PSD2) a través de Enable Banking: gratis para uso personal y sin ninguna cuenta de Claude. Trae saldos y movimientos; no puede
          mover dinero. El permiso dura como mucho 180 días y después hay que renovarlo. Lo que se configura aquí vale solo para este ordenador.
        </p>
        ${aviso(
          "info",
          "Comprobado en octubre de 2026: CaixaBank, BBVA, Santander y Sabadell están en su lista de España; ING, Openbank, Revolut y Trade Republic, no. Algunos bancos solo permiten una sesión por persona: si lo vinculas también en el otro ordenador, puede desconectarse este.",
        )}
        ${configurado
          ? html`
              <section class="tarjeta">
                <div class="tarjeta-cabecera">
                  <h2>Bancos vinculados</h2>
                  ${config.conexiones.length ? botonAccion("/bancos/sincronizar", "Sincronizar ahora") : ""}
                </div>
                ${config.conexiones.length
                  ? config.conexiones.map((conexion) => {
                      const dias = diasParaCaducar(conexion);
                      return html`<article class="opcion bloque">
                        <h3>
                          ${conexion.banco}
                          <span class="etiqueta ${dias < 0 ? "etiqueta-no" : dias <= 14 ? "etiqueta-neutra" : "etiqueta-si"}">
                            ${dias < 0 ? "caducado" : `hasta el ${formatoFecha(conexion.validoHasta.slice(0, 10))}`}
                          </span>
                        </h3>
                        <p class="apagado pequeno">
                          ${conexion.ultimaSincronizacion ? `Última sincronización: ${new Date(conexion.ultimaSincronizacion).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` : "Aún sin sincronizar"}
                        </p>
                        <form method="post" action="/bancos/cuentas" class="formulario">
                          <input type="hidden" name="sesion" value="${conexion.sessionId}" />
                          ${conexion.cuentas.map((cuenta) =>
                            selector(
                              `${cuenta.nombre ?? "Cuenta"} ${ocultarIban(cuenta.iban)}`,
                              `cuenta_${cuenta.uid}`,
                              [["", "No sincronizar"], ...cuentas.map((x) => [String(x.id), x.nombre] as const)],
                              cuenta.cuentaId ? String(cuenta.cuentaId) : "",
                            ),
                          )}
                          <div class="botones">
                            <button class="boton boton-pequeno" type="submit">Guardar</button>
                          </div>
                        </form>
                        <p style="margin-top:8px">
                          ${botonAccion("/bancos/desvincular", "Desvincular", { estilo: "enlace", campos: { sesion: conexion.sessionId }, confirmar: `¿Desvincular ${conexion.banco}? Los movimientos ya traídos se quedan.` })}
                          ·
                          ${botonAccion("/bancos/desvincular", "Desvincular y borrar lo que trajo", {
                            estilo: "enlace",
                            campos: { sesion: conexion.sessionId, borrar: "1" },
                            confirmar: `¿Desvincular ${conexion.banco} y borrar los saldos y movimientos que trajo? Lo que apuntaste tú no se toca. Útil tras probar con un banco de prueba.`,
                          })}
                        </p>
                      </article>`;
                    })
                  : vacio("Aún no has vinculado ningún banco.")}
              </section>
              <section class="tarjeta">
                <h2>Conectar un banco</h2>
                ${errorLista ? aviso("error", `No se pudo pedir la lista de bancos: ${errorLista}`) : ""}
                ${bancos.length
                  ? html`<form method="post" action="/bancos/conectar" class="formulario">
                      ${selector(
                        "Banco",
                        "banco",
                        bancos.map((b) => [b.nombre, b.nombre] as const),
                        bancos.find((b) => /caixa/i.test(b.nombre))?.nombre ?? bancos[0]?.nombre,
                      )}
                      <div class="botones"><button class="boton boton-principal" type="submit">Continuar</button></div>
                    </form>`
                  : ""}
              </section>
              <section class="tarjeta">
                <details>
                  <summary>Cambiar el ID de la aplicación o la clave</summary>
                  ${guia} ${formularioClave}
                </details>
              </section>
            `
          : html`<section class="tarjeta">
              <h2>Configurar Enable Banking</h2>
              ${guia} ${formularioClave}
            </section>`}
      `,
    );
  });

  app.post("/bancos/configurar", async (c) => {
    const cuerpo = await c.req.parseBody();
    const appId = String(cuerpo.appId ?? "").trim();
    if (!/^[0-9a-f-]{20,}$/i.test(appId)) return redirigir(c, "/bancos", { error: "El ID de la aplicación tiene este aspecto: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee." });
    const pem = cuerpo.pem;
    if (pem instanceof File && pem.size > 0) {
      const texto = await pem.text();
      if (!texto.includes("PRIVATE KEY")) return redirigir(c, "/bancos", { error: "Ese archivo no parece una clave privada .pem." });
      guardarClave(texto);
    } else if (!hayClave()) {
      return redirigir(c, "/bancos", { error: "Sube el archivo .pem de la aplicación." });
    }
    guardarBancos({ ...leerBancos(), appId });
    listaBancos = null;
    return redirigir(c, "/bancos", { ok: "Guardado. Ya puedes conectar tu banco." });
  });

  app.post("/bancos/conectar", async (c) => {
    const nombre = (await Formulario.de(c)).texto("banco");
    const banco = (await bancosDisponibles()).find((b) => b.nombre === nombre);
    const api = cliente();
    if (!banco || !api) return redirigir(c, "/bancos", { error: "Elige un banco de la lista." });
    for (const [token, a] of autorizaciones) if (Date.now() - a.creado > 3_600_000) autorizaciones.delete(token);
    const token = randomBytes(16).toString("hex");
    autorizaciones.set(token, { banco, creado: Date.now() });
    let url: string;
    try {
      url = await api.iniciar(banco, redireccionLocal(estado), token);
    } catch (error) {
      return redirigir(c, "/bancos", { error: (error as Error).message });
    }
    // Un enlace (no una redirección) para que el navegador no bloquee la salida a la web del banco
    return render(
      c,
      estado,
      { titulo: `Autorizar ${banco.nombre}`, seccion: "ajustes" },
      html`<section class="tarjeta">
        <p>
          Se abrirá ${banco.nombre} en una pestaña nueva para que autorices el acceso de solo lectura. Esta pestaña se queda esperando y se actualiza sola cuando
          termines.
        </p>
        <p><a class="boton boton-principal" href="${url}" target="_blank" rel="noopener noreferrer">Ir a ${banco.nombre}</a></p>
        <p class="apagado" data-esperar-autorizacion="${token}">Esperando a que autorices en la otra pestaña…</p>
        <details style="margin-top:16px">
          <summary>¿El banco te ha dejado en otra página?</summary>
          <p class="apagado">Si registraste una dirección de vuelta que no es la de Calderilla, copia la dirección completa de esa página (la que lleva <code>?code=</code>) y pégala aquí.</p>
          <form method="post" action="/bancos/volver-manual" class="formulario">
            ${campo({ etiqueta: "Dirección a la que te devolvió el banco", nombre: "url", requerido: true })}
            <div class="botones"><button class="boton" type="submit">Terminar</button></div>
          </form>
        </details>
      </section>`,
    );
  });

  // El banco vuelve en su pestaña: aquí solo se confirma; la pestaña de Calderilla se entera sola
  app.get("/bancos/volver", async (c) => {
    const desenlace = await terminar(estado, c.req.query("code"), c.req.query("state"), c.req.query("error_description") ?? c.req.query("error"));
    return render(
      c,
      estado,
      { titulo: desenlace.ok ? "Banco vinculado" : "No se pudo vincular el banco", seccion: "ajustes" },
      html`<section class="tarjeta">
        ${desenlace.ok ? aviso("logro", desenlace.ok) : ""} ${desenlace.error ? aviso("error", desenlace.error) : ""}
        <p>Ya puedes cerrar esta pestaña: la de Calderilla se ha actualizado sola.</p>
        <p class="apagado pequeno"><a href="/bancos">O sigue aquí, en Bancos</a></p>
      </section>`,
    );
  });

  app.get("/bancos/autorizacion/:token", (c) => {
    const token = c.req.param("token");
    const desenlace = desenlaces.get(token);
    if (desenlace) return c.json({ estado: "hecha", ok: desenlace.ok ?? null, error: desenlace.error ?? null });
    return c.json({ estado: autorizaciones.has(token) ? "pendiente" : "desconocida" });
  });

  app.post("/bancos/volver-manual", async (c) => {
    try {
      const url = new URL((await Formulario.de(c)).texto("url"));
      const desenlace = await terminar(estado, url.searchParams.get("code") ?? undefined, url.searchParams.get("state") ?? undefined, url.searchParams.get("error") ?? undefined);
      return redirigir(c, "/bancos", desenlace);
    } catch {
      return redirigir(c, "/bancos", { error: "Esa dirección no es válida: copia la dirección completa de la barra del navegador." });
    }
  });

  app.post("/bancos/cuentas", async (c) => {
    const f = await Formulario.de(c);
    const config = leerBancos();
    const conexion = config.conexiones.find((x) => x.sessionId === f.texto("sesion"));
    if (!conexion) return redirigir(c, "/bancos", { error: "No encuentro esa conexión." });
    for (const cuenta of conexion.cuentas) cuenta.cuentaId = f.entero(`cuenta_${cuenta.uid}`);
    guardarBancos(config);
    return redirigir(c, "/bancos", { ok: "Cuentas guardadas." });
  });

  app.post("/bancos/sincronizar", async (c) => {
    const informe = await sincronizarBancos(() => bd(estado), estado.hoy());
    return redirigir(c, "/bancos", {
      ok: `Sincronizadas ${informe.cuentas} cuentas: ${informe.nuevos} movimientos nuevos.`,
      ...(informe.errores.length ? { error: informe.errores.join(" · ") } : {}),
    });
  });

  app.post("/bancos/desvincular", async (c) => {
    const f = await Formulario.de(c);
    const sesion = f.texto("sesion");
    const config = leerBancos();
    const conexion = config.conexiones.find((x) => x.sessionId === sesion);
    let borrados = 0;
    if (conexion && f.casilla("borrar")) borrados = borrarLoTraido(bd(estado), conexion.cuentas.map((x) => x.cuentaId).filter((id): id is number => id !== null));
    try {
      await cliente()?.borrarSesion(sesion);
    } catch {
      // Si ya había caducado en el banco, basta con olvidarla aquí
    }
    config.conexiones = config.conexiones.filter((x) => x.sessionId !== sesion);
    guardarBancos(config);
    return redirigir(c, "/bancos", { ok: f.casilla("borrar") ? `Banco desvinculado y borrado lo que trajo (${borrados} movimientos).` : "Banco desvinculado." });
  });
}
