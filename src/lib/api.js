// ══════════════════════════════════════════════════════════════
//  api.js — Capa de datos única (antes duplicada en tres lugares:
//  la app móvil, database/db.js y los 36 handlers IPC de Electron).
//
//  Escrita contra el esquema nuevo, donde lo derivado se calcula en
//  vistas y no se guarda. Eso hace desaparecer clases enteras de
//  código que antes existían sólo para mantener números en sincronía:
//
//    · No se ajusta la deuda del cliente: sale de sus fiados.
//    · No se escribe `total`: es litros × precio, columna generada.
//    · No se marca `pagado`: se deduce de los pagos registrados.
//
//  Se LEE de las vistas v_ventas / v_clientes (traen lo calculado).
//  Se ESCRIBE en las tablas base.
// ══════════════════════════════════════════════════════════════
import { supabase } from './supabase.js';
import { ahora, inicioDelDia, finDelDia } from './fechas.js';

const num = (v) => Number(v) || 0;

const alzar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Los numeric de Postgres pueden llegar como string; normalizamos. */
const venta = (v) =>
  v && {
    ...v,
    cantidad_litros: num(v.cantidad_litros),
    precio_por_litro: num(v.precio_por_litro),
    total: num(v.total),
    cobrado: num(v.cobrado),
    saldo: num(v.saldo),
  };

const ventas = (arr) => (arr || []).map(venta);

// ── COMBUSTIBLES ────────────────────────────────────────────
// Esta tabla es a la vez el catálogo de lo que se vende y el estado
// del tanque de cada uno. Agregar "Nafta Premium YPF" es una fila más.
const combustible = (c) =>
  c && {
    ...c,
    cantidad_litros: num(c.cantidad_litros),
    precio_por_litro: num(c.precio_por_litro),
  };

