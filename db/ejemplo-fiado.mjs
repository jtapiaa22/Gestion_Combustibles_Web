// Arma el caso "paga una parte y queda debiendo" y muestra qué ve
// cada pantalla. Borra todo al terminar.
//
// Uso: node db/ejemplo-fiado.mjs
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
Object.assign(process.env, env);

const { supabase } = await import('../src/lib/supabase.js');
const { combustiblesAPI, clientesAPI, ventasAPI } = await import('../src/lib/api.js');
const { formatearMonto, hoyAR } = await import('../src/lib/fechas.js');

await supabase.auth.signInWithPassword({ email: env.IMPORT_EMAIL, password: env.IMPORT_PASSWORD });

const linea = (t = '') => console.log('│  ' + t);
const abrir = (t) => console.log('┌─ ' + t + ' ' + '─'.repeat(Math.max(0, 50 - t.length)));
const cerrar = () => console.log('└' + '─'.repeat(53) + '\n');

const limpiar = [];
try {
  const comb = await combustiblesAPI.crear({ nombre: 'ZZ Ejemplo', precioPorLitro: 2000, cantidadLitros: 100, orden: 999 });
  limpiar.push(() => supabase.from('combustibles').delete().eq('id', comb.id));
  const cli = await clientesAPI.agregar('ZZ Ramón Ejemplo');
  limpiar.push(() => supabase.from('clientes').delete().eq('id', cli.id));

  console.log('\n═══ Ramón lleva 2 litros a $2.000 = $4.000, y entrega $3.000 ═══\n');

  const v = await ventasAPI.registrar({
    clienteId: cli.id, combustibleId: comb.id, cantidadLitros: 2, precioPorLitro: 2000,
    esFiado: true, pagos: [{ metodo: 'Efectivo', monto: 3000 }],
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', v.id));

  const venta = await ventasAPI.obtenerUna(v.id);
  const cliente = (await clientesAPI.obtenerTodos()).find((c) => c.id === cli.id);

  abrir('PANTALLA DE CLIENTES');
  linea(cliente.nombre);
  linea(`DEBE   ${formatearMonto(cliente.debe)}`);
  linea(`en ${cliente.fiados_abiertos} fiado`);
  linea();
  linea('Fiados abiertos:');
  linea(`  ${formatearMonto(venta.saldo)}`);
  linea(`  ${comb.nombre} · 2.00 L · pagó ${formatearMonto(venta.cobrado)} de ${formatearMonto(venta.total)}`);
  cerrar();

  const pagos = await ventasAPI.obtenerPagosFiado(v.id);
  abrir('AL TOCAR "COBRAR"');
  linea(`Debe ${formatearMonto(venta.saldo)}`);
  linea(`Ya pagó ${formatearMonto(venta.cobrado)} de ${formatearMonto(venta.total)}`);
  linea();
  linea('Ya pagó:');
  pagos.forEach((p) => linea(`  ${formatearMonto(p.monto)} · ${p.metodo_pago}`));
  cerrar();

  // Calculado igual que las pantallas
  const hoy = hoyAR();
  const todas = await ventasAPI.obtenerTodas();
  const ventasHoy = todas.filter((x) => x.fecha.slice(0, 10) === new Date().toISOString().slice(0, 10) || x.id === v.id);
  const pagosHoy = await ventasAPI.obtenerPagosPorFecha(hoy, hoy);

  abrir('RESUMEN DEL DÍA (Ventas e Inicio)');
  linea(`En la lista: ${formatearMonto(venta.total)} · etiqueta "Fiado"`);
  linea(`y debajo: "entregó ${formatearMonto(venta.cobrado)}, debe ${formatearMonto(venta.saldo)}"`);
  linea();
  linea(`ENTRÓ HOY           ${formatearMonto(pagosHoy.reduce((s, p) => s + p.monto, 0))}`);
  linea(`QUEDARON DEBIENDO   ${formatearMonto(ventasHoy.filter((x) => x.es_fiado).reduce((s, x) => s + x.saldo, 0))}`);
  cerrar();

  abrir('CAJA');
  linea(`Los ${formatearMonto(3000)} entraron al cajón como cobro en efectivo`);
  linea(`El arqueo al cerrar los cuenta como cualquier otra venta`);
  cerrar();
} finally {
  for (const f of limpiar.reverse()) { try { await f(); } catch {} }
  console.log('(ejemplo borrado de la base)\n');
}
