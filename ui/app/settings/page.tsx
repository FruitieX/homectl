import { useTheme, ThemeMode } from '@/hooks/theme';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { Button } from '@/ui/primitives/button';

const themeOptions: {
  value: ThemeMode;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: 'light', label: 'Light', icon: <Sun className="size-5" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-5" /> },
  { value: 'auto', label: 'Auto', icon: <Monitor className="size-5" /> },
];

export default function SettingsPage() {
  const [themeMode, setThemeMode] = useTheme();

  return (
    <div className="flex flex-col gap-5 overflow-auto p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Personalize the app shell and display preferences.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose a theme or let homectl follow the system preference.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted p-1">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={themeMode === option.value ? 'default' : 'ghost'}
                  className={cn(
                    'h-16 flex-col rounded-xl text-xs sm:h-11 sm:flex-row sm:text-sm',
                    themeMode === option.value && 'shadow-sm',
                  )}
                  onClick={() => setThemeMode(option.value)}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {themeMode === 'auto'
                ? 'Theme follows your system preference.'
                : `Using ${themeMode} theme.`}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