export const combustiblesAPI = {
  /** Por defecto sólo los que se venden hoy. */
  obtenerTodos: async ({ incluirInactivos = false } = {}) => {
    let q = supabase.from('combustibles').select('*').order('orden').order('nombre');
    if (!incluirInactivos) q = q.eq('activo', true);
    return alzar(await q).map(combustible);
  },

  obtenerUno: async (id) =>
    combustible(alzar(await supabase.from('combustibles').select('*').eq('id', id).single())),

  crear: async ({ nombre, precioPorLitro = 0, cantidadLitros = 0, orden = 0 }) => {
    const { data, error } = await supabase
      .from('combustibles')
      .insert({
        nombre: (nombre || '').trim(),
        precio_por_litro: precioPorLitro,
        cantidad_litros: cantidadLitros,
        orden,
      })
      .select()
      .single();
    if (error?.code === '23505') throw new Error(`Ya existe un combustible llamado "${nombre.trim()}"`);
    if (error) throw error;
    return combustible(data);
  },

  editar: async (id, { nombre, orden, activo }) => {
    const cambios = {};
    if (nombre !== undefined) cambios.nombre = nombre.trim();
    if (orden !== undefined) cambios.orden = orden;
    if (activo !== undefined) cambios.activo = activo;

    const { error } = await supabase.from('combustibles').update(cambios).eq('id', id);
    if (error?.code === '23505') throw new Error('Ya existe otro combustible con ese nombre');
    if (error) throw error;
  },

  /**
   * Dejar de vender uno no lo borra: las ventas viejas lo siguen
   * necesitando. Sale de la lista y nada más.
   */
  desactivar: async (id) => {
    const { data: enTanque } = await supabase
      .from('combustibles').select('cantidad_litros').eq('id', id).single();
    if (num(enTanque?.cantidad_litros) > 0.01) {
      throw new Error(`Todavía quedan ${num(enTanque.cantidad_litros).toFixed(2)} litros en el tanque.`);
    }
    alzar(await supabase.from('combustibles').update({ activo: false }).eq('id', id).select('id'));
  },

  // TODO: read-modify-write. Con un solo usuario no hay problema,
  // pero lo correcto sería una función RPC que incremente del lado
  // del servidor de forma atómica.
  actualizarCantidad: async (id, delta) => {
    const actual = alzar(
      await supabase.from('combustibles').select('cantidad_litros').eq('id', id).single()
    );
    return alzar(
      await supabase
        .from('combustibles')
        .update({
          cantidad_litros: num(actual?.cantidad_litros) + delta,
          ultima_actualizacion: ahora(),
        })
        .eq('id', id)
        .select()
    );
  },

  /**
   * Qué le pasaría a las deudas si el precio cambiara a este valor.
   * Cambiar el precio mueve plata que la gente debe, así que la
   * pantalla lo muestra ANTES de confirmar en vez de después.
   */
  simularCambioPrecio: async (id, nuevoPrecio) => {
    const abiertos = ventas(
      alzar(
        await supabase
          .from('v_ventas')
          .select('*')
          .eq('combustible_id', id)
          .eq('es_fiado', true)
          .eq('pagado', false)
      )
    );

    const porCliente = new Map();
    for (const v of abiertos) {
      const saldoNuevo = Math.max(0, v.cantidad_litros * nuevoPrecio - v.cobrado);
      const actual = porCliente.get(v.cliente_id) || {
        clienteId: v.cliente_id,
        nombre: v.cliente_nombre || 'Sin cliente',
        antes: 0,
        despues: 0,
      };
      actual.antes += v.saldo;
      actual.despues += saldoNuevo;
      porCliente.set(v.cliente_id, actual);
    }

    const afectados = [...porCliente.values()]
      .map((c) => ({ ...c, diferencia: c.despues - c.antes }))
      .filter((c) => Math.abs(c.diferencia) > 0.01)
      .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

    return {
      fiados: abiertos.length,
      afectados,
      totalAntes: afectados.reduce((s, c) => s + c.antes, 0),
      totalDespues: afectados.reduce((s, c) => s + c.despues, 0),
    };
  },

  /**
   * Un fiado está denominado en litros, no en pesos: si sube el
   * surtidor, sube lo que debe el que se llevó fiado.
   *
   * Antes esto era un loop que reescribía cuatro campos por venta y
   * además ajustaba la deuda del cliente — y era justo donde se
   * colaban los descuadres. Ahora alcanza con cambiar el precio: el
   * total es generado y el saldo se recalcula solo.
   */
  actualizarPrecio: async (id, precio) => {
    const actualizado = alzar(
      await supabase
        .from('combustibles')
        .update({ precio_por_litro: precio, ultima_actualizacion: ahora() })
        .eq('id', id)
        .select()
    );

    // Apunta a los fiados SIN FECHA DE SALDADO, no a los que hoy dan
    // saldo positivo. Si el precio se cargó mal y dejó a alguno en
    // cero, al corregirlo vuelve a entrar acá y recupera su deuda.
    const abiertos = alzar(
      await supabase
        .from('ventas')
        .select('id')
        .eq('combustible_id', id)
        .eq('es_fiado', true)
        .is('saldado_en', null)
    );

    if (abiertos?.length) {
      alzar(
        await supabase
          .from('ventas')
          .update({ precio_por_litro: precio })
          .in('id', abiertos.map((v) => v.id))
          .select('id')
      );
    }

    return { combustible: actualizado, fiadosRevaluados: abiertos?.length || 0 };
  },
};

