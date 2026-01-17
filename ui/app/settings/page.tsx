'use client';

import { useTheme, ThemeMode } from '@/hooks/theme';
import { Sun, Moon, Monitor } from 'lucide-react';

const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="w-5 h-5" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="w-5 h-5" /> },
  { value: 'auto', label: 'Auto', icon: <Monitor className="w-5 h-5" /> },
];

export default function SettingsPage() {
  const [themeMode, setThemeMode] = useTheme();

  return (
    <div className="flex flex-col gap-6 p-4 overflow-auto">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="card bg-base-200">
        <div className="card-body">
          <h2 className="card-title">Appearance</h2>
          
          <div className="form-control">
            <label className="label">
              <span className="label-text text-base">Theme</span>
            </label>
            <div className="join w-full">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  className={`join-item btn flex-1 ${
                    themeMode === option.value ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => setThemeMode(option.value)}
                >
                  {option.icon}
                  <span className="ml-2">{option.label}</span>
                </button>
              ))}
            </div>
            <label className="label">
              <span className="label-text-alt text-base-content/70">
                {themeMode === 'auto'
                  ? 'Theme follows your system preference'
                  : `Using ${themeMode} theme`}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
