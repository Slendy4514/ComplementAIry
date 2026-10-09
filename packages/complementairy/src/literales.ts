/**
 * ¿Es este texto una lista de valores LITERALES (lo único que puede traer una expresión de prueba
 * escrita por la IA)? Se analiza con un parser propio, por lista blanca: números, strings sin
 * interpolación, true/false/null (y sus formas de Python), arrays y objetos de esos. Cualquier otra
 * cosa (llamadas, accesos, operadores, plantillas) se rechaza. Sirve para JavaScript/TypeScript y Python.
 */

const PALABRAS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "True", "False", "None"]);

export function sonLiterales(texto: string, o: { conNombre?: boolean } = {}): boolean {
  let i = 0;
  const s = texto;
  const espacios = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const numero = (): boolean => {
    const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?n?)/.exec(s.slice(i));
    if (!m || !m[0]) return false;
    i += m[0].length;
    return true;
  };
  const cadena = (): boolean => {
    const q = s[i];
    if (q !== '"' && q !== "'") return false;
    i++;
    while (i < s.length && s[i] !== q) {
      if (s[i] === "\n") return false;
      i += s[i] === "\\" ? 2 : 1;
    }
    if (s[i] !== q) return false;
    i++;
    return true;
  };
  const palabra = (): string | null => {
    const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const lista = (cierre: string, elemento: () => boolean): boolean => {
    i++;
    espacios();
    while (s[i] !== cierre) {
      if (!elemento()) return false;
      espacios();
      if (s[i] === ",") {
        i++;
        espacios();
      } else if (s[i] !== cierre) return false;
    }
    i++;
    return true;
  };
  const valor = (): boolean => {
    espacios();
    const c = s[i];
    if (c === undefined) return false;
    if (c === "-" || c === "+") {
      i++;
      espacios();
      if (numero()) return true;
      return palabra() === "Infinity";
    }
    if (c === '"' || c === "'") return cadena();
    if (c === "[") return lista("]", valor);
    if (c === "{")
      return lista("}", () => {
        // clave: identificador, string o número; luego ":" y un valor
        if (!(cadena() || numero() || palabra() !== null)) return false;
        espacios();
        if (s[i] !== ":") return false;
        i++;
        return valor();
      });
    if (/[\d.]/.test(c)) return numero();
    const p = palabra();
    return p !== null && PALABRAS.has(p);
  };
  espacios();
  if (i === s.length) return true; // sin argumentos
  for (;;) {
    // Python: argumento con nombre (`meses=3`).
    if (o.conNombre) {
      const m = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(s.slice(i));
      if (m) i += m[0].length;
    }
    if (!valor()) return false;
    espacios();
    if (i === s.length) return true;
    if (s[i] !== ",") return false;
    i++;
    espacios();
    if (i === s.length) return true; // coma final
  }
}
