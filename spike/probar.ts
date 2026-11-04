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
await pagina.fill("input[name=importe]", "1.234,5");
await pagina.click("button:has-text('Guardar')");
await pagina.waitForURL(/guardado=1/);
comprobar(/Café · 1\.234,50\s€/.test((await pagina.textContent("main")) ?? ""), "guardar con un formulario normal y volver con una redirección 303, con el importe leído y escrito como en el PC");
comprobar(/✓/.test((await pagina.textContent("[data-formato]")) ?? ""), "los importes salen como en el PC");

// Se para el service worker (como hace el móvil al cerrar la app): los datos tienen que seguir
const cdp = await contexto.newCDPSession(pagina);
await cdp.send("ServiceWorker.enable");
await cdp.send("ServiceWorker.stopAllWorkers");
await pagina.reload();
comprobar(/Café · 1\.234,50\s€/.test((await pagina.textContent("main")) ?? ""), "con el service worker parado y vuelto a arrancar, el apunte sigue (IndexedDB)");
const arranques = Number(/Arranques[^<]*<b>(\d+)/.exec((await (await pagina.goto(`${base}/tiempos`))!.text()))?.[1]);
comprobar(arranques >= 2, `el service worker se volvió a arrancar (${arranques} arranques)`);

await contexto.setOffline(true);
await pagina.goto(base);
comprobar(/Café · 1\.234,50\s€/.test((await pagina.textContent("main")) ?? ""), "sin conexión también funciona");
await contexto.setOffline(false);

const textoDe = async (selector = "main") => ((await pagina.textContent(selector)) ?? "").replace(/\s+/g, " ");
await pagina.goto(`${base}/cabeceras`);
await pagina.click("button:has-text('Enviar (formulario normal)')");
const normal = await textoDe();
comprobar(/✓ Ha llegado como un formulario normal/.test(normal) && /✓ El service worker sabe que viene/.test(normal), "un formulario normal llega como navegación y con referrer de nuestra web");
await pagina.click("text=Probar ahora una redirección");
comprobar(pagina.url().endsWith("/cabeceras/llegada?desde=redireccion") && /✓ La dirección ahora es/.test(await textoDe()), "una redirección 303 del service worker cambia la dirección");

await pagina.goto(`${base}/cabeceras`);
await pagina.click("button:has-text('Enviar con htmx')");
await pagina.waitForSelector("#resultado-htmx .ok");
const conHtmx = await textoDe("#resultado-htmx");
comprobar(/✓ htmx funciona/.test(conHtmx) && /✓ El service worker sabe que viene/.test(conHtmx), "htmx cambia un trozo de la página y el service worker sabe que viene de la app");
await pagina.click("button:has-text('Guardar con htmx')");
await pagina.waitForSelector("[data-direccion] p");
const guardado = await textoDe();
comprobar(/✓ Guardado con htmx y redirigido/.test(guardado) && /✓ La dirección ahora es \/cabeceras\/llegada\?desde=htmx/.test(guardado), "guardar con htmx y redirigir, sin recargar, y la dirección cambia");

const csv = path.join(os.tmpdir(), "prueba-calderilla.csv");
writeFileSync(csv, "fecha;concepto;importe\n2026-10-01;SUPERMERCADO;-54,30\n");
await pagina.goto(`${base}/subir`);
await pagina.setInputFiles("form[enctype] input[type=file]", csv);
await pagina.click("form[enctype] button");
comprobar(/✓ Ha llegado entero: «prueba-calderilla\.csv», 54 bytes/.test(await textoDe()), "subir un archivo con un formulario multipart (en Chrome)");
await pagina.goto(`${base}/subir`);
for (const filtro of ["amplio", "todo"]) {
  await pagina.setInputFiles(`[data-subir-crudo="${filtro}"]`, csv);
  await pagina.waitForSelector(`[data-resultado-crudo="${filtro}"] p`);
  comprobar(/✓ Ha llegado entero/.test(await textoDe(`[data-resultado-crudo="${filtro}"]`)), `subir un archivo leído en la página y enviado en crudo (filtro ${filtro})`);
}

await pagina.goto(`${base}/compartir`);
await pagina.waitForSelector("text=/Listo para compartir|no tiene el menú/");
const [descarga] = await Promise.all([pagina.waitForEvent("download"), pagina.click("text=Descargar el JSON")]);
comprobar(descarga.suggestedFilename() === "calderilla-prueba.json", "descargar el JSON como «Exportar» del PC");
const [descargaCsv] = await Promise.all([pagina.waitForEvent("download"), pagina.click("text=Descargar en CSV")]);
comprobar(descargaCsv.suggestedFilename() === "calderilla-prueba.csv", "descargar en CSV");
const enCsv = await pagina.evaluate(async () => (await fetch("/compartir/archivo.csv")).text());
comprobar(/^fecha;concepto;importe\n.*;Café;1234,50$/.test(enCsv), "el CSV para compartir sale con los apuntes");

await pagina.goto(`${base}/drive`);
await pagina.click("button:has-text('Probar CoinGecko')");
const precios = await textoDe();
comprobar(/✓ CoinGecko/.test(precios) && /✓ BCE/.test(precios) && /✓ Frankfurter/.test(precios), `los precios responden desde el service worker${/✗/.test(precios) ? `: ${precios.slice(0, 300)}` : ""}`);

comprobar(errores.length === 0, `sin errores en la página${errores.length ? `: ${errores.join("; ")}` : ""}`);
await navegador.close();
servidor.kill();
console.log(fallos.length ? `\n${fallos.length} fallos` : "\nTodo bien");
process.exitCode = fallos.length ? 1 : 0;
