import { useState } from "react";
import { Moon, Sun } from "./icons";
import { getInitialTheme, saveTheme, type Theme } from "./theme";

interface ThemeToggleProps {
  compact?: boolean;
}

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const nextTheme = theme === "dark" ? "light" : "dark";
  const label =
    nextTheme === "light" ? "라이트 모드로 전환" : "다크 모드로 전환";

  function toggleTheme(): void {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  return (
    <button
      type="button"
      className={`theme-toggle${compact ? " icon-button" : ""}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" />
      ) : (
        <Moon aria-hidden="true" />
      )}
      {!compact && (
        <span>{theme === "dark" ? "라이트 모드" : "다크 모드"}</span>
      )}
    </button>
  );
}