// ── CLIENTES ────────────────────────────────────────────────
export const clientesAPI = {
  // Una sola query: la vista ya trae deuda, fiados abiertos e
  // histórico. Antes esto eran 58 viajes a la base (uno por cliente).
  obtenerTodos: async () => {
    const data = alzar(await supabase.from('v_clientes').select('*').order('nombre'));
    return data.map((c) => ({
      ...c,
      debe: num(c.debe),
      fiados_abiertos: num(c.fiados_abiertos),
      total_compras: num(c.total_compras),
      total_pagado: num(c.total_pagado),
    }));
  },

  obtenerUno: async (id) => {
    const c = alzar(await supabase.from('v_clientes').select('*').eq('id', id).single());
    return { ...c, debe: num(c.debe), fiados_abiertos: num(c.fiados_abiertos) };
  },

  agregar: async (nombre, telefono, direccion) => {
    const { data, error } = await supabase
      .from('clientes')
      .insert({
        nombre: (nombre || '').trim(),
        telefono: telefono?.trim() || null,
        direccion: direccion?.trim() || null,
      })
      .select()
      .single();

    // El índice único es case-insensitive: atrapa "Pablo mansilla"
    // contra "Pablo Mansilla ", que en la base vieja convivían.
    if (error?.code === '23505') {
      throw new Error(`Ya existe un cliente con el nombre "${nombre.trim()}"`);
    }
    if (error) throw error;
    return data;
  },

  editar: async (id, { nombre, telefono, direccion }) => {
    const { error } = await supabase
      .from('clientes')
      .update({
        nombre: (nombre || '').trim(),
        telefono: telefono?.trim() || null,
        direccion: direccion?.trim() || null,
      })
      .eq('id', id);
    if (error?.code === '23505') throw new Error(`Ya existe otro cliente con ese nombre`);
    if (error) throw error;
  },

  buscar: async (nombre) =>
    alzar(await supabase.from('v_clientes').select('*').ilike('nombre', `%${nombre}%`).order('nombre')),

  obtenerHistorial: async (clienteId) =>
    ventas(
      alzar(
        await supabase.from('v_ventas').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false })
      )
    ),

  obtenerPagos: async (clienteId) =>
    alzar(
      await supabase.from('pagos_fiado').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false })
    ),

  eliminar: async (clienteId) => {
    const { error } = await supabase.from('clientes').delete().eq('id', clienteId);
    // La FK es ON DELETE RESTRICT: un cliente con ventas registradas
    // no se puede borrar, porque se llevaría los registros con él.
    if (error?.code === '23503') {
      throw new Error('Este cliente tiene ventas registradas y no se puede borrar sin perder esos registros.');
    }
    if (error) throw error;
  },
};

