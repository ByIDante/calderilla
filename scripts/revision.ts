// Lo que mira revisar-pantallas en cada página (y la prueba del móvil en las suyas). Playwright ejecuta esta
// función dentro de la página, así que todo lo que usa tiene que estar dentro de ella.
export function revisar() {
  const problemas: string[] = [];
  const ancho = window.innerWidth;
  if (document.documentElement.scrollWidth > ancho + 1) problemas.push(`la página se desplaza en horizontal (${document.documentElement.scrollWidth} px de ${ancho})`);
  for (const caja of document.querySelectorAll(".tarjeta, .opcion, .cifra, .aviso, .version, fieldset")) {
    const limite = caja.getBoundingClientRect();
    for (const el of caja.querySelectorAll("*")) {
      if (el.closest(".tabla-contenedor") || (el.closest("details:not([open])") && !el.closest("summary"))) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > limite.right + 2) {
        problemas.push(`se sale de su tarjeta: <${el.tagName.toLowerCase()}> «${(el.textContent ?? "").trim().slice(0, 40)}» (+${Math.round(r.right - limite.right)} px)`);
        break;
      }
    }
  }
  for (const p of document.querySelectorAll("main p")) {
    const padre = p.parentElement!.getBoundingClientRect();
    const r = p.getBoundingClientRect();
    const linea = parseFloat(getComputedStyle(p).lineHeight) || 22;
    if (padre.width > 500 && r.height > linea * 1.5 && r.width < padre.width * 0.85) {
      problemas.push(`texto que baja de línea antes de tiempo: «${(p.textContent ?? "").trim().slice(0, 50)}» (${Math.round(r.width)} de ${Math.round(padre.width)} px)`);
    }
  }
  // En pantallas estrechas el menú se desliza: la sección actual tiene que verse sin tocarlo
  const actual = document.querySelector('.menu a[aria-current="page"]');
  const fila = actual?.closest("ul");
  if (actual && fila && getComputedStyle(fila).display === "flex") {
    const r = actual.getBoundingClientRect();
    const caja = fila.getBoundingClientRect();
    if (r.left < caja.left - 1 || r.right > caja.right - 20) problemas.push(`la sección actual («${actual.textContent?.trim()}») queda fuera del menú`);
  }
  // Las marcadas como desplazables (p. ej. el cuadro de amortización) se desplazan a propósito
  for (const t of document.querySelectorAll(".tabla-contenedor:not(.desplazable)")) {
    if (t.scrollWidth > t.clientWidth + 2) problemas.push(`tabla que hay que desplazar de lado (${t.scrollWidth} px en ${t.clientWidth})`);
  }
  if (ancho < 600) {
    // Las casillas y opciones se pulsan también por su texto (la etiqueta), así que no cuentan
    const pequenos = [...document.querySelectorAll("main a, main button, main select, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main summary")].filter((x) => {
      const r = x.getBoundingClientRect();
      // Lo que solo existe para lectores de pantalla (.sr) no se ve ni se pulsa
      return r.width > 0 && r.height < 31 && !x.closest("p, li, td div, .apagado, .sr");
    });
    if (pequenos.length) problemas.push(`${pequenos.length} controles de menos de 32 px de alto (difíciles de pulsar con el dedo)`);
  }

  // Texto que casi no se lee contra su fondo (sobre todo en modo oscuro): contraste por debajo de 3 a 1.
  // Todo va aquí dentro: Playwright ejecuta esta función en la página
  const canales = (valor: string): [number, number, number, number] | null => {
    const n = valor.match(/[\d.]+/g)?.map(Number);
    if (!n || n.length < 3) return null;
    // «color(srgb 0.1 0.2 0.3 / 0.5)» (lo que da color-mix) va de 0 a 1; «rgb(…)», de 0 a 255
    const escala = valor.startsWith("color(") ? 255 : 1;
    return [n[0]! * escala, n[1]! * escala, n[2]! * escala, n[3] ?? 1];
  };
  const mezclar = (arriba: [number, number, number, number], abajo: [number, number, number]): [number, number, number] => [
    arriba[0] * arriba[3] + abajo[0] * (1 - arriba[3]),
    arriba[1] * arriba[3] + abajo[1] * (1 - arriba[3]),
    arriba[2] * arriba[3] + abajo[2] * (1 - arriba[3]),
  ];
  // El fondo de verdad: se sube por los padres apilando los fondos semitransparentes hasta uno opaco
  const fondoDe = (el: Element): [number, number, number] => {
    const capas: [number, number, number, number][] = [];
    for (let x: Element | null = el; x; x = x.parentElement) {
      const color = canales(getComputedStyle(x).backgroundColor);
      if (!color || color[3] === 0) continue;
      capas.push(color);
      if (color[3] >= 1) break;
    }
    return capas.reverse().reduce<[number, number, number]>((abajo, capa) => mezclar(capa, abajo), [255, 255, 255]);
  };
  const luminancia = (color: [number, number, number]) => {
    const lineal = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lineal(color[0]) + 0.7152 * lineal(color[1]) + 0.0722 * lineal(color[2]);
  };
  const vistos = new Set<string>();
  for (const el of document.querySelectorAll("nav *, main *")) {
    if (el.closest("svg, canvas, .sr, details:not([open]) > :not(summary)")) continue;
    const texto = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim();
    const color = canales(getComputedStyle(el).color);
    if (!texto || !color || !el.getBoundingClientRect().width) continue;
    const fondo = fondoDe(el);
    const [claro, oscuro] = [luminancia(mezclar(color, fondo)), luminancia(fondo)].sort((a, b) => b - a) as [number, number];
    const contraste = (claro + 0.05) / (oscuro + 0.05);
    const clave = `${el.tagName}.${el.className}`;
    if (contraste < 3 && !vistos.has(clave)) {
      vistos.add(clave);
      problemas.push(`texto que casi no se lee (contraste ${contraste.toFixed(1)} a 1): <${el.tagName.toLowerCase()} class="${el.className}"> «${texto.slice(0, 40)}»`);
    }
  }
  return [...new Set(problemas)];
}
