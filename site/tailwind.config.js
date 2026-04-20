/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: "#0a0e1a",
          panel: "#111827",
          border: "#1f2937",
          muted: "#64748b",
          text: "#e2e8f0",
          heading: "#f8fafc",
        },
        cyan: {
          neon: "#22d3ee",
        },
        purple: {
          neon: "#a855f7",
        },
        green: {
          neon: "#4ade80",
        },
        orange: {
          neon: "#fb923c",
        },
        pink: {
          neon: "#f472b6",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(34, 211, 238, 0.3)",
        "glow-purple": "0 0 20px rgba(168, 85, 247, 0.35)",
        "glow-green": "0 0 20px rgba(74, 222, 128, 0.3)",
      },
      animation: {
        pulse: "pulse 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 3s linear infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
}