// ── VENTAS ──────────────────────────────────────────────────
export const ventasAPI = {
  /**
   * Una venta al contado lleva método de pago. Un fiado no: se define
   * recién cuando se cobra, y puede cobrarse en varias veces y con
   * métodos distintos. Por eso el método vive en cada pago.
   */
  registrar: async ({
    clienteId, combustibleId, cantidadLitros, precioPorLitro,
    esFiado, metodoPago, titularTransferencia,
  }) => {
    if (esFiado && !clienteId) throw new Error('Un fiado necesita un cliente');
    if (!esFiado && !metodoPago) throw new Error('Indicá cómo se cobró la venta');

    const nueva = alzar(
      await supabase
        .from('ventas')
        .insert({
          fecha: ahora(),
          cliente_id: clienteId || null,
          combustible_id: combustibleId,
          cantidad_litros: cantidadLitros,
          precio_por_litro: precioPorLitro,
          es_fiado: !!esFiado,
          metodo_pago: esFiado ? null : metodoPago,
          titular_transferencia: metodoPago === 'Transferencia' ? titularTransferencia || null : null,
        })
        .select()
        .single()
    );

    await combustiblesAPI.actualizarCantidad(combustibleId, -cantidadLitros);
    return venta(nueva);
  },

  obtenerTodas: async () =>
    ventas(alzar(await supabase.from('v_ventas').select('*').order('fecha', { ascending: false }))),

  obtenerPorFecha: async (desde, hasta) =>
    ventas(
      alzar(
        await supabase
          .from('v_ventas')
          .select('*')
          .gte('fecha', inicioDelDia(desde))
          .lte('fecha', finDelDia(hasta))
          .order('fecha', { ascending: false })
      )
    ),

  obtenerPendientes: async () =>
    ventas(
      alzar(
        await supabase
          .from('v_ventas')
          .select('*')
          .eq('es_fiado', true)
          .eq('pagado', false)
          .order('fecha', { ascending: false })
      )
    ),

  obtenerUna: async (id) => venta(alzar(await supabase.from('v_ventas').select('*').eq('id', id).single())),

  /** Facturación histórica: todo lo vendido que ya está cobrado. */
  obtenerTotal: async () => {
    const data = alzar(await supabase.from('v_ventas').select('total').eq('pagado', true));
    return { total: data.reduce((s, v) => s + num(v.total), 0) };
  },

  /**
   * Totales por método de pago. Combina dos fuentes, porque en el
   * esquema nuevo el método de una venta al contado está en la venta,
   * y el de un fiado está en cada pago. Antes se pisaba el método de
   * la venta al cobrarla y se perdía cómo se había vendido.
   */
  obtenerTotalesPorMetodo: async () => {
    const [alContado, pagos] = await Promise.all([
      supabase.from('ventas').select('metodo_pago, total').eq('es_fiado', false),
      supabase.from('pagos_fiado').select('metodo_pago, monto'),
    ]);

    const acc = {};
    const sumar = (metodo, monto) => {
      acc[metodo] ??= { metodo_pago: metodo, total: 0, cantidad: 0 };
      acc[metodo].total += num(monto);
      acc[metodo].cantidad++;
    };

    alzar(alContado).forEach((v) => sumar(v.metodo_pago, v.total));
    alzar(pagos).forEach((p) => sumar(p.metodo_pago, p.monto));
    return Object.values(acc);
  },

  /**
   * Registrar un cobro. El saldo se recalcula solo a partir de los
   * pagos; lo único que se escribe en la venta es la fecha de saldado
   * cuando este pago la termina de cubrir.
   */
  registrarPago: async (ventaId, montoPagado, metodoPago, titularTransferencia) => {
    const v = await ventasAPI.obtenerUna(ventaId);
    if (!v) throw new Error('Venta no encontrada');
    if (!v.es_fiado) throw new Error('Esta venta no es un fiado');
    if (montoPagado <= 0) throw new Error('El monto tiene que ser mayor a cero');
    if (montoPagado > v.saldo + 0.01) {
      throw new Error(`El monto supera la deuda de esta venta (${v.saldo.toFixed(2)})`);
    }

    alzar(
      await supabase
        .from('pagos_fiado')
        .insert({
          venta_id: ventaId,
          cliente_id: v.cliente_id,
          monto: montoPagado,
          metodo_pago: metodoPago,
          titular_transferencia: metodoPago === 'Transferencia' ? titularTransferencia || null : null,
          fecha: ahora(),
        })
        .select()
        .single()
    );

    const restante = v.saldo - montoPagado;
    const saldado = restante <= 0.01;

    // Queda registrado CUÁNDO se terminó de pagar. A partir de acá el
    // fiado no se revalúa aunque cambie el precio: ya está cerrado.
    if (saldado) {
      alzar(
        await supabase.from('ventas').update({ saldado_en: ahora() }).eq('id', ventaId).select('id')
      );
    }

    return { saldado, totalRestante: Math.max(0, restante) };
  },

  /** Cobrar el saldo completo de un fiado. */
  saldarVenta: async (ventaId, metodoPago, titularTransferencia) => {
    const v = await ventasAPI.obtenerUna(ventaId);
    if (!v) throw new Error('Venta no encontrada');
    if (v.saldo <= 0.01) throw new Error('Esta venta ya está saldada');
    return ventasAPI.registrarPago(ventaId, v.saldo, metodoPago, titularTransferencia);
  },

  /** Salda la deuda del cliente, del fiado más viejo al más nuevo. */
  pagarDeudaCliente: async (clienteId, montoPagado, metodoPago, titularTransferencia) => {
    const fiados = ventas(
      alzar(
        await supabase
          .from('v_ventas')
          .select('*')
          .eq('cliente_id', clienteId)
          .eq('es_fiado', true)
          .eq('pagado', false)
          .order('fecha', { ascending: true })
      )
    );
    if (!fiados.length) throw new Error('El cliente no tiene deudas pendientes');

    const fecha = ahora();
    const aInsertar = [];
    let restante = montoPagado;
    const saldadas = [];
    const parciales = [];

    for (const f of fiados) {
      if (restante <= 0.01) break;
      const aplicado = Math.min(restante, f.saldo);
      aInsertar.push({
        venta_id: f.id,
        cliente_id: clienteId,
        monto: aplicado,
        metodo_pago: metodoPago,
        titular_transferencia: metodoPago === 'Transferencia' ? titularTransferencia || null : null,
        fecha,
      });
      (aplicado >= f.saldo - 0.01 ? saldadas : parciales).push(f.id);
      restante -= aplicado;
    }

    alzar(await supabase.from('pagos_fiado').insert(aInsertar).select('id'));

    if (saldadas.length) {
      alzar(
        await supabase.from('ventas').update({ saldado_en: fecha }).in('id', saldadas).select('id')
      );
    }

    return {
      montoAplicado: montoPagado - restante,
      ventasSaldadas: saldadas,
      ventasParciales: parciales,
      // Si pagó de más, que la UI lo diga en vez de tragárselo.
      sobrante: restante > 0.01 ? restante : 0,
    };
  },

  obtenerPagosFiado: async (ventaId) =>
    alzar(await supabase.from('pagos_fiado').select('*').eq('venta_id', ventaId).order('fecha', { ascending: false })),

  /**
   * Editar sólo ajusta el stock. La deuda ya no hay que tocarla: al
   * cambiar litros o precio, el total se regenera y el saldo se
   * recalcula. Este era el bug más dañino de la app móvil, que
   * editaba la fila sin devolver los litros al tanque.
   */
  editar: async (ventaId, datos) => {
    const anterior = await ventasAPI.obtenerUna(ventaId);
    if (!anterior) throw new Error('Venta no encontrada');

    const { combustibleId, cantidadLitros, precioPorLitro, metodoPago, clienteId, esFiado, titularTransferencia } = datos;

    if (esFiado && !clienteId) throw new Error('Un fiado necesita un cliente');
    if (!esFiado && !metodoPago) throw new Error('Indicá cómo se cobró la venta');
    if (anterior.es_fiado && !esFiado && anterior.cobrado > 0.01) {
      throw new Error('Esta venta ya tiene pagos registrados. Borrá los pagos antes de convertirla en venta al contado.');
    }
    if (esFiado && cantidadLitros * precioPorLitro < anterior.cobrado - 0.01) {
      throw new Error('El nuevo total quedaría por debajo de lo ya cobrado en esta venta.');
    }

    // Tanque: devolver lo viejo, descontar lo nuevo
    if (combustibleId !== anterior.combustible_id) {
      await combustiblesAPI.actualizarCantidad(anterior.combustible_id, anterior.cantidad_litros);
      await combustiblesAPI.actualizarCantidad(combustibleId, -cantidadLitros);
    } else if (cantidadLitros !== anterior.cantidad_litros) {
      await combustiblesAPI.actualizarCantidad(combustibleId, anterior.cantidad_litros - cantidadLitros);
    }

    // Si la corrección hace que el fiado valga más de lo ya cobrado,
    // vuelve a estar abierto: el cliente pasa a deber la diferencia.
    // Y una venta al contado nunca lleva fecha de saldado.
    const nuevoTotal = cantidadLitros * precioPorLitro;
    const saldadoEn = !esFiado || nuevoTotal > anterior.cobrado + 0.01 ? null : anterior.saldado_en;

    alzar(
      await supabase
        .from('ventas')
        .update({
          cliente_id: clienteId || null,
          combustible_id: combustibleId,
          cantidad_litros: cantidadLitros,
          precio_por_litro: precioPorLitro,
          es_fiado: !!esFiado,
          metodo_pago: esFiado ? null : metodoPago,
          titular_transferencia: metodoPago === 'Transferencia' ? titularTransferencia || null : null,
          saldado_en: saldadoEn,
        })
        .eq('id', ventaId)
        .select('id')
    );
  },

  /** Devuelve los litros al tanque. Los pagos se van en cascada. */
  eliminar: async (ventaId) => {
    const v = await ventasAPI.obtenerUna(ventaId);
    if (!v) throw new Error('Venta no encontrada');

    await combustiblesAPI.actualizarCantidad(v.combustible_id, v.cantidad_litros);
    alzar(await supabase.from('ventas').delete().eq('id', ventaId).select('id'));
  },
};

