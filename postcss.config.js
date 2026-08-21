export default {
  plugins: {
    // v4 moved the PostCSS plugin to its own package and bundles vendor
    // prefixing, so autoprefixer is gone. This one file is auto-discovered by
    // BOTH vite.config.ts and vitest.config.ts (neither declares a `css` key),
    // which is why the PostCSS route is used here rather than @tailwindcss/vite.
    '@tailwindcss/postcss': {},
  },
};
