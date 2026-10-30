import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, it } from "node:test";
import { guardarSaldo } from "../src/servicios/cuentas.ts";
import { construir } from "../src/servicios/situacion.ts";
import { appDePrueba } from "./ayuda-app.ts";

const { bd, pedir, carpeta, estado } = appDePrueba(5196);
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});

it("una meta unida a una cuenta toma lo ahorrado de su saldo", async () => {
  const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Viaje', 'remunerada')").id;
  guardarSaldo(bd, cuenta, "2026-10-01", 120000);
  assert.equal((await pedir("/metas", { nombre: "Japón", objetivo: "4000", fecha: "2028-06-01", ahorrado: "0", cuenta: String(cuenta) })).status, 303);
  assert.equal(construir(bd, "2026-10-30").situacion.metas[0]?.ahorrado, 120000);
  assert.match(await (await pedir("/metas")).text(), /Unida a la cuenta «Viaje»/);

  guardarSaldo(bd, cuenta, "2026-10-20", 900000);
  assert.equal(construir(bd, "2026-10-30").situacion.metas[0]?.ahorrado, 400000, "como mucho, el objetivo");

  const meta = bd.uno<{ id: number }>("SELECT id FROM metas")!.id;
  await pedir(`/metas/${meta}/cuenta`, { cuenta: "" });
  assert.equal(construir(bd, "2026-10-30").situacion.metas[0]?.ahorrado, 0, "sin cuenta, vuelve a lo apuntado a mano");
});
