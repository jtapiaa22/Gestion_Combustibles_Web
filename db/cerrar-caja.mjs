// ═══════════════════════════════════════════════════════════════
//  cerrar-caja.mjs — Cierra la caja abierta desde la consola.
//
//  Util durante la etapa de prueba: el smoke test no corre su
//  seccion de caja si hay una abierta, para no tocarla.
//
//  Uso:
//    node db/cerrar-caja.mjs            → cierra sin arqueo
//    node db/cerrar-caja.mjs 47500      → cierra declarando lo contado
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
Object.assign(process.env, env);

const { supabase } = await import('../src/lib/supabase.js');
const { cajaAPI } = await import('../src/lib/api.js');

const contado = process.argv[2] != null ? parseFloat(process.argv[2]) : null;

const { error } = await supabase.auth.signInWithPassword({
  email: env.IMPORT_EMAIL, password: env.IMPORT_PASSWORD,
});
if (error) { console.error('login:', error.message); process.exit(1); }

const abierta = await cajaAPI.obtenerCajaAbierta();
if (!abierta) { console.log('No hay ninguna caja abierta.'); process.exit(0); }

console.log(`Cerrando caja #${abierta.id} · abierta ${abierta.abierta_en}`);
console.log(contado == null ? '  sin arqueo' : `  declarando $${contado} contados`);

const r = await cajaAPI.cerrarCaja(abierta.id, 'Cerrada desde la consola', contado);

const hist = (await cajaAPI.obtenerHistorial()).find((s) => s.id === abierta.id);
console.log(`\n  ventas          : ${r.cantidadVentas}`);
console.log(`  cobrado         : $${r.totalCobrado}`);
console.log(`  fiado nuevo     : $${r.totalFiadoNuevo}`);
console.log(`  fondo inicial   : $${hist.fondo_inicial}`);
console.log(`  esperado en caja: $${hist.efectivo_esperado}`);
console.log(`  contado         : ${hist.efectivo_contado ?? 'null (no se hizo arqueo)'}`);
