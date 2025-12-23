// Transform to replace import.meta.env with a mockable version
module.exports = {
  process(src, filename) {
    // Replace import.meta.env with a mockable version
    const transformed = src.replace(
      /import\.meta\.env\.(\w+)/g,
      "(typeof import !== 'undefined' && import.meta ? import.meta.env : (globalThis.__import_meta_env__ || {})).$1"
    )
    return transformed
  },
}

