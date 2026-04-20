type Theme = "dark" | "light"

const KEY = "ml-labs-theme"

export function getTheme(): Theme {
  if (typeof window === "undefined") return "dark"
  return (localStorage.getItem(KEY) as Theme | null) ?? "dark"
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t)
  document.documentElement.classList.remove("dark", "light")
  document.documentElement.classList.add(t)
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark")
}

export function initTheme() {
  setTheme(getTheme())
}
