/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#132038",
        "navy-soft": "#3A4A66",
        teal: {
          DEFAULT: "#2A63E5",
          dark: "#1E4FBE",
          tint: "#E9EFFE",
        },
        amber: "#C77F1A",
        coral: "#C4573F",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(19,32,56,0.04), 0 8px 24px -12px rgba(19,32,56,0.10)",
        "card-hover": "0 2px 4px rgba(19,32,56,0.06), 0 16px 32px -12px rgba(19,32,56,0.16)",
      },
    },
  },
  plugins: [],
};
