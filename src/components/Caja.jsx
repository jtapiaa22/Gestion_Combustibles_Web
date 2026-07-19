import { useEffect, useState } from 'react';
import { cajaAPI } from '../lib/api.js';
import { formatearMonto, formatearFechaHora, formatearHora, formatearFecha } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { Modal } from './Modal.jsx';

const REFRESCO_MS = 30000;

/** Cuánto hace que está abierta, en palabras. */
function duracion(desde, hasta = new Date()) {
  const minutos = Math.max(0, Math.round((new Date(hasta) - new Date(desde)) / 60000));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  if (h < 24) return `${h} h ${m} min`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'día' : 'días'} ${h % 24} h`;
}

function Metrica({ etiqueta, valor, color, chico }) {
  return (
    <div className="card" style={{ padding: 14, flex: '1 1 140px', minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.04em' }}>
        {etiqueta}
      </div>
      <div style={{ fontSize: chico ? 18 : 22, fontWeight: 700, color: color || 'var(--text)', marginTop: 2 }}>
        {valor}
      </div>
    </div>
  );
}

export function Caja() {
  const { mostrar, Notificacion } = useNotificacion();

  const [tab, setTab] = useState('actual');
  const [abierta, setAbierta] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [modalAbrir, setModalAbrir] = useState(false);
  const [modalCerrar, setModalCerrar] = useState(false);
  const [notas, setNotas] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargar = async () => {
    try {
      const [sesion, hist] = await Promise.all([cajaAPI.obtenerCajaAbierta(), cajaAPI.obtenerHistorial()]);
      setAbierta(sesion);
      setHistorial(hist);
      setResumen(sesion ? await cajaAPI.obtenerResumen(sesion.id) : null);
    } catch (e) {
      mostrar(`No se pudo cargar la caja: ${e.message}`, 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  // Mientras hay caja abierta, el resumen se refresca solo
  useEffect(() => {
    if (!abierta) return;
    const t = setInterval(async () => {
      try { setResumen(await cajaAPI.obtenerResumen(abierta.id)); } catch { /* reintenta en el próximo tick */ }
    }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [abierta]);

  const abrir = async () => {
    setProcesando(true);
    try {
      await cajaAPI.abrirCaja(notas);
      mostrar('Caja abierta');
      setModalAbrir(false); setNotas('');
      await cargar();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setProcesando(false);
    }
  };

  const cerrar = async () => {
    setProcesando(true);
    try {
      await cajaAPI.cerrarCaja(abierta.id, notas);
      mostrar('Caja cerrada');
      setModalCerrar(false); setNotas('');
      await cargar();
      setTab('historial');
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setProcesando(false);
    }
  };

  const verDetalle = async (sesion) => {
    setDetalle({ sesion, datos: null });
    try {
      setDetalle({ sesion, datos: await cajaAPI.obtenerResumen(sesion.id) });
    } catch (e) {
      mostrar(e.message, 'error');
      setDetalle(null);
    }
  };

  return (
    <div className="fade-in">
      <Notificacion />

      <div className="segmentado" style={{ marginBottom: 18, maxWidth: 420 }}>
        <button className={tab === 'actual' ? 'activo' : ''} onClick={() => setTab('actual')}>
          Caja actual
        </button>
        <button className={tab === 'historial' ? 'activo' : ''} onClick={() => setTab('historial')}>
          Historial
        </button>
      </div>

      {tab === 'actual' ? (
        cargando ? (
          <div className="vacio">Cargando…</div>
        ) : !abierta ? (
          <div className="card" style={{ textAlign: 'center', padding: 36 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏦</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No hay ninguna caja abierta</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 22, lineHeight: 1.5, maxWidth: 380, marginInline: 'auto' }}>
              Abrí la caja al empezar el turno. Todo lo que vendas y cobres desde ese momento
              queda dentro, hasta que la cierres.
            </p>
            <button
              onClick={() => { setNotas(''); setModalAbrir(true); }}
              style={{ padding: '15px 34px', borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700, fontSize: 16 }}
            >
              Abrir caja
            </button>
            {historial.length > 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 18 }}>
                La última se cerró el {formatearFechaHora(historial[0].cerrada_en)}
              </p>
            )}
          </div>
        ) : (
          <CajaAbierta
            sesion={abierta}
            resumen={resumen}
            onCerrar={() => { setNotas(''); setModalCerrar(true); }}
          />
        )
      ) : (
        <Historial historial={historial} cargando={cargando} onVer={verDetalle} />
      )}

      {/* ══════════ Abrir ══════════ */}
      <Modal abierto={modalAbrir} onCerrar={() => setModalAbrir(false)} titulo="Abrir caja" ancho={420}>
        <p style={{ marginBottom: 16, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Se abre ahora, {formatearFechaHora(new Date().toISOString())}.
        </p>
        <div className="campo">
          <label>Nota (opcional)</label>
          <input
            autoFocus value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej: turno mañana"
          />
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button
            onClick={() => setModalAbrir(false)}
            style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            Cancelar
          </button>
          <button
            onClick={abrir} disabled={procesando}
            style={{ flex: 2, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700 }}
          >
            {procesando ? 'Abriendo…' : 'Abrir'}
          </button>
        </div>
      </Modal>

      {/* ══════════ Cerrar ══════════ */}
      <Modal abierto={modalCerrar} onCerrar={() => setModalCerrar(false)} titulo="Cerrar caja" ancho={460}>
        {resumen && (
          <>
            <p style={{ marginBottom: 14, color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: 14 }}>
              Estos números quedan guardados como el registro del turno y no cambian después,
              aunque se edite alguna venta.
            </p>

            <div className="sub-card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 700 }}>
                TIENE QUE HABER EN EL CAJÓN
              </div>
              <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--success)' }}>
                {formatearMonto(resumen.efectivoEnCaja)}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
                {formatearMonto(resumen.totalEfectivo)} de ventas en efectivo
                {resumen.fiadoCobradoEfectivo > 0 && (
                  <> + {formatearMonto(resumen.fiadoCobradoEfectivo)} de fiados cobrados en efectivo</>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <Metrica etiqueta="TRANSFERENCIAS" valor={formatearMonto(resumen.totalTransferencia + resumen.fiadoCobradoTransferencia)} chico />
              <Metrica etiqueta="SE FIÓ" valor={formatearMonto(resumen.totalFiadoNuevo)} color="var(--accent)" chico />
              <Metrica etiqueta="GANANCIA" valor={formatearMonto(resumen.ganancia)} color="var(--success)" chico />
            </div>

            <div className="campo">
              <label>Nota de cierre (opcional)</label>
              <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: faltaron $500" />
            </div>

            <div style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => setModalCerrar(false)}
                style={{ flex: 1, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancelar
              </button>
              <button
                onClick={cerrar} disabled={procesando}
                style={{ flex: 2, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--danger)', color: 'white', fontWeight: 700, fontSize: 15 }}
              >
                {procesando ? 'Cerrando…' : 'Cerrar caja'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ══════════ Detalle del historial ══════════ */}
      <Modal
        abierto={!!detalle}
        onCerrar={() => setDetalle(null)}
        titulo={detalle ? `Turno del ${formatearFecha(detalle.sesion.abierta_en)}` : ''}
        ancho={620}
      >
        {detalle && (detalle.datos ? <DetalleSesion sesion={detalle.sesion} datos={detalle.datos} /> : <div className="vacio">Cargando…</div>)}
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
function CajaAbierta({ sesion, resumen, onCerrar }) {
  if (!resumen) return <div className="vacio">Cargando el resumen…</div>;

  const movimientos = [
    ...resumen.ventas.map((v) => ({ tipo: 'venta', fecha: v.fecha, dato: v })),
    ...resumen.pagosFiado.map((p) => ({ tipo: 'pago', fecha: p.fecha, dato: p })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const litros = Object.entries(resumen.litrosPorCombustible || {});

  return (
    <>
      <div
        className="card"
        style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderLeft: '4px solid var(--success)' }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--success)', display: 'inline-block' }} />
            <strong style={{ fontSize: 16 }}>Caja abierta</strong>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginTop: 3 }}>
            Desde {formatearFechaHora(sesion.abierta_en)} · hace {duracion(sesion.abierta_en)}
          </div>
          {sesion.notas_apertura && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 3 }}>{sesion.notas_apertura}</div>
          )}
        </div>
        <button
          onClick={onCerrar}
          style={{ padding: '13px 24px', borderRadius: 'var(--radius)', backgroundColor: 'var(--danger)', color: 'white', fontWeight: 700, fontSize: 15 }}
        >
          Cerrar caja
        </button>
      </div>

      {/* En el cajón */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.04em' }}>
          TIENE QUE HABER EN EL CAJÓN
        </div>
        <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--success)' }}>
          {formatearMonto(resumen.efectivoEnCaja)}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
          {formatearMonto(resumen.totalEfectivo)} de ventas
          {resumen.fiadoCobradoEfectivo > 0 && <> + {formatearMonto(resumen.fiadoCobradoEfectivo)} de fiados cobrados</>}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Metrica etiqueta="TRANSFERENCIAS" valor={formatearMonto(resumen.totalTransferencia + resumen.fiadoCobradoTransferencia)} />
        <Metrica etiqueta="SE FIÓ" valor={formatearMonto(resumen.totalFiadoNuevo)} color="var(--accent)" />
        <Metrica etiqueta="GANANCIA" valor={formatearMonto(resumen.ganancia)} color="var(--success)" />
        <Metrica etiqueta="VENTAS" valor={String(resumen.cantidadVentas)} />
      </div>

      {litros.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 7 }}>
            DESPACHADO
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {litros.map(([nombre, l]) => (
              <div key={nombre}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{l.toFixed(2)} L</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}> de {nombre}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="titulo-seccion" style={{ marginBottom: 9 }}>Movimientos del turno</h3>
      {movimientos.length === 0 ? (
        <div className="vacio">Todavía no hubo movimientos en este turno</div>
      ) : (
        <div className="lista-tarjetas" style={{ gap: 7 }}>
          {movimientos.map((m) => (
            <div key={`${m.tipo}-${m.dato.id}`} className="venta-tarjeta">
              <div className="fila">
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 15.5 }}>{formatearMonto(m.tipo === 'venta' ? m.dato.total : m.dato.monto)}</strong>
                  <div className="detalle">
                    {formatearHora(m.fecha)}
                    {m.tipo === 'venta' ? (
                      <> · {m.dato.combustible_nombre} · {m.dato.cantidad_litros.toFixed(2)} L
                        {m.dato.cliente_nombre ? ` · ${m.dato.cliente_nombre}` : ''}</>
                    ) : (
                      <> · cobro de fiado{m.dato.cliente_nombre ? ` · ${m.dato.cliente_nombre}` : ''}</>
                    )}
                  </div>
                </div>
                <span
                  className="badge"
                  style={{
                    flexShrink: 0,
                    backgroundColor:
                      m.tipo === 'pago' ? 'var(--blue)'
                      : m.dato.es_fiado ? 'var(--accent-dark)'
                      : 'var(--success)',
                  }}
                >
                  {m.tipo === 'pago' ? `Cobro ${m.dato.metodo_pago}` : m.dato.es_fiado ? 'Fiado' : m.dato.metodo_pago}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════
function Historial({ historial, cargando, onVer }) {
  const cerradas = historial.filter((s) => s.cerrada_en);

  if (cargando) return <div className="vacio">Cargando…</div>;
  if (cerradas.length === 0) return <div className="vacio">Todavía no cerraste ninguna caja</div>;

  return (
    <div className="lista-tarjetas" style={{ gap: 8 }}>
      {cerradas.map((s) => (
        <button key={s.id} className="fila-cliente" onClick={() => onVer(s)} style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="nombre">{formatearFecha(s.abierta_en)}</div>
            <div className="sub">
              {formatearHora(s.abierta_en)} a {formatearHora(s.cerrada_en)} · {duracion(s.abierta_en, s.cerrada_en)}
              {' · '}{s.cantidad_ventas || 0} ventas
            </div>
            {s.notas_cierre && (
              <div className="sub" style={{ color: 'var(--accent)' }}>{s.notas_cierre}</div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 700 }}>{formatearMonto(s.total_cobrado)}</div>
            {Number(s.total_fiado_nuevo) > 0 && (
              <div style={{ fontSize: 12, color: 'var(--accent)' }}>
                {formatearMonto(s.total_fiado_nuevo)} fiado
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
/**
 * Detalle de un turno cerrado. Se muestran los totales CONGELADOS de
 * la sesión, no los recalculados: son el registro contable de ese
 * turno y no deben moverse aunque después se edite una venta.
 */
function DetalleSesion({ sesion, datos }) {
  const litros = sesion.litros_por_combustible || datos.litrosPorCombustible || {};
  const movimientos = [
    ...datos.ventas.map((v) => ({ tipo: 'venta', fecha: v.fecha, dato: v })),
    ...datos.pagosFiado.map((p) => ({ tipo: 'pago', fecha: p.fecha, dato: p })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return (
    <>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginBottom: 14 }}>
        {formatearFechaHora(sesion.abierta_en)} → {formatearFechaHora(sesion.cerrada_en)}
        {' · '}{duracion(sesion.abierta_en, sesion.cerrada_en)}
      </div>

      {(sesion.notas_apertura || sesion.notas_cierre) && (
        <div className="sub-card" style={{ marginBottom: 14, fontSize: 14 }}>
          {sesion.notas_apertura && <div>Apertura: {sesion.notas_apertura}</div>}
          {sesion.notas_cierre && <div>Cierre: {sesion.notas_cierre}</div>}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Metrica etiqueta="EFECTIVO" valor={formatearMonto(sesion.total_efectivo)} chico />
        <Metrica etiqueta="TRANSFERENCIA" valor={formatearMonto(sesion.total_transferencia)} chico />
        <Metrica etiqueta="COBRADO" valor={formatearMonto(sesion.total_cobrado)} color="var(--success)" chico />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Metrica etiqueta="SE FIÓ" valor={formatearMonto(sesion.total_fiado_nuevo)} color="var(--accent)" chico />
        <Metrica etiqueta="FIADOS COBRADOS" valor={formatearMonto(sesion.total_fiado_cobrado)} color="var(--blue)" chico />
        <Metrica etiqueta="GANANCIA" valor={formatearMonto(sesion.ganancia)} color="var(--success)" chico />
      </div>

      {Object.keys(litros).length > 0 && (
        <div className="sub-card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 6 }}>DESPACHADO</div>
          {Object.entries(litros).map(([nombre, l]) => (
            <div key={nombre} style={{ fontSize: 14.5 }}>
              <strong>{Number(l).toFixed(2)} L</strong> de {nombre}
            </div>
          ))}
        </div>
      )}

      <h3 className="titulo-seccion" style={{ marginBottom: 9 }}>
        Movimientos ({movimientos.length})
      </h3>
      {movimientos.length === 0 ? (
        <div className="vacio">Sin movimientos</div>
      ) : (
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th>Hora</th><th>Qué</th><th>Detalle</th><th>Monto</th></tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={`${m.tipo}-${m.dato.id}`}>
                  <td>{formatearHora(m.fecha)}</td>
                  <td>{m.tipo === 'pago' ? 'Cobro fiado' : m.dato.es_fiado ? 'Fiado' : m.dato.metodo_pago}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {m.tipo === 'venta'
                      ? `${m.dato.combustible_nombre} ${m.dato.cantidad_litros.toFixed(2)} L${m.dato.cliente_nombre ? ` · ${m.dato.cliente_nombre}` : ''}`
                      : m.dato.cliente_nombre || '—'}
                  </td>
                  <td><strong>{formatearMonto(m.tipo === 'venta' ? m.dato.total : m.dato.monto)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
