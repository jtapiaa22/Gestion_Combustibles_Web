// Arma los casos de cobro que no son "todo de una" y muestra qué ve
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
const { formatearMonto, formatearFecha, formatearHora } = await import('../src/lib/fechas.js');

await supabase.auth.signInWithPassword({ email: env.IMPORT_EMAIL, password: env.IMPORT_PASSWORD });

const linea = (t = '') => console.log('│  ' + t);
const abrir = (t) => console.log('┌─ ' + t + ' ' + '─'.repeat(Math.max(0, 52 - t.length)));
const cerrar = () => console.log('└' + '─'.repeat(55) + '\n');

/** Reproduce lo que muestra el modal "Ver detalle" de Reportes. */
async function detalle(ventaId) {
  const v = await ventasAPI.obtenerUna(ventaId);
  const pagos = await ventasAPI.obtenerPagosFiado(ventaId);

  abrir('VER DETALLE');
  linea(`Cuándo            ${formatearFecha(v.fecha)} a las ${formatearHora(v.fecha)}`);
  linea(`Combustible       ${v.combustible_nombre}`);
  linea(`Cantidad          ${v.cantidad_litros.toFixed(2)} L`);
  linea(`Precio por litro  ${formatearMonto(v.precio_por_litro)}`);
  linea(`Total             ${formatearMonto(v.total)}`);
  if (v.cliente_nombre) linea(`Cliente           ${v.cliente_nombre}`);
  linea();
  linea(v.es_fiado ? 'COBROS RECIBIDOS' : 'CÓMO SE COBRÓ');
  if (!pagos.length) linea('  (todavía no pagó nada)');
  pagos.forEach((p) =>
    linea(`  ${formatearMonto(p.monto).padEnd(10)} ${p.metodo_pago}${p.titular_transferencia ? ' · de ' + p.titular_transferencia : ''}`)
  );
  linea();
  if (!v.es_fiado) linea('Cobrada por completo');
  else if (v.pagado) linea('Saldado');
  else linea(`TODAVÍA DEBE  ${formatearMonto(v.saldo)}   (de ${formatearMonto(v.total)}, pagó ${formatearMonto(v.cobrado)})`);
  cerrar();
}

const limpiar = [];
try {
  const comb = await combustiblesAPI.crear({ nombre: 'ZZ Ejemplo', precioPorLitro: 2000, cantidadLitros: 100, orden: 999 });
  limpiar.push(() => supabase.from('combustibles').delete().eq('id', comb.id));
  const cli = await clientesAPI.agregar('ZZ Ramón Ejemplo');
  limpiar.push(() => supabase.from('clientes').delete().eq('id', cli.id));

  // ── Caso 1: paga todo, mitad y mitad ──────────────────────
  console.log('\n═══ CASO 1 · Lleva 5 L = $10.000. Da $6.000 en efectivo y transfiere $4.000 ═══\n');
  const partida = await ventasAPI.registrar({
    combustibleId: comb.id, cantidadLitros: 5, precioPorLitro: 2000, esFiado: false,
    pagos: [
      { metodo: 'Efectivo', monto: 6000 },
      { metodo: 'Transferencia', monto: 4000, titular: 'Ramón Díaz' },
    ],
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', partida.id));
  const vP = await ventasAPI.obtenerUna(partida.id);
  abrir('EN LA TABLA DE REPORTES');
  linea(`${formatearFecha(vP.fecha)}  ${comb.nombre}  5.00 L  ${formatearMonto(vP.total)}  ${vP.metodos_pago}`);
  linea('                                            └─ no dice cuánto de cada uno');
  cerrar();
  await detalle(partida.id);

  // ── Caso 2: entrega algo y queda debiendo ─────────────────
  console.log('═══ CASO 2 · Lleva 2 L = $4.000 y entrega $3.000 ═══\n');
  const conEntrega = await ventasAPI.registrar({
    clienteId: cli.id, combustibleId: comb.id, cantidadLitros: 2, precioPorLitro: 2000,
    esFiado: true, pagos: [{ metodo: 'Efectivo', monto: 3000 }],
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', conEntrega.id));
  await detalle(conEntrega.id);

  // Y después le cobra el resto por transferencia
  await ventasAPI.registrarPago(conEntrega.id, 1000, 'Transferencia', 'Ramón Díaz');
  console.log('   …días después le cobra los $1.000 restantes por transferencia:\n');
  await detalle(conEntrega.id);
} finally {
  for (const f of limpiar.reverse()) { try { await f(); } catch {} }
  console.log('(ejemplos borrados de la base)\n');
}
