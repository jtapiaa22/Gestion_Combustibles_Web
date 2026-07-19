import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Diálogo. En teléfono sube desde abajo y ocupa el ancho completo; en
 * escritorio queda centrado. Cierra con Escape o tocando el fondo.
 */
export function Modal({ abierto, onCerrar, titulo, children, ancho = 460 }) {
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e) => e.key === 'Escape' && onCerrar?.();
    document.addEventListener('keydown', alTeclear);
    // Que el fondo no scrollee mientras el diálogo está abierto
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return createPortal(
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar?.()}>
      <div className="modal-caja" style={{ maxWidth: ancho }} role="dialog" aria-modal="true" aria-label={titulo}>
        {titulo && (
          <div className="modal-cabecera">
            <h2 className="titulo-seccion" style={{ fontSize: 16 }}>{titulo}</h2>
            <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
          </div>
        )}
        <div className="modal-cuerpo">{children}</div>
      </div>
    </div>,
    document.body
  );
}
