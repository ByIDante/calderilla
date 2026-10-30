import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { formatoFecha, mesDe, nombreMes, primerDia, sumarMesesAMes, ultimoDia } from "../../dominio/fechas.ts";
import { NOMBRE_ETAPA } from "../../reglas/tipos.ts";
import { leerAportaciones, totalMensual } from "../../servicios/aportaciones.ts";
import { contexto, ocioGastadoEn } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, cifra, eur, eurR, porque, selector, vacio } from "../vistas/comun.ts";
import { barraReparto, medidorOcio } from "../vistas/reparto.ts";

interface Apunte {
  id: number;
  fecha: string;
  importe: number;
  concepto: string;
  categoria: string | null;
  tipo: string | null;
}

/** El ocio de un mes ya pasado: lo previsto en su cierre y lo gastado. */
function ocioPasado(c: Context, estado: Estado, mes: string) {
  const base = bd(estado);
  const cierre = base.uno<{ ocio_plan: number; ocio_gastado: number; ocio_sobrante: number }>("SELECT ocio_plan, ocio_gastado, ocio_sobrante FROM cierres_mes WHERE mes = ?", mes);
  const apuntes = base.todos<Apunte>(
    `SELECT a.id, a.fecha, a.importe, a.concepto, c.nombre AS categoria, c.tipo FROM apuntes a JOIN categorias c ON c.id = a.categoria_id
     WHERE c.tipo = 'ocio' AND a.recurrente_id IS NULL AND a.fecha BETWEEN ? AND ? ORDER BY a.fecha DESC`,
    primerDia(mes),
    ultimoDia(mes),
  );
  const gastado = ocioGastadoEn(base, ultimoDia(mes));
  const siguiente = sumarMesesAMes(mes, 1);
  return render(
    c,
    estado,
    { titulo: `Ocio de ${nombreMes(mes)}`, seccion: "ocio" },
    html`
      <div class="botones bloque">
        <a class="boton boton-pequeno" href="/ocio?mes=${sumarMesesAMes(mes, -1)}">← ${nombreMes(sumarMesesAMes(mes, -1))}</a>
        <a class="boton boton-pequeno" href="${siguiente >= mesDe(estado.hoy()) ? "/ocio" : `/ocio?mes=${siguiente}`}">${nombreMes(siguiente)} →</a>
      </div>
      <div class="cifras">
        ${cifra("Gastado en ocio", eurR(gastado))}
        ${cierre ? cifra("Previsto", eurR(cierre.ocio_plan), gastado > cierre.ocio_plan ? "te pasaste" : `sobraron ${eurR(cierre.ocio_plan - gastado)}`, gastado > cierre.ocio_plan ? "mal" : "bien") : cifra("Previsto", "—", "este mes no se cerró")}
        ${cierre?.ocio_sobrante ? cifra("Pasó al mes siguiente", eurR(cierre.ocio_sobrante)) : ""}
      </div>
      <section class="tarjeta">
        <h2>Gastos de ocio</h2>
        ${apuntes.length
          ? html`<ul class="lista-plana">
              ${apuntes.map((a) => html`<li><span>${formatoFecha(a.fecha)} · ${a.concepto} <span class="apagado pequeno">${a.categoria}</span></span><span class="numero">${eur(-a.importe)}</span></li>`)}
            </ul>`
          : vacio("No hay gastos de ocio apuntados ese mes.")}
        <p><a href="/movimientos?mes=${mes}">Ver todos los movimientos de ${nombreMes(mes)}</a></p>
      </section>
    `,
  );
}

