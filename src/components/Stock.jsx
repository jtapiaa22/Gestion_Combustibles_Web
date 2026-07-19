import { useEffect, useState } from 'react';
import { combustiblesAPI, comprasAPI } from '../lib/api.js';
import { formatearMonto, formatearFecha, formatearFechaHora } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { Modal } from './Modal.jsx';

const STOCK_BAJO = 100; // litros

export function Stock() {
  const { mostrar, Notificacion } = useNotificacion();

  const [vista, setVista] = useState('combustibles');
  const [combustibles, setCombustibles] = useState([]);
  const [compras, setCompras] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [formCombustible, setFormCombustible] = useState(null);
  const [cambioPrecio, setCambioPrecio] = useState(null);
  const [aDesactivar, setADesactivar] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    try {
      const [cbs, cps] = await Promise.all([
        combustiblesAPI.obtenerTodos({ incluirInactivos: true }),
        comprasAPI.obtenerTodas(),
      ]);
      setCombustibles(cbs);
      setCompras(cps);
    } catch (e) {
      mostrar(`No se pudo cargar: ${e.message}`, 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const activos = combustibles.filter((c) => c.activo);
  const inactivos = combustibles.filter((c) => !c.activo);
  const valorTanque = activos.reduce((s, c) => s + c.cantidad_litros * c.precio_por_litro, 0);

  const guardarCombustible = async () => {
    if (!formCombustible.nombre?.trim()) { mostrar('Poné el nombre', 'error'); return; }
    setGuardando(true);
    try {
      if (formCombustible.id) {
        await combustiblesAPI.editar(formCombustible.id, {
          nombre: formCombustible.nombre,
          orden: Number(formCombustible.orden) || 0,
        });
        mostrar('Combustible actualizado');
      } else {
        await combustiblesAPI.crear({
          nombre: formCombustible.nombre,
          precioPorLitro: parseFloat(formCombustible.precio) || 0,
          orden: Number(formCombustible.orden) || activos.length + 1,
        });
        mostrar('Combustible agregado');
      }
      setFormCombustible(null);
      await cargar();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async () => {
    setGuardando(true);
    try {
      await combustiblesAPI.desactivar(aDesactivar.id);
      mostrar(`${aDesactivar.nombre} ya no aparece en la lista de venta`);
      setADesactivar(null);
      await cargar();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const reactivar = async (c) => {
    try {
      await combustiblesAPI.editar(c.id, { activo: true });
      mostrar(`${c.nombre} vuelve a la lista de venta`);
      await cargar();
    } catch (e) {
      mostrar(e.message, 'error');
    }
  };

  return (
    <div className="fade-in">
      <Notificacion />

      <div className="segmentado" style={{ marginBottom: 18, maxWidth: 420 }}>
        <button className={vista === 'combustibles' ? 'activo' : ''} onClick={() => setVista('combustibles')}>
          Combustibles
        </button>
        <button className={vista === 'compras' ? 'activo' : ''} onClick={() => setVista('compras')}>
          Compras
        </button>
      </div>

      {vista === 'combustibles' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>VALOR DEL TANQUE</div>
              <div style={{ fontSize: 23, fontWeight: 700 }}>{formatearMonto(valorTanque)}</div>
            </div>
            <button
              onClick={() => setFormCombustible({ nombre: '', precio: '', orden: activos.length + 1 })}
              style={{ padding: '11px 18px', borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white' }}
            >
              + Combustible
            </button>
          </div>

          {cargando ? (
            <div className="vacio">Cargando…</div>
          ) : activos.length === 0 ? (
            <div className="vacio">
              No hay combustibles cargados.<br />Agregá el primero con el botón de arriba.
            </div>
          ) : (
            <div className="lista-tarjetas">
              {activos.map((c) => {
                const bajo = c.cantidad_litros < STOCK_BAJO;
                return (
                  <div
                    key={c.id}
                    className="card"
                    style={{ borderLeft: `4px solid ${bajo ? 'var(--accent)' : 'var(--success)'}` }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                          <h3 style={{ fontSize: 18, fontWeight: 700 }}>{c.nombre}</h3>
                          {bajo && (
                            <span className="badge" style={{ backgroundColor: 'var(--accent)', color: '#1C1917' }}>
                              Stock bajo
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 19, marginTop: 5 }}>
                          <strong>{c.cantidad_litros.toFixed(2)} L</strong>
                          <span style={{ color: 'var(--text-secondary)' }}> · </span>
                          <strong style={{ color: 'var(--accent)' }}>{formatearMonto(c.precio_por_litro)}/L</strong>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                          Actualizado {formatearFechaHora(c.ultima_actualizacion)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setCambioPrecio({ combustible: c })}
                          style={{ padding: '9px 15px', borderRadius: 8, backgroundColor: 'var(--accent)', color: '#1C1917', fontSize: 14 }}
                        >
                          Precio
                        </button>
                        <button
                          onClick={() => setFormCombustible({ id: c.id, nombre: c.nombre, orden: c.orden })}
                          className="theme-toggle"
                        >
                          Renombrar
                        </button>
                        <button onClick={() => setADesactivar(c)} className="theme-toggle" style={{ color: 'var(--danger)' }}>
                          Dar de baja
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {inactivos.length > 0 && (
            <>
              <h3 className="titulo-seccion" style={{ margin: '22px 0 9px' }}>Dados de baja</h3>
              <div className="lista-tarjetas" style={{ gap: 7 }}>
                {inactivos.map((c) => (
                  <div key={c.id} className="venta-tarjeta" style={{ opacity: 0.7 }}>
                    <div className="fila">
                      <div>
                        <strong>{c.nombre}</strong>
                        <div className="detalle">Ya no aparece al vender, pero sus ventas siguen en el historial</div>
                      </div>
                      <button onClick={() => reactivar(c)} className="theme-toggle" style={{ flexShrink: 0 }}>
                        Reactivar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <ComprasVista
          combustibles={activos}
          compras={compras}
          cargando={cargando}
          onRegistrada={async (msg) => { mostrar(msg); await cargar(); }}
          onError={(m) => mostrar(m, 'error')}
        />
      )}

      {/* ══════════ Modales ══════════ */}
      <FormCombustibleModal
        form={formCombustible}
        setForm={setFormCombustible}
        onGuardar={guardarCombustible}
        guardando={guardando}
      />

      <CambioPrecioModal
        datos={cambioPrecio}
        onCerrar={() => setCambioPrecio(null)}
        onListo={async (msg) => { setCambioPrecio(null); mostrar(msg); await cargar(); }}
        onError={(m) => mostrar(m, 'error')}
      />

      <Modal abierto={!!aDesactivar} onCerrar={() => setADesactivar(null)} titulo="Dar de baja" ancho={410}>
        {aDesactivar && (
          <>
            <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
              <strong>{aDesactivar.nombre}</strong> va a dejar de aparecer cuando cargues una venta.
            </p>
            <p style={{ marginBottom: 18, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
              No se borra: las ventas y compras que ya tiene se conservan, y podés reactivarlo cuando quieras.
              {aDesactivar.cantidad_litros > 0.01 && (
                <><br /><br />
                <strong style={{ color: 'var(--danger)' }}>
                  Todavía quedan {aDesactivar.cantidad_litros.toFixed(2)} litros en el tanque
                </strong>, así que primero hay que vaciarlo.
                </>
              )}
            </p>
            <div style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => setADesactivar(null)}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancelar
              </button>
              <button
                onClick={desactivar}
                disabled={guardando || aDesactivar.cantidad_litros > 0.01}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--danger)', color: 'white', fontWeight: 700 }}
              >
                {guardando ? 'Dando de baja…' : 'Dar de baja'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
function FormCombustibleModal({ form, setForm, onGuardar, guardando }) {
  if (!form) return null;
  const editando = !!form.id;
  return (
    <Modal abierto onCerrar={() => setForm(null)} titulo={editando ? 'Renombrar combustible' : 'Combustible nuevo'}>
      <div className="campo">
        <label>Nombre</label>
        <input
          autoFocus value={form.nombre || ''}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          placeholder="Ej: Nafta Premium YPF"
        />
        <small className="ayuda">
          {editando
            ? 'Cambiarle el nombre no afecta las ventas ya registradas.'
            : 'Podés poner la marca en el nombre para diferenciar premium de distintas estaciones.'}
        </small>
      </div>

      {!editando && (
        <div className="campo">
          <label>Precio de venta por litro</label>
          <input
            type="number" inputMode="decimal" step="any" min="0"
            value={form.precio || ''}
            onChange={(e) => setForm({ ...form, precio: e.target.value })}
            placeholder="Ej: 3200"
          />
          <small className="ayuda">Arranca con el tanque vacío: los litros entran al registrar una compra.</small>
        </div>
      )}

      <div className="campo">
        <label>Orden en la lista</label>
        <input
          type="number" inputMode="numeric" step="1"
          value={form.orden ?? ''}
          onChange={(e) => setForm({ ...form, orden: e.target.value })}
        />
        <small className="ayuda">Los más chicos aparecen primero al cargar una venta.</small>
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
/**
 * Cambiar el precio no es sólo cambiar un número: revalúa las deudas
 * de los fiados abiertos de ese combustible. Antes eso pasaba en
 * silencio; acá se muestra el impacto antes de confirmar.
 */
function CambioPrecioModal({ datos, onCerrar, onListo, onError }) {
  const [precio, setPrecio] = useState('');
  const [simulacion, setSimulacion] = useState(null);
  const [simulando, setSimulando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const c = datos?.combustible;

  useEffect(() => {
    if (datos) { setPrecio(''); setSimulacion(null); }
  }, [datos]);

  // Simular con un respiro, para no consultar en cada tecla
  useEffect(() => {
    const valor = parseFloat(precio);
    if (!c || !valor || valor <= 0 || valor === c.precio_por_litro) { setSimulacion(null); return; }
    setSimulando(true);
    const t = setTimeout(async () => {
      try {
        setSimulacion(await combustiblesAPI.simularCambioPrecio(c.id, valor));
      } catch {
        setSimulacion(null);
      } finally {
        setSimulando(false);
      }
    }, 400);
    return () => { clearTimeout(t); setSimulando(false); };
  }, [precio, c]);

  if (!datos) return null;

  const valor = parseFloat(precio);
  const valido = valor > 0;
  const variacion = valido ? ((valor - c.precio_por_litro) / (c.precio_por_litro || 1)) * 100 : 0;
  // Un salto enorme suele ser un dedazo (280 en vez de 2800)
  const sospechoso = valido && c.precio_por_litro > 0 && (valor > c.precio_por_litro * 3 || valor < c.precio_por_litro / 3);

  const confirmar = async () => {
    setGuardando(true);
    try {
      const r = await combustiblesAPI.actualizarPrecio(c.id, valor);
      onListo(
        r.fiadosRevaluados > 0
          ? `Precio actualizado · se revaluaron ${r.fiadosRevaluados} fiados`
          : 'Precio actualizado'
      );
    } catch (e) {
      onError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Precio de ${c.nombre}`} ancho={480}>
      <div className="sub-card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 600 }}>PRECIO ACTUAL</div>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{formatearMonto(c.precio_por_litro)} por litro</div>
      </div>

      <div className="campo">
        <label>Precio nuevo</label>
        <input
          type="number" inputMode="decimal" step="any" min="0" autoFocus
          value={precio} onChange={(e) => setPrecio(e.target.value)}
          placeholder={String(c.precio_por_litro)}
        />
        {valido && c.precio_por_litro > 0 && (
          <small className="ayuda" style={{ color: variacion >= 0 ? 'var(--accent)' : 'var(--blue)' }}>
            {variacion >= 0 ? 'Sube' : 'Baja'} {Math.abs(variacion).toFixed(1)}%
          </small>
        )}
      </div>

      {sospechoso && (
        <div className="sub-card" style={{ marginBottom: 14, borderColor: 'var(--danger)' }}>
          <strong style={{ color: 'var(--danger)' }}>Revisá bien ese número</strong>
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
            Es muy distinto al actual ({formatearMonto(c.precio_por_litro)}). Si te faltó o te sobró un cero,
            la deuda de los fiados se va a mover mucho.
          </div>
        </div>
      )}

      {/* Impacto en las deudas */}
      {simulando && <div className="vacio" style={{ padding: 14, marginBottom: 14 }}>Calculando el impacto…</div>}

      {simulacion && !simulando && (
        simulacion.afectados.length === 0 ? (
          <div className="sub-card" style={{ marginBottom: 14, fontSize: 14 }}>
            No hay fiados abiertos de {c.nombre}: no cambia la deuda de nadie.
          </div>
        ) : (
          <div className="campo">
            <label>Cómo quedan las deudas</label>
            <div className="sub-card" style={{ padding: 0 }}>
              {simulacion.afectados.map((a, i) => (
                <div
                  key={a.clienteId}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 10,
                    padding: '9px 12px', fontSize: 13.5,
                    borderBottom: i < simulacion.afectados.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.nombre}
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{formatearMonto(a.antes)}</span>
                    {' → '}
                    <strong style={{ color: a.diferencia > 0 ? 'var(--accent)' : 'var(--blue)' }}>
                      {formatearMonto(a.despues)}
                    </strong>
                  </span>
                </div>
              ))}
            </div>
            <small className="ayuda">
              En total, la deuda pasa de {formatearMonto(simulacion.totalAntes)} a{' '}
              <strong>{formatearMonto(simulacion.totalDespues)}</strong>. Un fiado se debe en litros,
              así que se revalúa con el precio.
            </small>
          </div>
        )
      )}

      <div style={{ display: 'flex', gap: 9, marginTop: 4 }}>
        <button
          onClick={onCerrar}
          style={{ flex: 1, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Cancelar
        </button>
        <button
          onClick={confirmar} disabled={!valido || guardando}
          style={{ flex: 2, padding: 14, borderRadius: 'var(--radius)', backgroundColor: sospechoso ? 'var(--danger)' : 'var(--success)', color: 'white', fontWeight: 700 }}
        >
          {guardando ? 'Guardando…' : sospechoso ? 'Guardar igual' : 'Guardar precio'}
        </button>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════
function ComprasVista({ combustibles, compras, cargando, onRegistrada, onError }) {
  const [form, setForm] = useState({ combustibleId: null, litros: '', precio: '' });
  const [confirmando, setConfirmando] = useState(false);
  const [registrando, setRegistrando] = useState(false);

  useEffect(() => {
    if (!form.combustibleId && combustibles.length) {
      setForm((f) => ({ ...f, combustibleId: combustibles[0].id }));
    }
  }, [combustibles]);

  const elegido = combustibles.find((c) => c.id === form.combustibleId);
  const litros = parseFloat(form.litros) || 0;
  const precioCompra = parseFloat(form.precio) || 0;
  const total = litros * precioCompra;

  // El margen sale de comparar el costo con el precio al que se vende
  const margen = elegido && precioCompra > 0 ? elegido.precio_por_litro - precioCompra : null;

  const registrar = async () => {
    setRegistrando(true);
    try {
      await comprasAPI.registrar(form.combustibleId, litros, precioCompra);
      setForm({ combustibleId: form.combustibleId, litros: '', precio: '' });
      setConfirmando(false);
      onRegistrada(`Compra registrada · ${litros.toFixed(2)} L de ${elegido.nombre}`);
    } catch (e) {
      onError(e.message);
      setConfirmando(false);
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <div className="ventas-layout">
      <div className="card">
        <h3 className="titulo-seccion" style={{ marginBottom: 14 }}>Reponer tanque</h3>

        <div className="campo">
          <label>Combustible</label>
          <select
            value={form.combustibleId || ''}
            onChange={(e) => setForm({ ...form, combustibleId: Number(e.target.value) })}
          >
            {combustibles.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {elegido && (
            <small className="ayuda">
              Hoy tiene {elegido.cantidad_litros.toFixed(2)} L · se vende a {formatearMonto(elegido.precio_por_litro)}/L
            </small>
          )}
        </div>

        <div className="campo">
          <label>Litros comprados</label>
          <input
            type="number" inputMode="decimal" step="any" min="0"
            value={form.litros} onChange={(e) => setForm({ ...form, litros: e.target.value })}
            placeholder="Ej: 1000"
          />
        </div>

        <div className="campo">
          <label>Precio de compra por litro</label>
          <input
            type="number" inputMode="decimal" step="any" min="0"
            value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })}
            placeholder="Ej: 2400"
          />
          <small className="ayuda">Es el costo, y de acá sale el cálculo de ganancia de la caja.</small>
        </div>

        {total > 0 && (
          <div className="panel-destacado" style={{ backgroundColor: 'var(--blue)', marginBottom: 14 }}>
            <div className="etiqueta">Total de la compra</div>
            <div className="valor">{formatearMonto(total)}</div>
          </div>
        )}

        {margen !== null && litros > 0 && (
          <div
            className="sub-card"
            style={{ marginBottom: 14, fontSize: 14, borderColor: margen <= 0 ? 'var(--danger)' : 'var(--border)' }}
          >
            {margen > 0 ? (
              <>Ganás <strong style={{ color: 'var(--success)' }}>{formatearMonto(margen)}</strong> por litro
                {' · '}<strong>{formatearMonto(margen * litros)}</strong> si vendés todo.</>
            ) : (
              <strong style={{ color: 'var(--danger)' }}>
                Lo estás comprando a {formatearMonto(precioCompra)} y vendiéndolo a{' '}
                {formatearMonto(elegido.precio_por_litro)}: perdés {formatearMonto(-margen)} por litro.
              </strong>
            )}
          </div>
        )}

        <button
          onClick={() => setConfirmando(true)}
          disabled={!elegido || litros <= 0 || precioCompra <= 0}
          style={{ width: '100%', padding: 15, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700, fontSize: 15 }}
        >
          Registrar compra
        </button>
      </div>

      <div>
        <h3 className="titulo-seccion" style={{ marginBottom: 10 }}>Compras anteriores</h3>
        {cargando ? (
          <div className="vacio">Cargando…</div>
        ) : compras.length === 0 ? (
          <div className="vacio">Todavía no registraste ninguna compra</div>
        ) : (
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Combustible</th><th>Litros</th><th>Costo/L</th><th>Total</th></tr>
              </thead>
              <tbody>
                {compras.map((c) => (
                  <tr key={c.id}>
                    <td>{formatearFecha(c.fecha)}</td>
                    <td>{c.combustible_nombre}</td>
                    <td>{Number(c.cantidad_litros).toFixed(2)} L</td>
                    <td>{formatearMonto(c.precio_por_litro_compra)}</td>
                    <td><strong>{formatearMonto(c.total_compra)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal abierto={confirmando} onCerrar={() => setConfirmando(false)} titulo="Confirmar compra" ancho={400}>
        {elegido && (
          <>
            <div className="sub-card" style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 15, marginBottom: 6 }}>
                <strong>{litros.toFixed(2)} L</strong> de <strong>{elegido.nombre}</strong>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                a {formatearMonto(precioCompra)} por litro
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)', marginTop: 8 }}>
                {formatearMonto(total)}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                El tanque pasa de {elegido.cantidad_litros.toFixed(2)} L a{' '}
                <strong style={{ color: 'var(--text)' }}>{(elegido.cantidad_litros + litros).toFixed(2)} L</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => setConfirmando(false)}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancelar
              </button>
              <button
                onClick={registrar} disabled={registrando}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700 }}
              >
                {registrando ? 'Registrando…' : 'Confirmar'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
