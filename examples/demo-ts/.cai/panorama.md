# Panorama del proyecto

_Generado por `cai panorama` el 2026-10-07 17:19._

## Estado

El proyecto está empezando: hay una sola función, `calcularCuota`, que calcula bien la cuota del sistema francés y cubre el caso de tasa cero. El tooling está bien armado (ESLint estricto, Vitest y Stryker para mutation testing). Todavía falta lo central del objetivo: la tabla de amortización, la validación de entradas y una decisión sobre cómo redondear el dinero.

## Sugerencias

### 1. Validar las entradas en la frontera (responde a tu @ia?)

**Por qué:** Hoy `calcularCuota(1000, 0.01, 0)` divide por cero y devuelve Infinity o NaN sin avisar. Con `meses = 2.5` o un monto negativo devuelve un número que parece válido pero no tiene sentido. En una fundación, un número equivocado que nadie detecta es peor que un error visible.

**Cómo:** Al inicio de la función, revisa tres cosas: que `meses` sea un entero y mayor que cero (JavaScript ya trae una función estándar para saber si un número es entero), que el monto sea finito y mayor que cero, y que la tasa sea finita y no negativa. Si algo falla, lanza un error con un mensaje claro que diga qué parámetro falló y con qué valor, por ejemplo 'meses debe ser un entero positivo, llegó 2.5'. Después agrega un test por cada regla.

Archivos: `src/cuota.ts`, `src/cuota.test.ts`

### 2. Crear el módulo de tabla de amortización

**Por qué:** Es la segunda mitad de lo que busca el proyecto y todavía no existe. Además te obliga a resolver bien el redondeo: la suma de los abonos a capital tiene que dar exactamente el monto prestado.

**Cómo:** Crea un archivo nuevo con una función que reciba los mismos datos y devuelva una lista de filas. Cada fila lleva el número de cuota, la cuota, el interés, el abono a capital y el saldo pendiente. Esa función reutiliza `calcularCuota` y no repite la fórmula. Calcula el interés sobre el saldo, el abono como cuota menos interés y el nuevo saldo como saldo menos abono. En la última fila ajusta el abono para que el saldo quede exactamente en cero.

Archivos: `src/amortizacion.ts`, `src/amortizacion.test.ts`

### 3. Decidir cómo se maneja el dinero (redondeo)

**Por qué:** Los `number` de JavaScript tienen errores de punto flotante (por ejemplo, 0.1 + 0.2 da 0.30000000000000004). Si redondeas cada fila por separado, en la tabla pueden aparecer diferencias de un peso o un centavo que el usuario va a notar.

**Cómo:** Define una sola regla y escríbela en las reglas del proyecto. Una opción es calcular internamente con todos los decimales y redondear solo al mostrar o al cerrar cada fila. Otra es trabajar en la unidad mínima de la moneda como entero (centavos, o pesos enteros si es CLP). Pon el redondeo en una función pequeña y compartida para no repetirlo en cada archivo.

Archivos: `src/dinero.ts`

### 4. Ordenar la carpeta de tests

**Por qué:** La configuración apunta a `tests`, pero el test está en `src/cuota.test.ts`. Puede que Vitest o Stryker no encuentren el test o que lo ignoren, y entonces el mutation testing no mide nada real.

**Cómo:** Elige una convención: tests junto al código en `src` o todos en `tests`. Ajusta la configuración (o mueve el archivo) para que coincidan. Después corre Vitest y Stryker una vez para confirmar que detectan el test.

Archivos: `src/cuota.test.ts`

### 5. Llenar el archivo de reglas

**Por qué:** El archivo de reglas está vacío. Decisiones como cómo se redondea, en qué idioma se nombran las cosas o si los errores se lanzan o se devuelven conviene escribirlas antes de que el código crezca.

**Cómo:** Anota 4 o 5 reglas cortas: nombres en español, que las funciones de cálculo sean puras (sin pantalla ni entrada de usuario), la regla de redondeo, que entradas inválidas lancen un error, y que cada función tenga test.

## Otras formas de hacerlo

- **Recibir tasa mensual como número suelto:** Recibir un objeto con nombre, por ejemplo con los campos monto, tasaAnual y meses, y convertir a tasa mensual dentro de una función explícita. _(Tres números seguidos se pueden pasar en el orden equivocado sin que TypeScript se queje. Además, las instituciones suelen informar la tasa anual, y confundir 12% anual con 12% mensual es un error grave y fácil de cometer.)_
- **Usar number para montos:** Trabajar con enteros en la unidad mínima de la moneda o con una librería decimal como decimal.js. _(Evita los errores de punto flotante en la tabla de amortización. Para un simulador basta con enteros. Una librería decimal solo se justifica si después hay montos con muchos decimales o cálculos más complejos.)_

## Riesgos

- Una entrada inválida (meses = 0, NaN o negativo) produce Infinity o NaN en silencio, y ese valor se mostraría al usuario como si fuera una cuota real.
- Que la tasa sea mensual no se nota en el tipo: alguien puede pasar 0.12 pensando en la tasa anual y obtener una cuota enorme.
- Si los tests no están donde los busca la configuración, Stryker puede mostrar resultados engañosos.
- La suma de los abonos a capital puede no coincidir con el monto prestado por culpa del redondeo.

## Preguntas para ti

Respóndelas en `.cai/conocimiento.md` (después de "R:"): se usan en todas las sugerencias.

- ¿En qué moneda son los préstamos: pesos chilenos sin decimales, UF u otra? Esto define cómo redondear.
- ¿La fundación entrega la tasa como anual o mensual, y existen préstamos con tasa 0?
- ¿Dónde se va a usar el simulador: consola, página web, planilla exportada? Esto define cómo separar el cálculo de la presentación.
- ¿Hay cargos extra que deban aparecer en la tabla, como seguros, comisiones o meses de gracia, o es solo sistema francés puro?
- ¿En qué moneda se trabaja, pesos chilenos sin decimales o una moneda con centavos? De eso depende la regla de redondeo.
- ¿La fundación informa las tasas como anuales o mensuales? ¿Hay que considerar seguros, comisiones o meses de gracia?
- ¿Quién va a usar el simulador y por dónde: línea de comandos, una página web o una planilla exportada? Eso define dónde validar y cómo mostrar la tabla.
- ¿Prefieres los tests junto al código en `src` o en una carpeta `tests` separada?

## Mediciones (sin IA)

- 2 archivos de código, 1 funciones.
- Preguntas `@ia?` sin responder: src/cuota.ts (1).
- Tus errores más frecuentes: acompanante/nombres (1), acompanante/validacion-entrada (1).
- IA en los últimos 7 días: 5 llamadas, US$0.23 (detalle: `cai uso`).
