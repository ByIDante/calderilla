// node:crypto en el móvil: solo lo que usa el código común. El SHA-1 tiene que dar exactamente lo mismo que en el
// PC, porque se guarda (huella de los movimientos importados, avisos ocultos) y se compara entre equipos.

function sha1(bytes: Uint8Array): Uint8Array {
  const longitud = bytes.length;
  const bloques = ((longitud + 8) >> 6) + 1;
  const palabras = new Uint32Array(bloques * 16);
  for (let i = 0; i < longitud; i++) palabras[i >> 2]! |= bytes[i]! << (24 - (i % 4) * 8);
  palabras[longitud >> 2]! |= 0x80 << (24 - (longitud % 4) * 8);
  // La longitud en bits, en las dos últimas palabras (las de más de 4 GB no hacen falta)
  palabras[bloques * 16 - 1] = (longitud * 8) >>> 0;
  palabras[bloques * 16 - 2] = Math.floor((longitud * 8) / 2 ** 32);
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotar = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let b = 0; b < bloques; b++) {
    for (let i = 0; i < 16; i++) w[i] = palabras[b * 16 + i]!;
    for (let i = 16; i < 80; i++) w[i] = rotar(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, bb, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(bb & c) | (~bb & d), 0x5a827999] : i < 40 ? [bb ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(bb & c) | (bb & d) | (c & d), 0x8f1bbcdc] : [bb ^ c ^ d, 0xca62c1d6];
      const t = (rotar(a, 5) + f + e + k + w[i]!) >>> 0;
      [e, d, c, bb, a] = [d, c, rotar(bb, 30), a, t];
    }
    [h0, h1, h2, h3, h4] = [(h0 + a) >>> 0, (h1 + bb) >>> 0, (h2 + c) >>> 0, (h3 + d) >>> 0, (h4 + e) >>> 0];
  }
  const salida = new Uint8Array(20);
  new DataView(salida.buffer).setUint32(0, h0);
  new DataView(salida.buffer).setUint32(4, h1);
  new DataView(salida.buffer).setUint32(8, h2);
  new DataView(salida.buffer).setUint32(12, h3);
  new DataView(salida.buffer).setUint32(16, h4);
  return salida;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

class Huella {
  #partes: Uint8Array[] = [];

  update(dato: string | Uint8Array): this {
    this.#partes.push(typeof dato === "string" ? new TextEncoder().encode(dato) : dato);
    return this;
  }

  digest(formato: "hex"): string {
    if (formato !== "hex") throw new Error(`En el móvil solo hay SHA-1 en hexadecimal, no en «${formato}».`);
    const total = new Uint8Array(this.#partes.reduce((n, p) => n + p.length, 0));
    let posicion = 0;
    for (const parte of this.#partes) {
      total.set(parte, posicion);
      posicion += parte.length;
    }
    return hex(sha1(total));
  }
}

export function createHash(algoritmo: string): Huella {
  if (algoritmo !== "sha1") throw new Error(`En el móvil solo hay SHA-1, no «${algoritmo}».`);
  return new Huella();
}

export function randomBytes(cuantos: number): { toString(formato: "hex"): string } {
  const bytes = crypto.getRandomValues(new Uint8Array(cuantos));
  return {
    toString(formato) {
      if (formato !== "hex") throw new Error(`En el móvil solo hay bytes al azar en hexadecimal, no en «${formato}».`);
      return hex(bytes);
    },
  };
}
