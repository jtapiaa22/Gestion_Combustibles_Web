import { useCallback, useEffect, useRef, useState } from 'react';

const COLORES = {
  ok: 'var(--success)',
  error: 'var(--danger)',
  aviso: 'var(--accent-dark)',
};

/**
 * Avisos breves. Los errores duran más que las confirmaciones: si algo
 * salió mal, hay que llegar a leerlo.
 */
export function useNotificacion() {
  const [aviso, setAviso] = useState(null);
  const timer = useRef(null);

  const mostrar = useCallback((mensaje, tipo = 'ok') => {
    clearTimeout(timer.current);
    setAviso({ mensaje, tipo });
    timer.current = setTimeout(() => setAviso(null), tipo === 'error' ? 5000 : 2600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const Notificacion = useCallback(
    () =>
      aviso ? (
        <div className="toast" style={{ backgroundColor: COLORES[aviso.tipo] || COLORES.ok }} role="status">
          {aviso.mensaje}
        </div>
      ) : null,
    [aviso]
  );

  return { mostrar, Notificacion };
}
