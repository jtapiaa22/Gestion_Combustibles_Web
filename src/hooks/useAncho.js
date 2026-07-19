import { useEffect, useState } from 'react';

/** true cuando la pantalla es de escritorio (≥900px). */
export function useEsEscritorio() {
  const consulta = '(min-width: 900px)';
  const [esAncho, setEsAncho] = useState(() => window.matchMedia(consulta).matches);

  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const alCambiar = (e) => setEsAncho(e.matches);
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  return esAncho;
}