export function rutasOcio(app: Hono, estado: Estado) {
  app.get("/ocio", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const pedido = c.req.query("mes") ?? "";
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) && pedido < mesDe(hoy)) return ocioPasado(c, estado, pedido);
    const ctx = contexto(base, hoy);
    const p = ctx.resultado.presupuesto;
    const mes = mesDe(hoy);
    const apuntes = base.todos<Apunte>(
      `SELECT a.id, a.fecha, a.importe, a.concepto, c.nombre AS categoria, c.tipo FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id
       WHERE a.fecha BETWEEN ? AND ? ORDER BY a.fecha DESC, a.id DESC`,
      primerDia(mes),
      ultimoDia(mes),
    );
    const categorias = base.todos<{ id: number; nombre: string; tipo: string }>("SELECT id, nombre, tipo FROM categorias WHERE archivada = 0 AND tipo != 'ingreso' ORDER BY tipo != 'ocio', nombre");
    const automatico = totalMensual(leerAportaciones(base), mes);
    const proporcion = p.sobrante > 0 ? Math.round(((p.objetivoAhorro - p.cuotaLiberada) / Math.max(p.sobrante - p.cuotaLiberada, 1)) * 100) : 0;

    // [texto, importe, nota, tramo de color de la barra de reparto]
    type Fila = [string, number, string?, number?];
    const filasCalculo: Fila[] = [
      ["Ingresos al mes", p.ingresos],
      ["− Gastos esenciales", -p.esenciales, undefined, 1],
      ["− Gastos no esenciales", -p.noEsenciales, undefined, 2],
      ["= Te sobra", p.sobrante],
      [
        `− Ahorro de la etapa «${NOMBRE_ETAPA[ctx.resultado.etapa]}»`,
        -(p.objetivoAhorro - p.paraMetas),
        [`un ${proporcion} % de lo que sobra`, p.cuotaLiberada ? `más la cuota liberada de ${eurR(p.cuotaLiberada)}` : "", automatico ? `tu ahorro automático cubre ${eurR(automatico)}` : ""].filter(Boolean).join(", "),
        3,
      ],
      ...(p.paraMetas ? [["− Para tus metas", -p.paraMetas, undefined, 4] as Fila] : []),
      ["= Ocio previsto", p.ocioPlan, undefined, 5],
      ...(p.correccion ? [["− Corrección por los cierres", -p.correccion, "ahorraste menos de lo previsto en 2 de los 3 últimos cierres"] as Fila] : []),
      ...(p.ocioRemanente ? [["+ Lo que te sobró del mes pasado", p.ocioRemanente] as Fila] : []),
      ["− Ya gastado en ocio este mes", -p.ocioGastado],
      ["= Te queda", p.ocioQueda],
    ];

    return render(
      c,
      estado,
      { titulo: `Ocio de ${nombreMes(mes)}`, seccion: "ocio" },
      html`
        <div class="botones bloque"><a class="boton boton-pequeno" href="/ocio?mes=${sumarMesesAMes(mes, -1)}">← ${nombreMes(sumarMesesAMes(mes, -1))}</a></div>
        <div class="cifras">
          ${cifra("Te queda para ocio", eurR(p.ocioQueda), `hasta fin de mes`, p.ocioQueda < 0 ? "mal" : "acento")} ${cifra("Ocio del mes", eurR(p.ocio + p.ocioRemanente))}
          ${cifra("Gastado", eurR(p.ocioGastado))} ${cifra("Ocio mínimo", eurR(p.ocioMinimo), "nunca baja de aquí si te sobra dinero")}
        </div>
        <div class="rejilla">
          <section class="tarjeta">
            <h2>Apuntar un gasto de ocio</h2>
            <form method="post" action="/ocio/apunte" class="formulario">
              <div class="fila-campos">
                ${campo({ etiqueta: "Importe", nombre: "importe", sufijo: "€", requerido: true })} ${campo({ etiqueta: "Fecha", nombre: "fecha", tipo: "date", valor: hoy })}
              </div>
              ${campo({ etiqueta: "Concepto", nombre: "concepto", marcador: "Cena, cine, concierto…" })}
              ${selector(
                "Categoría",
                "categoria",
                categorias.map((x) => [String(x.id), `${x.nombre}${x.tipo === "ocio" ? "" : " (no cuenta como ocio)"}`] as const),
                String(categorias[0]?.id ?? ""),
              )}
              <div class="botones"><button class="boton boton-principal" type="submit">Apuntar</button></div>
            </form>
          </section>
          <section class="tarjeta">
            <h2>Cómo se calcula</h2>
            ${p.sobrante < 0
              ? html`<p class="negativo"><b>Gastas ${eurR(-p.sobrante)} al mes más de lo que ingresas:</b> no queda nada para ahorro ni ocio.</p>`
              : ""}
            ${barraReparto(p)} ${medidorOcio(p)}
            <details class="como-tabla" style="margin-top:10px">
              <summary>Ver el cálculo paso a paso</summary>
              <div class="tabla-contenedor"><table>
                <tbody>
                  ${filasCalculo.map(
                    ([texto, valor, nota, tramo]) => html`<tr class="${texto.startsWith("=") ? "fila-total" : ""}">
                      <td>
                        ${tramo ? html`<span class="muestra tramo-${tramo}" aria-hidden="true"></span>` : ""}${texto}${nota ? html`<div class="apagado pequeno">${nota}</div>` : ""}
                      </td>
                      <td class="numero ${texto === "= Te queda" ? (valor < 0 ? "negativo" : "positivo") : texto.startsWith("=") ? "" : "apagado"}">
                        ${texto.startsWith("=") ? html`<b>${eur(valor)}</b>` : eur(valor)}
                      </td>
                    </tr>`,
                  )}
                </tbody>
              </table></div>
            </details>
            ${porque(
              "Primero se cubren los gastos y el ahorro que pide tu etapa de la escalera; lo que queda es para disfrutarlo sin culpa. Al subir de etapa se ahorra una parte menor de lo que sobra, así que el ocio crece. Si en los cierres de mes ahorras menos de lo previsto, es que hay gastos sin apuntar: el ocio baja hasta que cuadre. De lo que no gastes, la mitad pasa al mes siguiente.",
            )}
          </section>
        </div>
        <section class="tarjeta" style="margin-top:16px">
          <div class="tarjeta-cabecera"><h2>Movimientos de este mes</h2><span><a href="/movimientos">Ver y editar todos</a> · <a href="/importar">Importar un extracto</a></span></div>
          ${apuntes.length
            ? html`<div class="tabla-contenedor">
                <table class="tabla-apilable tabla-acciones">
                  <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="numero">Importe</th><th></th></tr></thead>
                  <tbody>
                    ${apuntes.map(
                      (a) => html`<tr>
                        <td>${formatoFecha(a.fecha)}</td><td>${a.concepto}</td><td>${a.categoria ?? "—"}${a.tipo === "ocio" ? "" : html` <span class="apagado pequeno">(no es ocio)</span>`}</td>
                        <td class="numero">${eur(-a.importe)}</td>
                        <td class="celda-boton">${botonAccion(`/apuntes/${a.id}/borrar`, "Borrar", { estilo: "peligro", pequeno: true, mantenerPosicion: true, confirmar: "¿Borrar este apunte?" })}</td>
                      </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : vacio("Aún no hay movimientos este mes. Apunta tus gastos de ocio o importa el extracto de tu banco.")}
        </section>
      `,
    );
  });

  app.post("/ocio/apunte", async (c) => {
    const f = await Formulario.de(c);
    const importe = f.importe("importe");
    if (!importe || importe <= 0) return redirigir(c, "/ocio", { error: "Indica el importe del gasto." });
    const fecha = f.fecha("fecha") ?? estado.hoy();
    const categoria = f.entero("categoria");
    bd(estado).ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, origen) VALUES (?, ?, ?, ?, 'manual')", fecha, -importe, f.texto("concepto") || "Ocio", categoria);
    return redirigir(c, "/ocio", { ok: `Apuntado: ${eur(importe)}.` });
  });

  app.post("/apuntes/:id/borrar", (c) => {
    bd(estado).ejecutar("DELETE FROM apuntes WHERE id = ?", idDe(c));
    return redirigir(c, "/ocio", { ok: "Apunte borrado." });
  });
}
