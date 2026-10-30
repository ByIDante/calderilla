// Prepara dist/Calderilla-Windows.zip para quien no tiene Git ni cuenta de GitHub: lleva el código del
// último commit, Node para Windows y las dependencias ya instaladas. Se descomprime, se abre «Crear acceso
// directo.cmd» una vez y listo; después se actualiza sola desde GitHub (scripts/actualizar.ts).
// Uso: npm run paquete-windows (en Linux o macOS, con unzip y zip instalados).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { leerTar } from "../src/config/actualizar.ts";

const raiz = path.join(import.meta.dirname, "..");
const dist = path.join(raiz, "dist");
const descargas = path.join(dist, ".descargas");
const paquete = path.join(dist, "Calderilla");
const zip = path.join(dist, "Calderilla-Windows.zip");
const ejecutar = (orden: string, argumentos: string[], cwd = raiz) => execFileSync(orden, argumentos, { cwd, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1_048_576 });

if (ejecutar("git", ["status", "--porcelain"]).toString().trim()) {
  console.error("Hay cambios sin guardar en git: el paquete se hace con el último commit. Haz commit (y push) antes.");
  process.exit(1);
}
const sha = ejecutar("git", ["rev-parse", "HEAD"]).toString().trim();
rmSync(paquete, { recursive: true, force: true });
mkdirSync(descargas, { recursive: true });

// 1. El código del último commit, como lo descargaría la actualización desde GitHub
console.log(`Código del commit ${sha.slice(0, 7)}...`);
for (const archivo of leerTar(ejecutar("git", ["archive", "--format=tar", "--prefix=Calderilla/", "HEAD"]))) {
  const destino = path.join(dist, archivo.ruta);
  if (archivo.datos === null) {
    mkdirSync(destino, { recursive: true });
  } else {
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, archivo.datos);
  }
}

// 2. Node para Windows (la última versión 24), comprobado con las sumas que publica nodejs.org
const web = "https://nodejs.org/dist/latest-v24.x/";
const sumas = await (await fetch(`${web}SHASUMS256.txt`)).text();
const [, sumaEsperada, nombreNode] = /^([0-9a-f]{64})\s+(node-v24\.[\d.]+-win-x64\.zip)$/m.exec(sumas) ?? [];
if (!sumaEsperada || !nombreNode) throw new Error("No encuentro Node 24 para Windows en nodejs.org");
const zipNode = path.join(descargas, nombreNode);
if (!existsSync(zipNode)) {
  console.log(`Descargando ${nombreNode}...`);
  writeFileSync(zipNode, Buffer.from(await (await fetch(web + nombreNode)).arrayBuffer()));
}
if (createHash("sha256").update(readFileSync(zipNode)).digest("hex") !== sumaEsperada) {
  rmSync(zipNode);
  throw new Error(`${nombreNode} no coincide con su suma de comprobación: vuelve a intentarlo`);
}
const carpetaNode = path.join(descargas, nombreNode.replace(/\.zip$/, ""));
rmSync(carpetaNode, { recursive: true, force: true });
ejecutar("unzip", ["-q", zipNode, "-d", descargas]);
renameSync(carpetaNode, path.join(paquete, "node"));

// 3. Las dependencias (todas son JavaScript puro, así que valen las que instala este ordenador)
console.log("Instalando dependencias...");
ejecutar("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], paquete);

// 4. La versión instalada (con ella se actualiza sola) y unas instrucciones
writeFileSync(path.join(paquete, "VERSION"), `${sha}\n`);
writeFileSync(
  path.join(paquete, "LEEME.txt"),
  [
    "CALDERILLA",
    "",
    "1. Si al descomprimir Windows avisa de que los archivos vienen de internet, es normal.",
    "2. Abre \"Crear acceso directo.cmd\" (doble clic). Si Windows pregunta, pulsa \"Mas informacion\" y \"Ejecutar de todas formas\".",
    "   Crea en el escritorio el acceso directo \"Calderilla\".",
    "3. Abre Calderilla desde el escritorio. La primera vez te pide una carpeta para guardar tus datos.",
    "",
    "No hace falta instalar nada mas. Cada vez que la abres busca si hay una version nueva y la instala sola.",
    "Tus datos no estan en esta carpeta sino en la que elijas, asi que puedes borrar o sustituir esta sin perderlos.",
    "Para cerrarla: Ajustes -> Cerrar Calderilla.",
    "",
  ].join("\r\n"),
);

// 5. El ZIP
rmSync(zip, { force: true });
ejecutar("zip", ["-qr", "-X", zip, "Calderilla"], dist);
console.log(`\nListo: ${zip} (${Math.round(statSync(zip).size / 1_048_576)} MB) · versión ${sha.slice(0, 7)}`);
