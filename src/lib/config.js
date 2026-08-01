// Constantes compartidas entre pantallas. Antes STOCK_BAJO vivía
// duplicado en Stock.jsx e Inicio.jsx, con el riesgo de que alguien
// cambie uno y se olvide del otro.
export const STOCK_BAJO = 100; // litros
export const DEUDA_VIEJA_DIAS = 30; // dias sin pagar nada, para resaltarlo