import crypto from "node:crypto";

/** Huella de un código (sin importar espacios): si no cambió, no se vuelve a verificar ni a pagar la IA. */
export const huella = (texto: string) => crypto.createHash("sha1").update(texto.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
