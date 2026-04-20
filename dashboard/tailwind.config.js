/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // surface layers
        surface:  { 1: "var(--surface-1)", 2: "var(--surface-2)", 3: "var(--surface-3)" },
        // text
        tx: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
        },
        // accent — violet
        accent: {
          DEFAULT: "var(--accent)",
          dim:     "var(--accent-dim)",
          text:    "var(--accent-text)",
          border:  "var(--accent-border)",
        },
        // semantic
        success: "var(--success)",
        warning: "var(--warning)",
        danger:  "var(--danger)",
        info:    "var(--info)",
        // border
        line: {
          DEFAULT: "var(--border)",
          subtle:  "var(--border-subtle)",
        },
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      fontSize: {
        "2xs": ["0.7rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
}
