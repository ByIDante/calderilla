import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, it } from "node:test";
import { appDePrueba } from "./ayuda-app.ts";

const { estado, pedir, enviarArchivo, carpeta } = appDePrueba(5195);
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});
const bd = () => estado.sync!.bd;
const cuentas = () => bd().todos<{ nombre: string }>("SELECT nombre FROM cuentas ORDER BY nombre").map((c) => c.nombre);

it("restaurar una copia anterior y volver atrás; exportar e importar el JSON", async () => {
  bd().ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Antigua', 'corriente')");
  estado.sync!.comprobar();
  const [primera] = estado.sync!.listar().copias;
  // Una copia por segundo: el nombre lleva la hora
  await new Promise((r) => setTimeout(r, 1100));
  bd().ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nueva', 'corriente')");
  estado.sync!.comprobar();
  assert.deepEqual(cuentas(), ["Antigua", "Nueva"]);

  assert.match(await (await pedir("/ajustes/copias")).text(), /Volver a esta/);
  assert.equal((await pedir("/ajustes/copias/restaurar", { archivo: primera!.archivo })).status, 303);
  assert.deepEqual(cuentas(), ["Antigua"], "vuelve a los datos de la primera copia");
  assert.equal(estado.sync!.estado.tipo, "ok", "lo restaurado se guarda como versión nueva, sin conflicto");
  const apartada = estado.sync!.listar().rastros.find((r) => r.archivo.endsWith(".db"));
  assert.ok(apartada, "lo de antes queda apartado");
  await pedir("/ajustes/copias/restaurar", { archivo: apartada!.archivo });
  assert.deepEqual(cuentas(), ["Antigua", "Nueva"], "y se puede deshacer");

  const exportado = await (await pedir("/ajustes/exportar")).text();
  bd().ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Posterior', 'corriente')");
  const formulario = new FormData();
  formulario.append("archivo", new File([exportado], "calderilla.json", { type: "application/json" }));
  const respuesta = await enviarArchivo("/ajustes/copias/importar", formulario);
  assert.equal(respuesta.status, 303);
  assert.deepEqual(cuentas(), ["Antigua", "Nueva"], "el JSON sustituye los datos");
  assert.equal(bd().uno<{ n: number }>("SELECT count(*) AS n FROM categorias")?.n, 17, "con todas sus tablas");
});
