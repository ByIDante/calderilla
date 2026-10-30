import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { versionInstalada } from "../src/config/version.ts";
import { appDePrueba } from "./ayuda-app.ts";

const raiz = mkdtempSync(path.join(os.tmpdir(), "calderilla-version-"));
const app = appDePrueba(5194);
after(() => {
  app.estado.sync?.cerrar();
  rmSync(raiz, { recursive: true, force: true });
  rmSync(app.carpeta, { recursive: true, force: true });
});

it("lee la versión instalada de la carpeta .git (suelta o empaquetada)", () => {
  assert.equal(versionInstalada(raiz), null, "sin .git (descarga en ZIP)");
  mkdirSync(path.join(raiz, ".git", "refs", "heads"), { recursive: true });
  writeFileSync(path.join(raiz, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(raiz, ".git", "packed-refs"), "# pack-refs\naaa111 refs/heads/main\n");
  assert.equal(versionInstalada(raiz), "aaa111");
  writeFileSync(path.join(raiz, ".git", "refs", "heads", "main"), "bbb222\n");
  assert.equal(versionInstalada(raiz), "bbb222", "la referencia suelta manda sobre la empaquetada");
});

it("con una versión nueva instalada avisa y se puede reiniciar desde la app", async () => {
  app.estado.versionNueva = "instalada";
  assert.match(await (await app.pedir("/")).text(), /Hay una versión nueva de Calderilla instalada/);
  let reiniciada = false;
  app.estado.reiniciar = () => {
    reiniciada = true;
  };
  const respuesta = await app.pedir("/reiniciar", {});
  assert.match(await respuesta.text(), /http-equiv="refresh"/);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(reiniciada);
});
