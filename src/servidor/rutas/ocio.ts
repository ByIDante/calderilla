import type { Hono } from "hono";
import { html } from "hono/html";
import { formatoFecha, mesDe, nombreMes, primerDia, ultimoDia } from "../../dominio/fechas.ts";
import { NOMBRE_ETAPA } from "../../reglas/tipos.ts";
import { leerAportaciones, totalMensual } from "../../servicios/aportaciones.ts";
import { contexto } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, cifra, eur, eurR, porque, selector, vacio } from "../vistas/comun.ts";

interface Apunte {
  id: number;
  fecha: string;
  importe: number;
  concepto: string;
  categoria: string | null;
  tipo: string | null;
}

export function rutasOcio(app: Hono, estado: Estado) {
  app.get("/ocio", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
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

    const filasCalculo: [string, number, string?][] = [
      ["Ingresos al mes", p.ingresos],
      ["− Gastos esenciales", -p.esenciales],
      ["− Gastos no esenciales", -p.noEsenciales],
      ["= Te sobra", p.sobrante],
      [`− Ahorro de la etapa «${NOMBRE_ETAPA[ctx.resultado.etapa]}»`, -(p.objetivoAhorro - p.paraMetas), [`un ${proporcion} % de lo que sobra`, p.cuotaLiberada ? `más la cuota liberada de ${eurR(p.cuotaLiberada)}` : "", automatico ? `tu ahorro automático cubre ${eurR(automatico)}` : ""].filter(Boolean).join(", ")],
      ...(p.paraMetas ? [["− Para tus metas", -p.paraMetas] as [string, number]] : []),
      ["= Ocio previsto", p.ocioPlan],
      ...(p.correccion ? [["− Corrección por los cierres", -p.correccion, "ahorraste menos de lo previsto en 2 de los 3 últimos cierres"] as [string, number, string]] : []),
      ...(p.ocioRemanente ? [["+ Lo que te sobró del mes pasado", p.ocioRemanente] as [string, number]] : []),
      ["− Ya gastado en ocio este mes", -p.ocioGastado],
      ["= Te queda", p.ocioQueda],
    ];

    return render(
      c,
      estado,
      { titulo: `Ocio de ${nombreMes(mes)}`, seccion: "ocio" },
      html`
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
            <div class="tabla-contenedor"><table>
              <tbody>
                ${filasCalculo.map(
                  ([texto, valor, nota]) => html`<tr>
                    <td>${texto}${nota ? html`<div class="apagado pequeno">${nota}</div>` : ""}</td>
                    <td class="numero ${texto.startsWith("=") ? "" : "apagado"}">${texto.startsWith("=") ? html`<b>${eur(valor)}</b>` : eur(valor)}</td>
                  </tr>`,
                )}
              </tbody>
            </table></div>
            ${porque(
              "Primero se cubren los gastos y el ahorro que pide tu etapa de la escalera; lo que queda es para disfrutarlo sin culpa. Al subir de etapa se ahorra una parte menor de lo que sobra, así que el ocio crece. Si en los cierres de mes ahorras menos de lo previsto, es que hay gastos sin apuntar: el ocio baja hasta que cuadre. De lo que no gastes, la mitad pasa al mes siguiente.",
            )}
          </section>
        </div>
        <section class="tarjeta" style="margin-top:16px">
          <div class="tarjeta-cabecera"><h2>Movimientos de este mes</h2><span><a href="/movimientos">Ver y editar todos</a> · <a href="/importar">Importar un extracto</a></span></div>
          ${apuntes.length
            ? html`<div class="tabla-contenedor">
                <table>
                  <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="numero">Importe</th><th></th></tr></thead>
                  <tbody>
                    ${apuntes.map(
                      (a) => html`<tr>
                        <td>${formatoFecha(a.fecha)}</td><td>${a.concepto}</td><td>${a.categoria ?? "—"}${a.tipo === "ocio" ? "" : html` <span class="apagado pequeno">(no es ocio)</span>`}</td>
                        <td class="numero">${eur(-a.importe)}</td>
                        <td>${botonAccion(`/apuntes/${a.id}/borrar`, "Borrar", { estilo: "enlace", confirmar: "¿Borrar este apunte?" })}</td>
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
