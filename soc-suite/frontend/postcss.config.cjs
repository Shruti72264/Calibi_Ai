/**
 * The SENTINEL SOC dashboard uses plain CSS (src/styles.css) - no Tailwind, no
 * PostCSS plugins. This empty config exists to *stop* the toolchain from walking
 * up to a parent directory and picking up an unrelated project's PostCSS config.
 */
module.exports = { plugins: [] };
