import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ColorTheme = 'default' | 'ocean' | 'luxury';

interface ThemeContextType {
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    const saved = localStorage.getItem('color-theme');
    return (saved as ColorTheme) || 'default';
  });

  useEffect(() => {
    localStorage.setItem('color-theme', colorTheme);
    
    // Remove all theme classes
    document.documentElement.classList.remove('theme-default', 'theme-ocean', 'theme-luxury');
    
    // Add current theme class
    document.documentElement.classList.add(`theme-${colorTheme}`);
  }, [colorTheme]);

  return (
    <ThemeContext.Provider value={{ colorTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
