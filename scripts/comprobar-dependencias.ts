// Sale con código 1 si hay que instalar o actualizar las dependencias (primera vez, o tras un `git pull`
// que cambió package-lock.json). Lo usa Calderilla.cmd antes de arrancar.
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const raiz = path.join(import.meta.dirname, "..");
const instalado = path.join(raiz, "node_modules", ".package-lock.json");
const pedido = path.join(raiz, "package-lock.json");

process.exitCode = !existsSync(instalado) || statSync(pedido).mtimeMs > statSync(instalado).mtimeMs ? 1 : 0;