// ── COMPRAS ─────────────────────────────────────────────────
export const comprasAPI = {
  registrar: async (combustibleId, cantidad, precioCompra) => {
    const compra = alzar(
      await supabase
        .from('compras_stock')
        .insert({
          fecha: ahora(),
          combustible_id: combustibleId,
          cantidad_litros: cantidad,
          precio_por_litro_compra: precioCompra,
        })
        .select()
        .single()
    );
    await combustiblesAPI.actualizarCantidad(combustibleId, cantidad);
    return compra;
  },

  obtenerTodas: async () =>
    alzar(await supabase.from('v_compras').select('*').order('fecha', { ascending: false })),

  obtenerTotalInvertido: async () => {
    const data = alzar(await supabase.from('compras_stock').select('total_compra'));
    return { total: data.reduce((s, c) => s + num(c.total_compra), 0) };
  },
};

/**
 * Último precio de compra de cada combustible, que es lo que se usa
 * como costo para calcular la ganancia. Se traen todos de una: con N
 * combustibles, una query por cada uno no escala.
 */
const costosPorCombustible = async () => {
  const compras = alzar(
    await supabase
      .from('compras_stock')
      .select('combustible_id, precio_por_litro_compra, fecha')
      .order('fecha', { ascending: false })
  );
  const costo = {};
  for (const c of compras) {
    // Como vienen de más nueva a más vieja, la primera de cada
    // combustible es la última compra.
    costo[c.combustible_id] ??= num(c.precio_por_litro_compra);
  }
  return costo;
};

