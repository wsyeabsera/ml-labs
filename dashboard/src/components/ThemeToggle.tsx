import { useState } from "react"
import { Moon, Sun } from "lucide-react"
import { getTheme, toggleTheme } from "../lib/theme"

export function ThemeToggle() {
  const [dark, setDark] = useState(getTheme() === "dark")

  function handle() {
    toggleTheme()
    setDark((d) => !d)
  }

  return (
    <button
      onClick={handle}
      className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text-1)]"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}
