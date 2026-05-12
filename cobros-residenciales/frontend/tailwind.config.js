/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        app: {
          // Layout (driven by CSS vars in styles.css → light + .dark variants)
          bg: "rgb(var(--app-bg) / <alpha-value>)",
          surface: "rgb(var(--app-surface) / <alpha-value>)",
          elevated: "rgb(var(--app-elevated) / <alpha-value>)",
          border: "rgb(var(--app-border) / <alpha-value>)",
          muted: "rgb(var(--app-muted) / <alpha-value>)",
          text: "rgb(var(--app-text) / <alpha-value>)",

          // Brand
          primary: "rgb(var(--app-primary) / <alpha-value>)",
          "primary-hover": "rgb(var(--app-primary-hover) / <alpha-value>)",
          // Legacy alias kept so existing classes (bg-app-cyan, text-app-cyan)
          // still resolve to the primary brand color.
          cyan: "rgb(var(--app-primary) / <alpha-value>)",
          accent: "rgb(var(--app-accent) / <alpha-value>)",

          // Sidebar (dark in both themes, but tweaked for contrast)
          sidebar: "rgb(var(--app-sidebar) / <alpha-value>)",
          "sidebar-hover": "rgb(var(--app-sidebar-hover) / <alpha-value>)",
          "sidebar-active": "rgb(var(--app-sidebar-active) / <alpha-value>)",
          "sidebar-text": "rgb(var(--app-sidebar-text) / <alpha-value>)",
          "sidebar-muted": "rgb(var(--app-sidebar-muted) / <alpha-value>)",

          // Semantic status (banners, pills). One token per role, dual values in styles.css.
          "danger-bg": "rgb(var(--app-danger-bg) / <alpha-value>)",
          "danger-text": "rgb(var(--app-danger-text) / <alpha-value>)",
          "danger-border": "rgb(var(--app-danger-border) / <alpha-value>)",
          "success-bg": "rgb(var(--app-success-bg) / <alpha-value>)",
          "success-text": "rgb(var(--app-success-text) / <alpha-value>)",
          "success-border": "rgb(var(--app-success-border) / <alpha-value>)",
          "warning-bg": "rgb(var(--app-warning-bg) / <alpha-value>)",
          "warning-text": "rgb(var(--app-warning-text) / <alpha-value>)",
          "warning-border": "rgb(var(--app-warning-border) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "var(--card-shadow)",
        "card-hover": "var(--card-shadow-hover)",
      },
    },
  },
  plugins: [],
};
