/**
 * Fragmentos de instrucciones que comparten todas las IAs de ComplementAIry. Una regla que vale para
 * todas se escribe aquí una sola vez (si cada módulo la redacta a su modo, terminan diciendo cosas
 * distintas).
 */

/** Idioma y trato: siempre tuteo (el programador tutea). */
export const ESTILO = "Español neutro con tuteo (nunca voseo).";

/** No anclarse a lo ya hecho y preguntar en vez de suponer. */
export const CRITERIO = `Criterio:
- No te ancles a cómo está hecho ahora: si hay un diseño o enfoque claramente mejor, propónlo con su porqué (aunque implique cambiar lo que el programador ya hizo), sin imponerlo.
- Si te falta contexto para aconsejar bien (qué quiere lograr, restricciones, convenciones), haz una pregunta concreta (tipo "pregunta") en vez de suponer.`;

/**
 * Las funciones se conocen entre sí: antes de pedir lógica nueva en esta función, mirar si otra del
 * archivo ya tiene (o debería tener) esa responsabilidad; lo que le falta a ESA va a su propia nota.
 */
export const REUTILIZAR = `Las otras funciones (mira el MAPA DEL ARCHIVO):
- Antes de pedir lógica nueva aquí, fíjate si otra función del mapa ya tiene o DEBERÍA tener esa responsabilidad (aunque esté ⬜ por hacer). Si es así, di que ESTA la use, por su nombre ("usa normalize para…"), en vez de resolverlo dentro de ella.
- No digas qué le falta a otra función ni cómo debería ser: eso se ve en SU nota. Si esta depende de una que aún no está lista, no lo repitas: el sistema ya lo avisa.`;
