// ═══════════════════════════════════════════════════════════════
//  limpiar-pruebas.mjs — Vacía la base NUEVA de datos de prueba
//  antes del import real. Deja el catálogo de combustibles solo
//  con Nafta y Gasoil, stock en 0 (igual que la semilla del schema).
//
//  NO toca la base vieja.
//
//  Uso:
//    node db/limpiar-pruebas.mjs              → simulacro, no borra
//    node db/limpiar-pruebas.mjs --ejecutar   → borra de verdad
// ═══════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const EJECUTAR = process.argv.includes('--ejecutar');

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const destino = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const alzar = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

async function main() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(EJECUTAR ? '  BORRADO REAL — se van a borrar datos de la base NUEVA' : '  SIMULACRO — no se borra nada');
  console.log('═'.repeat(62));

  console.log('\n[1] Entrando a la base nueva...');
  const { error: errLogin } = await destino.auth.signInWithPassword({
    email: env.IMPORT_EMAIL,
    password: env.IMPORT_PASSWORD,
  });
  if (errLogin) throw new Error(`No se pudo entrar: ${errLogin.message}`);
  console.log(`    ok, como ${env.IMPORT_EMAIL}`);

  console.log('\n[2] Estado actual:');
  const tablas = ['clientes', 'ventas', 'pagos', 'compras_stock', 'sesiones_caja', 'combustibles'];
  for (const t of tablas) {
    const { count, error } = await destino.from(t).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${t}: ${error.message}`);
    console.log(`    ${t.padEnd(15)}: ${count}`);
  }

  console.log('\n[3] Se va a borrar TODO de: pagos, compras_stock, sesiones_caja, ventas, clientes, combustibles.');
  console.log('    Después se reinsertan Nafta y Gasoil con stock 0 (como la semilla original).');

  if (!EJECUTAR) {
    console.log('\n  Simulacro terminado. Nada fue borrado.');
    console.log('  Para hacerlo de verdad: node db/limpiar-pruebas.mjs --ejecutar\n');
    return;
  }

  console.log('\n[4] Borrando (en orden por las foreign keys)...');
  for (const t of ['pagos', 'compras_stock', 'sesiones_caja', 'ventas', 'clientes', 'combustibles']) {
    const { error } = await destino.from(t).delete().gte('id', 0);
    if (error) throw new Error(`${t}: ${error.message}`);
    console.log(`    ${t} vaciada`);
  }

  console.log('\n[5] Reinsertando catálogo base (Nafta, Gasoil @ 0L)...');
  alzar(await destino.from('combustibles').insert([
    { nombre: 'Nafta', orden: 1 },
    { nombre: 'Gasoil', orden: 2 },
  ]).select('id, nombre'));

  console.log('\n[6] Verificando que quedó vacío...');
  for (const t of ['clientes', 'ventas', 'pagos', 'compras_stock', 'sesiones_caja']) {
    const { count, error } = await destino.from(t).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${t}: ${error.message}`);
    if (count > 0) throw new Error(`${t} debería estar vacía pero tiene ${count} filas`);
    console.log(`    ${t}: 0 ✓`);
  }

  console.log('\n  Base nueva limpia. Lista para el import real.\n');
}

main().catch((e) => {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exitCode = 1;
});
