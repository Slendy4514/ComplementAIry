/**
 * Guardas de especificidad, SIN IA (manifiesto IV.1, IV.3 y V.3). Deciden si lo que escribes dice algo
 * concreto con tus palabras: un pedido, una orden, una respuesta de la entrevista, una explicación.
 *
 * Todo es determinista (regex y conteo de palabras): la IA puede sugerir una reescritura, pero nunca
 * decide si algo pasa.
 */

/** Palabras en minúsculas y sin tildes (para comparar sin que importen mayúsculas ni acentos). */
export const palabras = (t: string): string[] => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-zñ0-9_]+/g) ?? [];

/** Qué parte de los grupos de `n` palabras de `texto` aparecen tal cual en `otro` (copiar y pegar). */
export function copiado(texto: string, otro: string, n = 3): number {
  const grupos = (ws: string[]) => ws.slice(0, -(n - 1) || undefined).map((_, i) => ws.slice(i, i + n).join(" "));
  const a = grupos(palabras(texto));
  if (a.length < 2) return 0;
  const b = new Set(grupos(palabras(otro)));
  return a.filter((x) => b.has(x)).length / a.length;
}

/** Referencias a lo que dijo otro, en vez de decirlo ("eso", "lo que dijiste", "la segunda", "dale"). */
export const VAGO: RegExp[] = [
  /\b(lo|eso|esto|aquello)\s+que\s+(me\s+)?(dijiste|dices|propusiste|propones|sugeriste|sugieres|ofreciste|comentaste|mencionaste|pusiste)\b/i,
  /\bcomo\s+(me\s+)?(dijiste|propusiste|sugeriste|dices|propones|comentaste|sugieres)\b/i,
  /\b(tu|la|esa)\s+(idea|propuesta|sugerencia|opci[oó]n|alternativa)\b/i,
  /\b(la\s+(primera|segunda|tercera|otra|de\s+arriba)|opci[oó]n\s*\d|alternativa\s*\d)\b/i,
  /\b(haz|hazlo|hazla|aplica|aplícalo|usa|pon|ponlo|escribe|escríbelo|implementa)\s+(eso|esto|aquello|lo\s+mismo|lo\s+de\s+arriba|eso\s+mismo)\b/i,
  // Un "sí / ok / dale" que es TODO el mensaje (un "si no me pasan…" condicional sí vale).
  /^\s*(s[ií]|ok|okay|dale|listo|perfecto|de\s+acuerdo|vale|bueno|adelante)\s*[,.!]*\s*(haz(lo|la)?|dale|eso|as[ií]|adelante|por\s+favor)?\s*[,.!]*\s*$/i,
  /\b(dale|h[aá]gale)\b[\s,]*(haz(lo|la)?|eso|as[ií])\b/i,
  /\b(tal\s+cual|as[ií]\s+como\s+est[aá])(?![\wáéíóúñ])/i,
  /^\s*(ok|okay|s[ií]|vale|listo|perfecto|bueno)\s*[,.]?\s*haz(lo|la)\b/i,
];

/** Aprobaciones que no dicen nada ("lo que digas", "como sugieres", "todo eso", "me da igual"). */
const APROBACION_VACIA: RegExp[] = [
  /^\s*(lo\s+que\s+(t[uú]\s+)?(digas|quieras|creas|sugieras|propongas)|como\s+(t[uú]\s+)?(quieras|digas|veas|sugieres|propones|prefieras))\s*[.!]*\s*$/i,
  /^\s*(todo\s+(eso|eso\s+mismo|lo\s+de\s+arriba)|lo\s+de\s+arriba|igual\s+que\s+(antes|arriba)|me\s+da\s+igual|da\s+igual|no\s+s[eé]|cualquiera)\s*[.!]*\s*$/i,
  /^\s*(s[ií]|ok|dale|vale|listo)\s*,?\s*(a\s+todo|todo|las\s+\w+|los\s+\w+)\s*[.!]*\s*$/i,
];

const AMPLIO = /\b(lo\s+dem[aá]s|el\s+resto|todo\s+lo\s+(dem[aá]s|que\s+falta)|toda\s+la\s+funci[oó]n|la\s+funci[oó]n\s+(entera|completa)|todos\s+los\s+pasos|los\s+(dem[aá]s|otros|siguientes)\s+pasos|el\s+siguiente\s+paso|lo\s+siguiente|paso\s+\d|y\s+(tambi[eé]n\s+)?(lo\s+dem[aá]s|el\s+resto))\b/i;

/** Verbos sin objeto: "arregla", "mejora", "haz que funcione"… (IV.1: prohibido pedir cosas vagas). */
const VERBO_VACIO = /^\s*(arr[eé]gla(lo|la)?|mej[oó]ra(lo|la)?|haz\s+que\s+(funcione|ande|sirva|quede\s+bien)|optim[ií]za(lo|la)?|ar?r[eé]gla\s+(el|la|los|las)\s+(bug|error|problema|cosa)s?|refactoriza(lo|la)?|l[ií]mpia(lo|la)?)\s*[.!]*\s*$/i;

