import { createContext, useContext, useEffect, useState } from 'react';

const AjustesContext = createContext(null);

/**
 * Escalas de letra. La 1 deja los campos de texto en 16px, que es el
 * umbral por debajo del cual iOS hace zoom al enfocarlos: por eso no
 * hay una opción más chica.
 */
export const ESCALAS = [
  { valor: 1, etiqueta: 'Chica' },
  { valor: 1.15, etiqueta: 'Normal' },
  { valor: 1.32, etiqueta: 'Grande' },
  { valor: 1.5, etiqueta: 'Muy grande' },
];

const ESCALA_POR_DEFECTO = 1.15;

export function AjustesProvider({ children }) {
  const [tema, setTema] = useState(() => localStorage.getItem('tema') || 'dark');
  const [escala, setEscala] = useState(() => {
    const guardada = parseFloat(localStorage.getItem('escala'));
    return ESCALAS.some((e) => e.valor === guardada) ? guardada : ESCALA_POR_DEFECTO;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem('tema', tema);
    // Que la barra del navegador acompañe al tema en el teléfono
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tema === 'dark' ? '#0A0908' : '#FFFFFF');
  }, [tema]);

  useEffect(() => {
    document.documentElement.style.setProperty('--escala', String(escala));
    localStorage.setItem('escala', String(escala));
  }, [escala]);

  const alternarTema = () => setTema((t) => (t === 'dark' ? 'light' : 'dark'));

  /** Pasa a la escala siguiente y vuelve a la primera al terminar. */
  const siguienteEscala = () => {
    const i = ESCALAS.findIndex((e) => e.valor === escala);
    setEscala(ESCALAS[(i + 1) % ESCALAS.length].valor);
  };

  const escalaActual = ESCALAS.find((e) => e.valor === escala) || ESCALAS[1];

  return (
    <AjustesContext.Provider value={{ tema, alternarTema, escala, escalaActual, siguienteEscala }}>
      {children}
    </AjustesContext.Provider>
  );
}

export const useAjustes = () => useContext(AjustesContext);
