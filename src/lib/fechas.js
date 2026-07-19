// ══════════════════════════════════════════════════════════════
//  fechas.js — TODO el manejo de tiempo del sistema pasa por acá.
//
//  Contexto: en las apps viejas las fechas se escribían como hora
//  local etiquetada como UTC (el bug del `.replace('T', ' ')` que
//  no hacía nada). Eso rompía el cierre de caja de la app de PC.
//
//  Regla única, sin excepciones:
//    · Se GUARDA siempre en UTC real  → ahora()
//    · Se MUESTRA siempre en hora AR  → formatearFecha / formatearHora
//
//  Nunca armar un string de fecha a mano fuera de este archivo.
// ══════════════════════════════════════════════════════════════

export const TZ = 'America/Argentina/Buenos_Aires';

// Argentina está en UTC-3 todo el año: no aplica horario de verano
// desde 2009. Por eso el offset fijo es seguro acá. Si algún día
// vuelve el DST, este es el único lugar que hay que tocar.
const OFFSET_AR = '-03:00';

/** Instante actual, listo para guardar en una columna timestamptz. */
export const ahora = () => new Date().toISOString();

/** Fecha de hoy en Argentina, formato YYYY-MM-DD. */
export const hoyAR = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/** Hora actual en Argentina, formato HH:MM. */
export const horaAR = () =>
  new Date().toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Convierte una fecha+hora local argentina a un instante UTC.
 * Se usa para armar los límites de las sesiones de caja, que guardan
 * fecha y hora por separado como valores locales.
 */
export const arAUTC = (fecha, hora = '00:00', segundos = '00') =>
  new Date(`${fecha}T${hora}:${segundos}${OFFSET_AR}`).toISOString();

/** Arranque del día argentino (00:00:00) como instante UTC. */
export const inicioDelDia = (fecha) => arAUTC(fecha, '00:00', '00');

/** Fin del día argentino (23:59:59) como instante UTC. */
export const finDelDia = (fecha) => arAUTC(fecha, '23:59', '59');

// ── Formateo para mostrar ───────────────────────────────────

export const formatearFecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export const formatearHora = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export const formatearFechaHora = (iso) =>
  iso ? `${formatearFecha(iso)} ${formatearHora(iso)}` : '';

/** YYYY-MM-DD en hora argentina — para agrupar y comparar por día. */
export const diaDe = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '';

/** ¿Este instante cae hoy, según el calendario argentino? */
export const esHoy = (iso) => diaDe(iso) === hoyAR();

// ── Plata ───────────────────────────────────────────────────

export const formatearMonto = (n) =>
  '$' + Math.round(n || 0).toLocaleString('es-AR');
