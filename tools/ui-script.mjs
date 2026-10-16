// The page's files are ES modules; the art preview tools (render_*.mjs) run some of them as plain
// scripts in Node, sharing one global scope like the old page did. This turns a module's source
// into that: import lines dropped, `export` keywords removed.
export function asScript(src) {
  return src.replace(/^import\s[^;]*;\s*$/gm, '').replace(/^export\s+(?=(async\s+)?function|class|const|let)/gm, '');
}