// ── CAJA ────────────────────────────────────────────────────

/**
 * Totales de un período. Antes esta misma cuenta estaba copiada en
 * tres funciones y las tres se habían ido separando entre sí.
 */
async function calcularTotales(desde, hasta, fondoInicial = 0) {
  const [ventasRaw, pagosRaw, costos] = await Promise.all([
    supabase.from('v_ventas').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }),
    supabase.from('pagos_fiado').select('*, clientes(nombre)').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }),
    costosPorCombustible(),
  ]);

  const lista = ventas(alzar(ventasRaw));
  const pagosFiado = alzar(pagosRaw).map(({ clientes, ...p }) => ({
    ...p,
    monto: num(p.monto),
    cliente_nombre: clientes?.nombre || null,
  }));

  const alContado = lista.filter((v) => !v.es_fiado);
  const fiadas = lista.filter((v) => v.es_fiado);
  const sumar = (arr, f) => arr.reduce((s, x) => s + num(f(x)), 0);

  const totalEfectivo = sumar(alContado.filter((v) => v.metodo_pago === 'Efectivo'), (v) => v.total);
  const totalTransferencia = sumar(alContado.filter((v) => v.metodo_pago === 'Transferencia'), (v) => v.total);
  const totalCobrado = totalEfectivo + totalTransferencia;

  // Los cobros de fiado se separan por método porque, al cerrar, la
  // pregunta concreta es cuánta plata tiene que haber en el cajón.
  const fiadoEfectivo = sumar(pagosFiado.filter((p) => p.metodo_pago === 'Efectivo'), (p) => p.monto);
  const fiadoTransferencia = sumar(pagosFiado.filter((p) => p.metodo_pago === 'Transferencia'), (p) => p.monto);

  // El costo se cuenta sobre lo vendido al contado, igual que antes.
  // Un fiado cobrado hoy pero vendido en otro turno no suma costo
  // acá: su mercadería salió del tanque el día de la venta.
  const costoVendido = sumar(alContado, (v) => v.cantidad_litros * (costos[v.combustible_id] || 0));

  // Desglose por combustible, armado sobre lo que efectivamente se
  // vendió. Con dos combustibles o con seis, funciona igual.
  const litrosPorCombustible = {};
  for (const v of lista) {
    const nombre = v.combustible_nombre || 'Sin nombre';
    litrosPorCombustible[nombre] = (litrosPorCombustible[nombre] || 0) + v.cantidad_litros;
  }

  return {
    ventas: lista,
    pagosFiado,
    totalEfectivo,
    totalTransferencia,
    totalCobrado,
    totalFiadoNuevo: sumar(fiadas, (v) => v.total),
    totalFiadoCobrado: fiadoEfectivo + fiadoTransferencia,
    fiadoCobradoEfectivo: fiadoEfectivo,
    fiadoCobradoTransferencia: fiadoTransferencia,
    fondoInicial,
    // Lo que tiene que haber en el cajón: el fondo que quedó de antes,
    // más las ventas en efectivo, más los fiados cobrados en efectivo.
    efectivoEnCaja: fondoInicial + totalEfectivo + fiadoEfectivo,
    litrosPorCombustible,
    ganancia: totalCobrado - costoVendido,
    cantidadVentas: lista.length,
    cantidadFiados: fiadas.length,
  };
}

