// Comprueba la prueba en el Chrome del sistema (como un móvil) antes de llevarla a los móviles de verdad.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const puerto = 5199;
const servidor = spawn(process.execPath, [path.join(import.meta.dirname, "servir.ts"), String(puerto)], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 600));
const base = `http://localhost:${puerto}`;
const fallos: string[] = [];
const comprobar = (cierto: boolean, texto: string) => {
  console.log(`  ${cierto ? "✓" : "✗"} ${texto}`);
  if (!cierto) fallos.push(texto);
};

const navegador = await chromium.launch({ channel: "chrome" });
const contexto = await navegador.newContext({ ...devices["Pixel 7"] });
const pagina = await contexto.newPage();
const errores: string[] = [];
pagina.on("pageerror", (e) => errores.push(e.message));

await pagina.goto(base);
await pagina.waitForSelector("text=Funciona en tu móvil", { timeout: 15000 });
comprobar(true, "la primera vez se instala el service worker y la página la sirve él");
const tiempos = await (await pagina.goto(`${base}/tiempos`))!.text();
comprobar(/arrancar SQLite/.test(tiempos), "SQLite (WebAssembly) arranca dentro del service worker");

await pagina.goto(base);
await pagina.fill("input[name=concepto]", "Café");
await pagina.fill("input[name=importe]", "1,80");
await pagina.click("button:has-text('Guardar')");
await pagina.waitForURL(/guardado=1/);
comprobar(/Café · 1\.80 €/.test((await pagina.textContent("main")) ?? ""), "guardar con un formulario normal y volver con una redirección 303");

// Se para el service worker (como hace el móvil al cerrar la app): los datos tienen que seguir
const cdp = await contexto.newCDPSession(pagina);
await cdp.send("ServiceWorker.enable");
await cdp.send("ServiceWorker.stopAllWorkers");
await pagina.reload();
comprobar(/Café · 1\.80 €/.test((await pagina.textContent("main")) ?? ""), "con el service worker parado y vuelto a arrancar, el apunte sigue (IndexedDB)");
const arranques = Number(/Arranques[^<]*<b>(\d+)/.exec((await (await pagina.goto(`${base}/tiempos`))!.text()))?.[1]);
comprobar(arranques >= 2, `el service worker se volvió a arrancar (${arranques} arranques)`);

await contexto.setOffline(true);
await pagina.goto(base);
comprobar(/Café · 1\.80 €/.test((await pagina.textContent("main")) ?? ""), "sin conexión también funciona");
await contexto.setOffline(false);

await pagina.goto(`${base}/cabeceras`);
await pagina.click("button:has-text('Enviar (navegación)')");
const navegacion = (await pagina.textContent("main")) ?? "";
comprobar(/modenavigate/.test(navegacion.replace(/\s+/g, "")) && /referrerhttp:\/\/localhost/.test(navegacion.replace(/\s+/g, "")), "un formulario normal llega como navegación y con referrer de nuestra web");
console.log("    lo que ve:", navegacion.replace(/\s+/g, " ").slice(0, 400));
await pagina.goto(`${base}/cabeceras`);
await pagina.click("button:has-text('Enviar (fetch')");
await pagina.waitForSelector("[data-resultado-fetch] table");
const porFetch = ((await pagina.textContent("[data-resultado-fetch]")) ?? "").replace(/\s+/g, " ");
comprobar(/mode\s*(cors|same-origin)/.test(porFetch), `una petición como las de htmx llega con mode de fetch (${/mode\s*(cors|same-origin|navigate|no-cors)/.exec(porFetch)?.[1]})`);
console.log("    lo que ve:", porFetch.slice(0, 300));
await pagina.goto(`${base}/cabeceras/redirigir`);
comprobar(pagina.url().endsWith("/cabeceras/llegada?desde=redireccion"), "una redirección 303 del service worker cambia la dirección");

const csv = path.join(os.tmpdir(), "prueba-calderilla.csv");
writeFileSync(csv, "fecha;concepto;importe\n2026-10-01;MERCADONA;-54,30\n");
await pagina.goto(`${base}/subir`);
await pagina.setInputFiles("form[enctype] input[type=file]", csv);
await pagina.click("form[enctype] button");
comprobar(/Llegó «prueba-calderilla\.csv»: 51 bytes/.test((await pagina.textContent("main")) ?? ""), "subir un archivo con un formulario multipart (en Chrome)");
await pagina.goto(`${base}/subir`);
await pagina.setInputFiles("[data-subir-crudo]", csv);
await pagina.waitForSelector("[data-resultado-crudo] .ok");
comprobar(/"bytes":51/.test((await pagina.textContent("[data-resultado-crudo]")) ?? ""), "subir un archivo leído en la página y enviado en crudo");

comprobar(errores.length === 0, `sin errores en la página${errores.length ? `: ${errores.join("; ")}` : ""}`);
await navegador.close();
servidor.kill();
console.log(fallos.length ? `\n${fallos.length} fallos` : "\nTodo bien");
process.exitCode = fallos.length ? 1 : 0;
