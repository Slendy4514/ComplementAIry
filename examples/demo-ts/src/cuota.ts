// Calcula la cuota mensual de un préstamo (sistema francés).
export function calcularCuota(monto: number, tasaMensual: number, meses: number): number {
  // @ia? ¿cómo valido que meses sea un entero positivo?
  if (tasaMensual === 0) return monto / meses;
  const factor = Math.pow(1 + tasaMensual, meses);
  return (monto * tasaMensual * factor) / (factor - 1);
}
