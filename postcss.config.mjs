/** Tailwind runs first, then autoprefixer rewrites the vendor prefixes. */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
