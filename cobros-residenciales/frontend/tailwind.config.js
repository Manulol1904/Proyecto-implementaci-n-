/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#121b2b",
          surface: "#0a1019",
          elevated: "#151d2e",
          border: "#243044",
          cyan: "#00f2ff",
          muted: "#8fa3bf",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

