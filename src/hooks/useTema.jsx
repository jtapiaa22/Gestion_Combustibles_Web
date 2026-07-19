import { createContext, useContext, useEffect, useState } from 'react';

const TemaContext = createContext(null);

export function TemaProvider({ children }) {
  const [tema, setTema] = useState(() => localStorage.getItem('tema') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem('tema', tema);
    // Que la barra del navegador acompañe al tema en el teléfono
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tema === 'dark' ? '#0A0908' : '#FFFFFF');
  }, [tema]);

  const alternar = () => setTema((t) => (t === 'dark' ? 'light' : 'dark'));

  return <TemaContext.Provider value={{ tema, alternar }}>{children}</TemaContext.Provider>;
}

export const useTema = () => useContext(TemaContext);