export const cajaAPI = {
  /**
   * Una sola caja abierta a la vez: lo garantiza un índice único.
   * El fondo es la plata que queda en el cajón para dar vuelto; sin
   * contarla, lo que "tiene que haber" al cerrar siempre da de menos.
   */
  abrirCaja: async (notas, fondoInicial = 0) => {
    const { data, error } = await supabase
      .from('sesiones_caja')
      .insert({
        abierta_en: ahora(),
        notas_apertura: notas || null,
        fondo_inicial: fondoInicial || 0,
      })
      .select()
      .single();
    if (error?.code === '23505') throw new Error('Ya hay una caja abierta');
    if (error) throw error;
    return data;
  },

  /** El fondo se puede corregir mientras la caja sigue abierta. */
  actualizarFondo: async (id, fondoInicial) => {
    alzar(
      await supabase
        .from('sesiones_caja')
        .update({ fondo_inicial: fondoInicial || 0 })
        .eq('id', id)
        .is('cerrada_en', null)
        .select('id')
    );
  },

  /**
   * @param efectivoContado lo que se contó de verdad en el cajón.
   *        Null si no se hizo arqueo: no se inventa un número.
   */
  cerrarCaja: async (id, notas, efectivoContado = null) => {
    const sesion = alzar(
      await supabase.from('sesiones_caja').select('*').eq('id', id).is('cerrada_en', null).maybeSingle()
    );
    if (!sesion) throw new Error('No se encontró la sesión o ya está cerrada');

    const cerradaEn = ahora();
    const t = await calcularTotales(sesion.abierta_en, cerradaEn, num(sesion.fondo_inicial));

    alzar(
      await supabase
        .from('sesiones_caja')
        .update({
          cerrada_en: cerradaEn,
          notas_cierre: notas || null,
          total_efectivo: t.totalEfectivo,
          total_transferencia: t.totalTransferencia,
          total_fiado_nuevo: t.totalFiadoNuevo,
          total_fiado_cobrado: t.totalFiadoCobrado,
          total_cobrado: t.totalCobrado,
          efectivo_esperado: t.efectivoEnCaja,
          efectivo_contado: efectivoContado,
          litros_por_combustible: t.litrosPorCombustible,
          cantidad_ventas: t.cantidadVentas,
          cantidad_ventas_fiado: t.cantidadFiados,
          ganancia: t.ganancia,
        })
        .eq('id', id)
        .select('id')
    );

    return { ok: true, ...t };
  },

  obtenerCajaAbierta: async () =>
    alzar(
      await supabase
        .from('sesiones_caja')
        .select('*')
        .is('cerrada_en', null)
        .order('abierta_en', { ascending: false })
        .limit(1)
        .maybeSingle()
    ),

  /**
   * Los límites de la sesión ya son instantes: no hay nada que
   * convertir. Armar ese instante a partir de fecha y hora sueltas
   * era exactamente lo que la app de PC hacía mal.
   */
  obtenerResumen: async (idSesion) => {
    const sesion = alzar(await supabase.from('sesiones_caja').select('*').eq('id', idSesion).maybeSingle());
    if (!sesion) return null;
    return {
      sesion,
      ...(await calcularTotales(sesion.abierta_en, sesion.cerrada_en || ahora(), num(sesion.fondo_inicial))),
    };
  },

  obtenerHistorial: async () =>
    alzar(await supabase.from('sesiones_caja').select('*').order('abierta_en', { ascending: false })),
};
