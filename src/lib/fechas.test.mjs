// Verificación del módulo de fechas. Correr con: node src/lib/fechas.test.mjs
// Sin framework a propósito: son las reglas que rompieron el cierre de
// caja en producción, y tienen que poder chequearse sin instalar nada.
import assert from 'node:assert/strict';
import { arAUTC, inicioDelDia, finDelDia, formatearHora, formatearFecha, diaDe, hoyAR } from './fechas.js';

let ok = 0;
const test = (nombre, fn) => {
  try { fn(); console.log(`  ✓ ${nombre}`); ok++; }
  catch (e) { console.log(`  ✗ ${nombre}\n     ${e.message}`); process.exitCode = 1; }
};

console.log('\nfechas.js\n');

test('una hora local AR se convierte a UTC sumando 3', () => {
  // Caja 131 abrió el 18/07 21:41 hora argentina => 19/07 00:41 UTC
  assert.equal(arAUTC('2026-07-18', '21:41', '00'), '2026-07-19T00:41:00.000Z');
});

test('el día argentino arranca a las 03:00 UTC', () => {
  assert.equal(inicioDelDia('2026-07-18'), '2026-07-18T03:00:00.000Z');
});

test('y termina a las 02:59:59 UTC del día siguiente', () => {
  assert.equal(finDelDia('2026-07-18'), '2026-07-19T02:59:59.000Z');
});

test('un instante UTC se muestra en hora argentina', () => {
  // 00:41 UTC del 19 es todavía el 18 a las 21:41 en Argentina
  assert.equal(formatearHora('2026-07-19T00:41:00.000Z'), '21:41');
  assert.equal(formatearFecha('2026-07-19T00:41:00.000Z'), '18/07/2026');
});

test('diaDe agrupa por día argentino, no por día UTC', () => {
  // Una venta a las 22:30 AR cae al día siguiente en UTC. Tiene que
  // seguir contando como del día 18: es el turno de esa noche.
  assert.equal(diaDe('2026-07-19T01:30:00.000Z'), '2026-07-18');
});

test('ida y vuelta: guardar y mostrar da lo mismo', () => {
  const guardado = arAUTC('2026-07-18', '19:05', '00');
  assert.equal(formatearHora(guardado), '19:05');
  assert.equal(diaDe(guardado), '2026-07-18');
});

test('hoyAR devuelve formato YYYY-MM-DD', () => {
  assert.match(hoyAR(), /^\d{4}-\d{2}-\d{2}$/);
});

test('una ventana de caja que cruza medianoche contiene la venta', () => {
  // El caso exacto que la app de PC calculaba mal
  const desde = arAUTC('2026-07-18', '21:41', '00');
  const hasta = arAUTC('2026-07-19', '02:00', '59');
  const venta = arAUTC('2026-07-18', '23:50', '00');
  assert.ok(venta >= desde && venta <= hasta, 'la venta quedó fuera de la ventana');
});

console.log(`\n${ok}/8\n`);
