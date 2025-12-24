import React from 'react';
import { useTheme, ColorTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Palette, Check } from 'lucide-react';

const themes: { value: ColorTheme; label: string; colors: string[] }[] = [
  { 
    value: 'default', 
    label: 'Стандартная', 
    colors: ['hsl(226, 69%, 49%)', 'hsl(41, 38%, 61%)'] 
  },
  { 
    value: 'ocean', 
    label: 'Океан', 
    colors: ['hsl(195, 85%, 45%)', 'hsl(320, 70%, 55%)'] 
  },
  { 
    value: 'luxury', 
    label: 'Люкс', 
    colors: ['hsl(220, 25%, 15%)', 'hsl(43, 74%, 49%)'] 
  },
];

export const ThemeSwitcher: React.FC = () => {
  const { colorTheme, setColorTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {themes.map((theme) => (
          <DropdownMenuItem
            key={theme.value}
            onClick={() => setColorTheme(theme.value)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {theme.colors.map((color, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <span>{theme.label}</span>
            </div>
            {colorTheme === theme.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