/** Palabras que no dicen QUÉ hacer. */
const GENERICAS = new Set(
  "haz hazla hazlo has crea creala escribe escribela implementa programa la el los las lo una un que y de del con para por toda todo entera completa completo funcion codigo esta este eso esto me te se ahora tambien bien arregla mejora cambia pon agrega anade quita algo cosa cosas".split(" "),
);

export const esVago = (t: string): boolean => VAGO.some((re) => re.test(t.trim()));
/** Aprobación sin contenido: "sí", "lo que digas"… o una referencia vaga ("eso", "tal cual") casi sin contenido propio. */
export const esAprobacionVacia = (t: string): boolean => APROBACION_VACIA.some((re) => re.test(t.trim())) || (esVago(t) && conContenido(t).length < 3);
export const esAmplio = (t: string): boolean => AMPLIO.test(t);

/** Palabras con contenido (no genéricas). */
export const conContenido = (t: string): string[] => palabras(t).filter((w) => !GENERICAS.has(w));

/**
 * ¿Tu orden de UN paso decide algo concreto? Al menos 4 palabras, sin "eso / lo que dijiste / dale", de
 * un solo paso y con tus palabras (no copiada de lo que ofreció la IA).
 */
export function ordenValida(texto: string, ofrecido: string[]): string | null {
  const t = texto.trim();
  if (palabras(t).length < 4) return "dime QUÉ hacer en una oración (al menos 4 palabras), por ejemplo «haz que quite las barras del final»";
  if (esVago(t)) return "di QUÉ hacer con tus palabras, no «eso», «lo que dijiste» ni «la segunda»: así decides tú lo que se escribe";
  if (esAmplio(t)) return "de a un paso: esta orden es solo para el paso actual (los demás vienen después, uno por uno)";
  if (ofrecido.some((o) => copiado(t, o) >= 0.5)) return "dilo con TUS palabras (no copies la propuesta): reformularla es lo que te hace decidirla";
  return null;
}

/** ¿Tu pedido para una función dice qué debe hacer? (al menos 3 palabras con contenido). */
export function pedidoValido(texto: string, ofrecido: string[]): string | null {
  const t = texto.trim();
  const ps = palabras(t);
  if (ps.length < 4) return "dime con tus palabras QUÉ debe hacer (al menos 4 palabras): qué recibe, qué revisa, qué devuelve";
  if (esVago(t)) return "di QUÉ debe hacer con tus palabras, no «eso», «lo que dijiste» ni «tu idea»: así decides tú lo que se escribe";
  if (conContenido(t).length < 3) return "eso no dice qué debe hacer: cuenta qué recibe, qué revisa o qué devuelve (por ejemplo «que devuelva el nombre en minúsculas y sin tildes»)";
  if (ofrecido.some((o) => copiado(t, o) >= 0.5)) return "dilo con TUS palabras (no copies la propuesta): reformularla es lo que te hace decidirla";
  return null;
}

/**
 * Respuesta a una pregunta de la entrevista (o a cualquier sugerencia que aceptas): tiene que DECIR el
 * contenido con tus palabras. Corto vale ("src/export/, el comando lo registro yo"); "sí" no.
 */
