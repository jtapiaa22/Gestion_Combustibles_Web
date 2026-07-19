import { useEffect, useState } from 'react';
import { combustiblesAPI, clientesAPI, ventasAPI, cajaAPI } from '../lib/api.js';
import { formatearMonto, formatearFecha, formatearHora, esHoy, hoyAR } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';

const STOCK_BAJO = 100;

function Tarjeta({ etiqueta, valor, detalle, color, onClick }) {
  const Elemento = onClick ? 'button' : 'div';
  return (
    <Elemento
      onClick={onClick}
      className="card"
      style={{
        padding: 16, flex: '1 1 180px', minWidth: 0, textAlign: 'left',
        borderLeft: `4px solid ${color || 'var(--border)'}`,
        cursor: onClick ? 'pointer' : 'default', color: 'var(--text)',
      }}
    >
      <div style={{ fontSize: '0.7188rem', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.04em' }}>
        {etiqueta}
      </div>
      <div style={{ fontSize: '1.625rem', fontWeight: 700, color: color || 'var(--text)', marginTop: 2, lineHeight: 1.1 }}>
        {valor}
      </div>
      {detalle && (
        <div style={{ fontSize: '0.7812rem', color: 'var(--text-muted)', marginTop: 4 }}>{detalle}</div>
      )}
    </Elemento>
  );
}

export function Inicio({ irA }) {
  const { mostrar, Notificacion } = useNotificacion();
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [combustibles, clientes, ventas, caja] = await Promise.all([
          combustiblesAPI.obtenerTodos(),
          clientesAPI.obtenerTodos(),
          ventasAPI.obtenerTodas(),
          cajaAPI.obtenerCajaAbierta(),
        ]);

        const deHoy = ventas.filter((v) => esHoy(v.fecha));
        setDatos({
          combustibles,
          caja,
          ultimas: ventas.slice(0, 6),
          cobradoHoy: deHoy.filter((v) => !v.es_fiado).reduce((s, v) => s + v.total, 0),
          fiadoHoy: deHoy.filter((v) => v.es_fiado).reduce((s, v) => s + v.total, 0),
          ventasHoy: deHoy.length,
          deuda: clientes.reduce((s, c) => s + c.debe, 0),
          deudores: clientes.filter((c) => c.debe > 0.5).length,
        });
      } catch (e) {
        mostrar(`No se pudo cargar: ${e.message}`, 'error');
      }
    })();
  }, []);

  if (!datos) return <div className="vacio">Cargando…</div>;

  const fechaLarga = new Date().toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const bajos = datos.combustibles.filter((c) => c.cantidad_litros < STOCK_BAJO);

  return (
    <div className="fade-in">
      <Notificacion />

      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Hoy</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textTransform: 'capitalize' }}>{fechaLarga}</p>
      </div>

      {/* Estado de la caja: lo primero que hay que saber al llegar */}
      <div
        className="card"
        style={{
          marginBottom: 14, display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 12, flexWrap: 'wrap',
          borderLeft: `4px solid ${datos.caja ? 'var(--success)' : 'var(--text-muted)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 10, height: 10, borderRadius: '50%',
              backgroundColor: datos.caja ? 'var(--success)' : 'var(--text-muted)',
              flexShrink: 0,
            }}
          />
          <div>
            <strong style={{ fontSize: '0.9688rem' }}>
              {datos.caja ? 'Caja abierta' : 'No hay caja abierta'}
            </strong>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              {datos.caja
                ? `Desde ${formatearFecha(datos.caja.abierta_en)} a las ${formatearHora(datos.caja.abierta_en)}`
                : 'Abrila para empezar el turno'}
            </div>
          </div>
        </div>
        <button onClick={() => irA('caja')} className="theme-toggle" style={{ flexShrink: 0 }}>
          {datos.caja ? 'Ver caja' : 'Abrir caja'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <Tarjeta
          etiqueta="COBRADO HOY"
          valor={formatearMonto(datos.cobradoHoy)}
          detalle={`${datos.ventasHoy} ${datos.ventasHoy === 1 ? 'venta' : 'ventas'}`}
          color="var(--success)"
        />
        {datos.fiadoHoy > 0 && (
          <Tarjeta etiqueta="FIADO HOY" valor={formatearMonto(datos.fiadoHoy)} color="var(--accent)" />
        )}
        <Tarjeta
          etiqueta="LE DEBEN"
          valor={formatearMonto(datos.deuda)}
          detalle={`${datos.deudores} ${datos.deudores === 1 ? 'cliente' : 'clientes'}`}
          color={datos.deuda > 0 ? 'var(--accent)' : 'var(--text-muted)'}
          onClick={() => irA('clientes')}
        />
      </div>

      {/* Tanques */}
      <h2 className="titulo-seccion" style={{ marginBottom: 9 }}>Tanques</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
        {datos.combustibles.map((c) => (
          <Tarjeta
            key={c.id}
            etiqueta={c.nombre.toUpperCase()}
            valor={`${c.cantidad_litros.toFixed(1)} L`}
            detalle={`${formatearMonto(c.precio_por_litro)} por litro`}
            color={c.cantidad_litros < STOCK_BAJO ? 'var(--accent)' : 'var(--blue)'}
            onClick={() => irA('stock')}
          />
        ))}
      </div>

      {bajos.length > 0 && (
        <div className="sub-card" style={{ marginBottom: 18, borderColor: 'var(--accent)', fontSize: '0.875rem' }}>
          Queda poco de <strong>{bajos.map((c) => c.nombre).join(', ')}</strong>. Conviene reponer.
        </div>
      )}

      {/* Últimas ventas */}
      <h2 className="titulo-seccion" style={{ margin: '18px 0 9px' }}>Últimas ventas</h2>
      {datos.ultimas.length === 0 ? (
        <div className="vacio">Todavía no hay ventas registradas</div>
      ) : (
        <div className="lista-tarjetas" style={{ gap: 7 }}>
          {datos.ultimas.map((v) => (
            <div key={v.id} className="venta-tarjeta">
              <div className="fila">
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: '0.9688rem' }}>{formatearMonto(v.total)}</strong>
                  <div className="detalle">
                    {esHoy(v.fecha) ? formatearHora(v.fecha) : formatearFecha(v.fecha)}
                    {' · '}{v.combustible_nombre} · {v.cantidad_litros.toFixed(2)} L
                    {v.cliente_nombre ? ` · ${v.cliente_nombre}` : ''}
                  </div>
                </div>
                <span
                  className="badge"
                  style={{
                    flexShrink: 0,
                    backgroundColor: !v.es_fiado ? 'var(--success)' : v.pagado ? 'var(--blue)' : 'var(--accent-dark)',
                  }}
                >
                  {!v.es_fiado ? v.metodo_pago : v.pagado ? 'Saldado' : 'Fiado'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
