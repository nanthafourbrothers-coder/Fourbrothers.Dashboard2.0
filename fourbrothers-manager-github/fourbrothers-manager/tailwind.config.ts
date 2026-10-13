import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff1f1",
          100: "#ffe0e1",
          200: "#ffc6c8",
          300: "#ff9fa3",
          400: "#f76a70",
          500: "#e63c44",
          600: "#d31b25",
          700: "#b01019",
          800: "#8f121a",
          900: "#771419",
        },
        ink: {
          50: "#f7f7f8",
          100: "#eeeef0",
          200: "#dcdce0",
          300: "#c0c0c7",
          400: "#9a9aa4",
          500: "#767681",
          600: "#5b5b66",
          700: "#46464f",
          800: "#2c2c33",
          900: "#18181c",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(24,24,28,0.05), 0 1px 3px rgba(24,24,28,0.06)",
        pop: "0 10px 30px rgba(24,24,28,0.15)",
      },
    },
  },
  plugins: [],
};
export default config;
