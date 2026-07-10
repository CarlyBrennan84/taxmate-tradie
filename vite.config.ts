import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path matches the GitHub Pages project URL:
// https://<username>.github.io/taxmate-tradie/
export default defineConfig({
  plugins: [react()],
  base: "/taxmate-tradie/",
});
