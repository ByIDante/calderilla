import type { Estabilidad, PerfilRiesgo } from "./tipos.ts";

/*
 * Cuestionario de perfil de riesgo. Mide dos cosas distintas: la TOLERANCIA (cuánto aguantas ver caer tu
 * inversión) y la CAPACIDAD (cuánto riesgo te puedes permitir por plazo y estabilidad). El perfil final es
 * el menor de los dos: alguien muy valiente pero que necesitará el dinero en 2 años no debe arriesgar.
 */

export interface Pregunta {
  id: "horizonte" | "caida" | "estabilidad" | "experiencia" | "objetivo";
  mide: "tolerancia" | "capacidad";
  texto: string;
  respuestas: string[];
}

export const PREGUNTAS: Pregunta[] = [
  {
    id: "horizonte",
    mide: "capacidad",
    texto: "¿Cuándo crees que podrías necesitar el dinero que inviertas?",
    respuestas: ["En menos de 3 años", "Entre 3 y 5 años", "Entre 5 y 10 años", "En más de 10 años"],
  },
  {
    id: "caida",
    mide: "tolerancia",
    texto: "Tu inversión cae un 30 % en pocos meses. ¿Qué haces?",
    respuestas: ["Lo vendo todo para no perder más", "Vendo una parte", "Espero sin tocar nada", "Aprovecho para comprar más"],
  },
  {
    id: "estabilidad",
    mide: "capacidad",
    texto: "¿Cómo de estables son tus ingresos?",
    respuestas: ["Inestables (autónomo con altibajos, temporal…)", "Normales", "Muy estables (funcionario, fijo con antigüedad)"],
  },
  {
    id: "experiencia",
    mide: "tolerancia",
    texto: "¿Qué has tenido hasta ahora?",
    respuestas: ["Solo cuentas", "Depósitos o cuentas remuneradas", "Fondos de inversión o ETF", "Acciones o varios productos durante años"],
  },
  {
    id: "objetivo",
    mide: "tolerancia",
    texto: "¿Qué buscas sobre todo?",
    respuestas: ["No perder nada", "Ganar algo sin sustos", "Un equilibrio", "Que crezca lo máximo, aunque oscile mucho"],
  },
];

const PERFILES: PerfilRiesgo[] = ["conservador", "moderado", "dinamico", "agresivo"];
const ESTABILIDADES: Estabilidad[] = ["inestable", "normal", "estable"];

export interface ResultadoCuestionario {
  perfil: PerfilRiesgo;
  estabilidad: Estabilidad;
  /** De 0 a 3. */
  tolerancia: number;
  capacidad: number;
}

/** `respuestas[i]` es el índice de la respuesta elegida en la pregunta i. */
export function puntuar(respuestas: readonly number[]): ResultadoCuestionario {
  const puntos = PREGUNTAS.map((pregunta, i) => {
    const elegida = Math.min(Math.max(respuestas[i] ?? 0, 0), pregunta.respuestas.length - 1);
    // Todas las preguntas puntúan de 0 a 3, tengan 3 o 4 respuestas
    return { mide: pregunta.mide, valor: (elegida * 3) / (pregunta.respuestas.length - 1) };
  });
  const media = (mide: Pregunta["mide"]) => {
    const valores = puntos.filter((p) => p.mide === mide).map((p) => p.valor);
    return valores.reduce((a, b) => a + b, 0) / valores.length;
  };
  const tolerancia = media("tolerancia");
  const capacidad = media("capacidad");
  const nivel = Math.min(tolerancia, capacidad);
  const indice = nivel < 0.75 ? 0 : nivel < 1.5 ? 1 : nivel < 2.25 ? 2 : 3;
  const estabilidad = ESTABILIDADES[Math.min(Math.max(respuestas[2] ?? 1, 0), 2)] ?? "normal";
  return { perfil: PERFILES[indice] ?? "moderado", estabilidad, tolerancia, capacidad };
}