export function respuestaValida(texto: string, sugerencia = ""): string | null {
  const t = texto.trim();
  if (!t) return "falta tu respuesta";
  if (esAprobacionVacia(t))
    return "«sí», «dale» o «lo que digas» no dicen qué decidiste. Escríbelo con tus palabras, aunque sea corto (por ejemplo: «sin dependencias, salvo PDF que lo decido ahí»)";
  if (conContenido(t).length < 2 && !/[\w./-]+\.[a-z]{1,5}\b|\/|`/.test(t)) return "di el contenido: qué carpeta, qué opción, qué valor (dos o tres palabras alcanzan)";
  if (sugerencia && copiado(t, sugerencia) >= 0.6 && palabras(t).length > 5) return "lo copiaste de la sugerencia: dilo con tus palabras (es lo que te hace decidirlo)";
  return null;
}

/**
 * ¿Un pedido o un diseño es específico (IV.1)? Debe nombrar algo concreto: un identificador del índice,
 * una ruta, un nombre en `código` o uno declarado como nuevo. Sin IA.
 */
export function pedidoEspecifico(texto: string, conocidos: Iterable<string> = []): string | null {
  const t = texto.trim();
  if (!t) return "el pedido está vacío";
  if (VERBO_VACIO.test(t)) return "eso no dice qué cambiar ni dónde: nombra el archivo, la función, el campo o el comportamiento (IV.1: prohibido pedir cosas vagas)";
  if (esVago(t)) return "di QUÉ quieres con tus palabras, no «eso» ni «lo que dijiste»";
  if (conContenido(t).length < 3) return "di qué quieres: qué cambia, dónde y cómo sabrás que funciona (al menos 3 palabras con contenido)";
  const nombres = new Set([...conocidos].map((x) => x.toLowerCase()));
  const refs = referencias(t);
  if (!refs.length && ![...nombres].some((n) => n.length > 2 && palabras(t).includes(n.toLowerCase())))
    return "nombra algo concreto: un archivo (src/…), una función, un campo o un componente (entre `comillas invertidas` si es nuevo)";
  return null;
}

/** Rutas, `código` y nombres con forma de identificador (camelCase, snake_case, Pascal) del texto. */
export function referencias(t: string): string[] {
  const out = new Set<string>();
  for (const m of t.matchAll(/`([^`]+)`/g)) out.add(m[1]!);
  for (const m of t.matchAll(/(?:^|\s)((?:\.{0,2}\/)?[\w.-]+\/[\w./-]+|[\w-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|css|scss|vue|svelte|json|ya?ml|md|sql|sh))\b/g)) out.add(m[1]!);
  for (const m of t.matchAll(/\b([a-z]+[A-Z]\w*|[A-Z][a-z]+[A-Z]\w*|[a-z]+_[a-z_]+)\b/g)) out.add(m[1]!);
  return [...out];
}

// --- Pedidos con varias cosas: cobertura del texto original (sin IA) ------------------------------------

/**
 * ¿Cada fragmento es un trozo REAL del pedido? (la IA no puede inventar temas). Devuelve los que no lo son.
 * Se compara sin mayúsculas, tildes ni espacios repetidos.
 */
export function fragmentosInventados(pedido: string, fragmentos: string[]): string[] {
  const n = (s: string) => palabras(s).join(" ");
  const base = n(pedido);
  return fragmentos.filter((f) => !n(f) || !base.includes(n(f)));
}

/**
 * Lo que quedó del pedido sin asignar a ningún tema (para resaltarlo): las palabras con contenido del
 * pedido que no están en ningún fragmento. Si quedan 2 o más, hay algo sin destino.
 */
export function sinCubrir(pedido: string, fragmentos: string[]): string[] {
  const cubiertas = new Set(fragmentos.flatMap((f) => conContenido(f)));
  const conectores = new Set("tambien ademas luego despues y e o u pero con sin".split(" "));
  return conContenido(pedido).filter((w) => !cubiertas.has(w) && !conectores.has(w) && w.length > 2);
}

/** Separación ingenua (sin IA) de un pedido en temas: por comas, "y" o "además" entre verbos. Respaldo de la IA. */
export function separarIngenuo(pedido: string): string[] {
  return pedido
    .split(/\s*(?:,|;|\by\s+(?=(?:agrega|arregla|cambia|quita|crea|haz|pon|mueve|renombra|a[ñn]ade|corrige|elimina|implementa|mejora)\b)|\badem[aá]s\b|\btambi[eé]n\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => conContenido(s).length >= 2);
}

// --- Explicaciones con tus palabras (evidencia de nivel 2) ------------------------------------------------

export interface ChequeoExplicacion {
  ok: boolean;
  motivos: string[];
}

/**
 * Una explicación vale como evidencia si (sin IA): tiene largo proporcional a la complejidad, menciona al
 * menos un identificador del tramo, no está copiada de la IA ni de los comentarios del código, y no es una
 * plantilla repetida de tus explicaciones anteriores.
 */
export function chequearExplicacion(
  texto: string,
  o: { identificadores: string[]; complejidad: number; fuentesIa?: string[]; anteriores?: string[] },
): ChequeoExplicacion {
  const motivos: string[] = [];
  const ps = palabras(texto);
  const minimo = Math.min(60, 10 + 4 * Math.max(0, o.complejidad - 1));
  if (ps.length < minimo) motivos.push(`explica con más detalle: al menos ${minimo} palabras para este tramo (tiene ${ps.length})`);
  const ids = o.identificadores.map((i) => i.toLowerCase());
  if (ids.length && !ids.some((i) => ps.includes(i) || texto.toLowerCase().includes(i))) motivos.push(`nombra al menos una pieza del tramo (${o.identificadores.slice(0, 4).join(", ")})`);
  if ((o.fuentesIa ?? []).some((f) => copiado(texto, f, 5) >= 0.3)) motivos.push("se parece demasiado a lo que dijo la IA o a los comentarios: dilo con tus palabras");
  if ((o.anteriores ?? []).some((a) => similitud(texto, a) >= 0.8)) motivos.push("es casi igual a una explicación tuya anterior: explica ESTE tramo");
  return { ok: !motivos.length, motivos };
}

/** Similitud de Jaccard entre las palabras con contenido de dos textos (0 a 1). */
export function similitud(a: string, b: string): number {
  const x = new Set(conContenido(a));
  const y = new Set(conContenido(b));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
