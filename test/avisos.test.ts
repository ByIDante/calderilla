import assert from "node:assert/strict";
import { it } from "node:test";
import type { Resultado } from "../src/reglas/tipos.ts";
import { claveAviso } from "../src/servidor/vistas/comun.ts";
import { listaAvisos } from "../src/servidor/vistas/escalera.ts";

it("los avisos llevan ✕ y los cerrados no vuelven mientras su texto no cambie", async () => {
  const r = { avisos: [{ nivel: "info", texto: "En marzo terminas «Coche»" }, { nivel: "logro", texto: "¡Has superado «Colchón mínimo»!" }] } as Resultado;
  const todos = String(await listaAvisos(r, new Set()));
  assert.match(todos, /action="\/avisos\/ocultar"/);
  assert.equal((todos.match(/class="aviso aviso-/g) ?? []).length, 2);
  const sinElCerrado = String(await listaAvisos(r, new Set([claveAviso("¡Has superado «Colchón mínimo»!")])));
  assert.equal((sinElCerrado.match(/class="aviso aviso-/g) ?? []).length, 1);
  assert.doesNotMatch(sinElCerrado, /Colchón mínimo/);
  assert.notEqual(claveAviso("En marzo terminas «Coche»"), claveAviso("En abril terminas «Coche»"), "si cambia la situación, vuelve a salir");
});
