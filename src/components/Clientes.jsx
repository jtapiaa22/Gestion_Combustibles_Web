import { useEffect, useMemo, useState } from 'react';
import { clientesAPI, ventasAPI } from '../lib/api.js';
import { formatearMonto, formatearFecha, formatearFechaHora } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { useEsEscritorio } from '../hooks/useAncho.js';
import { Modal } from './Modal.jsx';

export function Clientes() {
  const { mostrar, Notificacion } = useNotificacion();
  const esEscritorio = useEsEscritorio();

  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [soloDeudores, setSoloDeudores] = useState(false);

  const [seleccionadoId, setSeleccionadoId] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const [formCliente, setFormCliente] = useState(null); // {id?, nombre, telefono, direccion}
  const [guardando, setGuardando] = useState(false);
  const [aBorrar, setABorrar] = useState(null);
  const [cobro, setCobro] = useState(null); // {tipo:'venta'|'cliente', ...}

  const seleccionado = clientes.find((c) => c.id === seleccionadoId) || null;

  // ── Carga ─────────────────────────────────────────────────
  const cargarClientes = async () => {
    try {
      setClientes(await clientesAPI.obtenerTodos());
    } catch (e) {
      mostrar(`No se pudieron cargar los clientes: ${e.message}`, 'error');
    } finally {
      setCargando(false);
    }
  };

  const cargarHistorial = async (id) => {
    setCargandoHistorial(true);
    try {
      setHistorial(await clientesAPI.obtenerHistorial(id));
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setCargandoHistorial(false);
    }
  };

  useEffect(() => { cargarClientes(); }, []);
  useEffect(() => {
    if (seleccionadoId) cargarHistorial(seleccionadoId);
    else setHistorial([]);
  }, [seleccionadoId]);

  const refrescar = async () => {
    await cargarClientes();
    if (seleccionadoId) await cargarHistorial(seleccionadoId);
  };

  // ── Derivados ─────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return clientes
      .filter((c) => (!q || c.nombre.toLowerCase().includes(q)) && (!soloDeudores || c.debe > 0.5))
      .sort((a, b) => b.debe - a.debe || a.nombre.localeCompare(b.nombre));
  }, [clientes, busqueda, soloDeudores]);

  const deudaTotal = clientes.reduce((s, c) => s + c.debe, 0);
  const deudores = clientes.filter((c) => c.debe > 0.5).length;

  const fiadosAbiertos = useMemo(
    () => historial.filter((v) => v.es_fiado && !v.pagado).sort((a, b) => new Date(a.fecha) - new Date(b.fecha)),
    [historial]
  );

  // ── Acciones ──────────────────────────────────────────────
  const guardarCliente = async () => {
    if (!formCliente.nombre?.trim()) { mostrar('Poné el nombre', 'error'); return; }
    setGuardando(true);
    try {
      if (formCliente.id) {
        await clientesAPI.editar(formCliente.id, formCliente);
        mostrar('Cliente actualizado');
      } else {
        const nuevo = await clientesAPI.agregar(formCliente.nombre, formCliente.telefono, formCliente.direccion);
        mostrar('Cliente agregado');
        setSeleccionadoId(nuevo.id);
      }
      setFormCliente(null);
      await cargarClientes();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const borrarCliente = async () => {
    setGuardando(true);
    try {
      await clientesAPI.eliminar(aBorrar.id);
      mostrar('Cliente eliminado');
      if (seleccionadoId === aBorrar.id) setSeleccionadoId(null);
      setABorrar(null);
      await cargarClientes();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fade-in">
      <Notificacion />

      {/* Resumen. En el teléfono desaparece al abrir un cliente: son
          totales de la lista, y ahí ocupan el espacio que necesita lo
          que se vino a ver, que es cuánto debe ESE cliente. */}
      {(esEscritorio || !seleccionado) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: '1 1 150px', padding: 14 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>DEUDA TOTAL</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: deudaTotal > 0 ? 'var(--accent)' : 'var(--text)' }}>
              {formatearMonto(deudaTotal)}
            </div>
          </div>
          <div className="card" style={{ flex: '1 1 150px', padding: 14 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>DEBEN / TOTAL</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{deudores} <span style={{ color: 'var(--text-muted)', fontSize: '1.125rem' }}>/ {clientes.length}</span></div>
          </div>
        </div>
      )}

      <div className="md-layout">
        {/* ══════════ Lista ══════════ */}
        {(esEscritorio || !seleccionado) && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="search"
                placeholder="Buscar cliente…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <button
                onClick={() => setFormCliente({ nombre: '', telefono: '', direccion: '' })}
                style={{ flexShrink: 0, padding: '0 16px', borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontSize: '1.25rem' }}
                title="Cliente nuevo"
              >
                +
              </button>
            </div>

            <button
              onClick={() => setSoloDeudores((v) => !v)}
              style={{
                marginBottom: 10, padding: '7px 13px', borderRadius: 20, fontSize: '0.8125rem',
                border: '1.5px solid ' + (soloDeudores ? 'var(--accent)' : 'var(--border)'),
                backgroundColor: soloDeudores ? 'var(--accent)' : 'transparent',
                color: soloDeudores ? '#1C1917' : 'var(--text-secondary)',
              }}
            >
              Solo los que deben
            </button>

            {cargando ? (
              <div className="vacio">Cargando…</div>
            ) : filtrados.length === 0 ? (
              <div className="vacio">
                {busqueda ? `Ningún cliente coincide con "${busqueda}"` : 'Todavía no hay clientes'}
              </div>
            ) : (
              <div className="lista-tarjetas" style={{ gap: 7 }}>
                {filtrados.map((c) => (
                  <button
                    key={c.id}
                    className={`fila-cliente ${seleccionadoId === c.id ? 'activo' : ''}`}
                    onClick={() => setSeleccionadoId(c.id)}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="nombre" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.nombre}
                      </div>
                      <div className="sub">
                        {c.fiados_abiertos > 0
                          ? `${c.fiados_abiertos} ${c.fiados_abiertos === 1 ? 'fiado abierto' : 'fiados abiertos'}`
                          : c.total_compras > 0 ? `${c.total_compras} compras` : 'sin compras'}
                      </div>
                    </div>
                    {c.debe > 0.5 && (
                      <strong style={{ color: 'var(--accent)', whiteSpace: 'nowrap' }}>{formatearMonto(c.debe)}</strong>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════ Detalle ══════════ */}
        {seleccionado && (
          <div className="card">
            {!esEscritorio && (
              <button
                onClick={() => setSeleccionadoId(null)}
                style={{ marginBottom: 12, background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.875rem', padding: 0 }}
              >
                ← Volver a la lista
              </button>
            )}

            {/* Nombre y contacto en una línea: lo que se vino a ver es
                cuánto debe, no el teléfono. */}
            <h2 style={{ fontSize: '1.3125rem', fontWeight: 700, marginBottom: 2 }}>{seleccionado.nombre}</h2>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8438rem', marginBottom: 14 }}>
              {[seleccionado.telefono, seleccionado.direccion].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
            </div>

            {/* Deuda */}
            {seleccionado.debe > 0.5 ? (
              <div className="sub-card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.7812rem', color: 'var(--text-secondary)', fontWeight: 600 }}>DEBE</div>
                    <div style={{ fontSize: '1.6875rem', fontWeight: 700, color: 'var(--accent)' }}>
                      {formatearMonto(seleccionado.debe)}
                    </div>
                    <div style={{ fontSize: '0.7812rem', color: 'var(--text-muted)' }}>
                      en {fiadosAbiertos.length} {fiadosAbiertos.length === 1 ? 'fiado' : 'fiados'}
                    </div>
                  </div>
                  {/* Al envolverse en pantalla angosta ocupa el ancho
                      completo, en vez de quedar como un botón perdido. */}
                  <button
                    onClick={() => setCobro({ tipo: 'cliente', cliente: seleccionado })}
                    style={{ flex: '1 1 130px', padding: '13px 20px', borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontSize: '0.9375rem', fontWeight: 700 }}
                  >
                    Cobrar
                  </button>
                </div>
              </div>
            ) : (
              <div className="sub-card" style={{ marginBottom: 16, color: 'var(--success)', fontWeight: 600 }}>
                No debe nada
              </div>
            )}

            {/* Fiados abiertos */}
            {fiadosAbiertos.length > 0 && (
              <>
                <h3 className="titulo-seccion" style={{ marginBottom: 9 }}>Fiados abiertos</h3>
                <div className="lista-tarjetas" style={{ marginBottom: 18, gap: 7 }}>
                  {fiadosAbiertos.map((v) => (
                    <div key={v.id} className="venta-tarjeta">
                      <div className="fila">
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: '1rem', color: 'var(--accent)' }}>{formatearMonto(v.saldo)}</strong>
                          <div className="detalle">
                            {formatearFecha(v.fecha)} · {v.combustible_nombre} · {v.cantidad_litros.toFixed(2)} L
                            {v.cobrado > 0.01 && <> · pagó {formatearMonto(v.cobrado)} de {formatearMonto(v.total)}</>}
                          </div>
                        </div>
                        <button
                          onClick={() => setCobro({ tipo: 'venta', venta: v })}
                          style={{ flexShrink: 0, padding: '9px 15px', borderRadius: 8, backgroundColor: 'var(--success)', color: 'white', fontSize: '0.875rem' }}
                        >
                          Cobrar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Datos del cliente: acciones que se usan cada tanto, así
                que van después de la plata y no compitiendo con ella. */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button
                onClick={() => setFormCliente({ ...seleccionado })}
                className="theme-toggle"
                style={{ flex: 1, padding: 10 }}
              >
                Editar datos
              </button>
              <button
                onClick={() => setABorrar(seleccionado)}
                className="theme-toggle"
                style={{ flex: 1, padding: 10, color: 'var(--danger)' }}
              >
                Borrar cliente
              </button>
            </div>

            {/* Historial */}
            <h3 className="titulo-seccion" style={{ marginBottom: 9 }}>Historial</h3>
            {cargandoHistorial ? (
              <div className="vacio">Cargando…</div>
            ) : historial.length === 0 ? (
              <div className="vacio">Sin compras registradas</div>
            ) : esEscritorio ? (
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Fecha</th><th>Combustible</th><th>Litros</th><th>Total</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {historial.map((v) => (
                      <tr key={v.id}>
                        <td>{formatearFecha(v.fecha)}</td>
                        <td>{v.combustible_nombre}</td>
                        <td>{v.cantidad_litros.toFixed(2)} L</td>
                        <td><strong>{formatearMonto(v.total)}</strong></td>
                        <td>
                          {!v.es_fiado ? (
                            <span style={{ color: 'var(--text-secondary)' }}>{v.metodos_pago}</span>
                          ) : v.pagado ? (
                            <span className="badge" style={{ backgroundColor: 'var(--success)' }}>Saldado</span>
                          ) : (
                            <span className="badge" style={{ backgroundColor: 'var(--accent-dark)' }}>
                              debe {formatearMonto(v.saldo)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* En el teléfono, tarjetas: una tabla de cinco columnas
                 obliga a deslizar para el costado para leerla. */
              <div className="lista-tarjetas" style={{ gap: 7 }}>
                {historial.map((v) => (
                  <div key={v.id} className="venta-tarjeta">
                    <div className="fila">
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: '0.9688rem' }}>{formatearMonto(v.total)}</strong>
                        <div className="detalle">
                          {formatearFecha(v.fecha)} · {v.combustible_nombre} · {v.cantidad_litros.toFixed(2)} L
                        </div>
                      </div>
                      {!v.es_fiado ? (
                        <span className="badge" style={{ flexShrink: 0, backgroundColor: 'var(--success)' }}>
                          {v.metodos_pago}
                        </span>
                      ) : v.pagado ? (
                        <span className="badge" style={{ flexShrink: 0, backgroundColor: 'var(--blue)' }}>Saldado</span>
                      ) : (
                        <span className="badge" style={{ flexShrink: 0, backgroundColor: 'var(--accent-dark)' }}>
                          debe {formatearMonto(v.saldo)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {esEscritorio && !seleccionado && (
          <div className="vacio" style={{ marginTop: 40 }}>Elegí un cliente de la lista</div>
        )}
      </div>

      {/* ══════════ Modales ══════════ */}
      <FormClienteModal
        form={formCliente}
        setForm={setFormCliente}
        onGuardar={guardarCliente}
        guardando={guardando}
      />

      <BorrarClienteModal
        cliente={aBorrar}
        onCerrar={() => setABorrar(null)}
        onConfirmar={borrarCliente}
        borrando={guardando}
      />

      <CobroModal
        cobro={cobro}
        fiadosAbiertos={fiadosAbiertos}
        onCerrar={() => setCobro(null)}
        onListo={async (mensaje) => { setCobro(null); mostrar(mensaje); await refrescar(); }}
        onError={(m) => mostrar(m, 'error')}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════
function FormClienteModal({ form, setForm, onGuardar, guardando }) {
  if (!form) return null;
  const editando = !!form.id;
  return (
    <Modal abierto onCerrar={() => setForm(null)} titulo={editando ? 'Editar cliente' : 'Cliente nuevo'}>
      <div className="campo">
        <label>Nombre</label>
        <input
          autoFocus value={form.nombre || ''}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
        />
      </div>
      <div className="campo">
        <label>Teléfono</label>
        <input
          type="tel" inputMode="tel" value={form.telefono || ''}
          onChange={(e) => setForm({ ...form, telefono: e.target.value })}
        />
      </div>
      <div className="campo">
        <label>Dirección</label>
        <input
          value={form.direccion || ''}
          onChange={(e) => setForm({ ...form, direccion: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 4 }}>
        <button
          onClick={() => setForm(null)}
          style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Cancelar
        </button>
        <button
          onClick={onGuardar} disabled={guardando}
          style={{ flex: 2, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700 }}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════
function BorrarClienteModal({ cliente, onCerrar, onConfirmar, borrando }) {
  if (!cliente) return null;
  // La base tiene ON DELETE RESTRICT sobre ventas: un cliente con
  // historial no se puede borrar sin llevarse esos registros. Lo
  // decimos acá en vez de dejar que falle al apretar.
  const tieneVentas = cliente.total_compras > 0;

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Eliminar cliente" ancho={400}>
      {tieneVentas ? (
        <>
          <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
            <strong>{cliente.nombre}</strong> tiene {cliente.total_compras}{' '}
            {cliente.total_compras === 1 ? 'compra registrada' : 'compras registradas'}
            {cliente.debe > 0.5 && <> y debe {formatearMonto(cliente.debe)}</>}.
          </p>
          <p style={{ marginBottom: 18, color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
            No se puede borrar sin perder esas ventas, que forman parte de los registros del negocio.
            Si ya no le vendés, simplemente dejalo sin usar.
          </p>
          <button
            onClick={onCerrar}
            style={{ width: '100%', padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          >
            Entendido
          </button>
        </>
      ) : (
        <>
          <p style={{ marginBottom: 20, lineHeight: 1.5 }}>
            ¿Borrar a <strong>{cliente.nombre}</strong>? No tiene ninguna compra registrada, así que no se pierde nada.
          </p>
          <div style={{ display: 'flex', gap: 9 }}>
            <button
              onClick={onCerrar}
              style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Cancelar
            </button>
            <button
              onClick={onConfirmar} disabled={borrando}
              style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--danger)', color: 'white', fontWeight: 700 }}
            >
              {borrando ? 'Borrando…' : 'Borrar'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════
function CobroModal({ cobro, fiadosAbiertos, onCerrar, onListo, onError }) {
  const [monto, setMonto] = useState('');
  const [saldarTodo, setSaldarTodo] = useState(false);
  const [metodo, setMetodo] = useState('Efectivo');
  const [titular, setTitular] = useState('');
  const [pagos, setPagos] = useState([]);
  const [registrando, setRegistrando] = useState(false);

  const esVenta = cobro?.tipo === 'venta';
  const maximo = esVenta ? cobro.venta.saldo : cobro?.cliente.debe || 0;

  useEffect(() => {
    if (!cobro) return;
    setMonto(''); setSaldarTodo(false); setMetodo('Efectivo'); setTitular(''); setPagos([]);
    if (esVenta) {
      ventasAPI.obtenerPagosFiado(cobro.venta.id).then(setPagos).catch(() => {});
    }
  }, [cobro]);

  if (!cobro) return null;

  const montoFinal = saldarTodo ? maximo : parseFloat(monto) || 0;
  const restante = maximo - montoFinal;

  // Qué fiados cubre el monto, del más viejo al más nuevo
  const cobertura = (() => {
    if (esVenta || montoFinal <= 0) return [];
    let queda = montoFinal;
    return fiadosAbiertos.map((v) => {
      const aplicado = Math.min(Math.max(queda, 0), v.saldo);
      queda -= aplicado;
      return { venta: v, aplicado };
    });
  })();

  const problema =
    montoFinal <= 0 ? 'Poné cuánto paga'
    : montoFinal > maximo + 0.01 ? `No puede pagar más de ${formatearMonto(maximo)}`
    : metodo === 'Transferencia' && !titular.trim() ? 'Poné quién transfiere'
    : null;

  const confirmar = async () => {
    if (problema) return;
    setRegistrando(true);
    try {
      const tit = metodo === 'Transferencia' ? titular.trim() : null;
      if (esVenta) {
        const r = await ventasAPI.registrarPago(cobro.venta.id, montoFinal, metodo, tit);
        onListo(r.saldado ? 'Fiado saldado' : `Cobrado ${formatearMonto(montoFinal)} · quedan ${formatearMonto(r.totalRestante)}`);
      } else {
        const r = await ventasAPI.pagarDeudaCliente(cobro.cliente.id, montoFinal, metodo, tit);
        const n = r.ventasSaldadas.length;
        onListo(
          n > 0
            ? `${n} ${n === 1 ? 'fiado saldado' : 'fiados saldados'}${r.ventasParciales.length ? ' y uno parcial' : ''}`
            : `Cobrado ${formatearMonto(r.montoAplicado)}`
        );
      }
    } catch (e) {
      onError(e.message || 'No se pudo registrar el cobro');
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <Modal abierto onCerrar={onCerrar} titulo={esVenta ? 'Cobrar fiado' : `Cobrar a ${cobro.cliente.nombre}`}>
      {/* Qué se está cobrando */}
      <div className="sub-card" style={{ marginBottom: 16 }}>
        {esVenta ? (
          <>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {formatearFecha(cobro.venta.fecha)} · {cobro.venta.combustible_nombre} · {cobro.venta.cantidad_litros.toFixed(2)} L
            </div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--accent)', marginTop: 3 }}>
              Debe {formatearMonto(maximo)}
            </div>
            {cobro.venta.cobrado > 0.01 && (
              <div style={{ fontSize: '0.7812rem', color: 'var(--text-muted)' }}>
                Ya pagó {formatearMonto(cobro.venta.cobrado)} de {formatearMonto(cobro.venta.total)}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {fiadosAbiertos.length} {fiadosAbiertos.length === 1 ? 'fiado abierto' : 'fiados abiertos'}
            </div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--accent)', marginTop: 3 }}>
              Debe {formatearMonto(maximo)}
            </div>
            <div style={{ fontSize: '0.7812rem', color: 'var(--text-muted)' }}>
              Se salda del más viejo al más nuevo
            </div>
          </>
        )}
      </div>

      {/* Pagos anteriores */}
      {pagos.length > 0 && (
        <div className="campo">
          <label>Ya pagó</label>
          <div className="sub-card" style={{ padding: 0 }}>
            {pagos.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  padding: '8px 12px', fontSize: '0.8125rem',
                  borderBottom: i < pagos.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span><strong style={{ color: 'var(--success)' }}>{formatearMonto(p.monto)}</strong> · {p.metodo_pago}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{formatearFechaHora(p.fecha)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cuánto */}
      <div className="campo">
        <label>Cuánto paga</label>
        <div className="segmentado" style={{ marginBottom: 9 }}>
          <button className={!saldarTodo ? 'activo' : ''} onClick={() => { setSaldarTodo(false); setMonto(''); }}>
            Una parte
          </button>
          <button className={saldarTodo ? 'activo' : ''} onClick={() => setSaldarTodo(true)}>
            Todo ({formatearMonto(maximo)})
          </button>
        </div>
        {!saldarTodo && (
          <input
            type="number" inputMode="decimal" step="any" min="0" autoFocus
            value={monto} onChange={(e) => setMonto(e.target.value)}
            placeholder={`Máximo ${formatearMonto(maximo)}`}
          />
        )}
      </div>

      {/* Cómo */}
      <div className="campo">
        <label>Cómo paga</label>
        <div className="segmentado">
          {['Efectivo', 'Transferencia'].map((m) => (
            <button key={m} className={metodo === m ? 'activo' : ''} onClick={() => { setMetodo(m); setTitular(''); }}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {metodo === 'Transferencia' && (
        <div className="campo">
          <label>Quién transfiere</label>
          <input value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="Nombre del titular" />
        </div>
      )}

      {/* Qué cubre */}
      {cobertura.some((c) => c.aplicado > 0) && (
        <div className="campo">
          <label>Qué salda</label>
          <div className="sub-card" style={{ padding: 0 }}>
            {cobertura.map(({ venta, aplicado }, i) => {
              const completo = aplicado >= venta.saldo - 0.01;
              return (
                <div
                  key={venta.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 10,
                    padding: '8px 12px', fontSize: '0.8125rem',
                    opacity: aplicado > 0 ? 1 : 0.4,
                    borderBottom: i < cobertura.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {formatearFecha(venta.fecha)} · {formatearMonto(venta.saldo)}
                  </span>
                  <strong style={{ color: aplicado === 0 ? 'var(--text-muted)' : completo ? 'var(--success)' : 'var(--accent)' }}>
                    {aplicado === 0 ? 'queda' : completo ? 'salda' : `${formatearMonto(aplicado)} parcial`}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {montoFinal > 0 && restante > 0.01 && (
        <div className="sub-card" style={{ marginBottom: 14, fontSize: '0.875rem' }}>
          Después de esto va a seguir debiendo <strong style={{ color: 'var(--accent)' }}>{formatearMonto(restante)}</strong>
        </div>
      )}

      {problema && monto !== '' && (
        <div className="sub-card" style={{ marginBottom: 14, borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 600, fontSize: '0.875rem' }}>
          {problema}
        </div>
      )}

      <div style={{ display: 'flex', gap: 9 }}>
        <button
          onClick={onCerrar}
          style={{ flex: 1, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Cancelar
        </button>
        <button
          onClick={confirmar} disabled={!!problema || registrando}
          style={{ flex: 2, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700, fontSize: '0.9375rem' }}
        >
          {registrando ? 'Registrando…' : `Cobrar ${formatearMonto(montoFinal)}`}
        </button>
      </div>
    </Modal>
  );
}
