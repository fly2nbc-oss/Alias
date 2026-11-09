/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const rootDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  version: string;
};

/** Name of the single output file (runs from file:// and on any web server). */
const OUTPUT_HTML = "alias.html";

/**
 * `import data from './x.wasm?gzb64'` -> gzip-compressed content as a Base64 string.
 * For the ONNX Runtime WASM (14 MB raw -> ~5 MB Base64), unpacked in the browser via DecompressionStream.
 */
function gzipBase64(): Plugin {
  const suffix = "?gzb64";
  return {
    name: "alias:gzip-base64",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(suffix)) return null;
      const resolved = await this.resolve(source.slice(0, -suffix.length), importer, { skipSelf: true });
      return resolved ? resolved.id + suffix : null;
    },
    load(id) {
      if (!id.endsWith(suffix)) return null;
      const file = id.slice(0, -suffix.length);
      this.addWatchFile(file);
      const b64 = gzipSync(readFileSync(file), { level: 9 }).toString("base64");
      return `export default ${JSON.stringify(b64)};`;
    },
  };
}

/** Prevents an inlined script from ending the surrounding <script> block early. */
function escapeInlineScript(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/**
 * Builds one self-contained `alias.html` from index.html:
 * JS and CSS are inlined, all other output files removed.
 * Under file:// the browser blocks loading any separate file (origin `null`).
 */
function singleFile(): Plugin {
  return {
    name: "alias:single-file",
    apply: "build",
    enforce: "post",
    generateBundle: {
      // After Vite's own generateBundle (which, among other things, replaces __VITE_PRELOAD__ in the code)
      order: "post",
      handler(_options, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") this.error("index.html fehlt im Bundle");
      let out = String(html.source);
      // External references in the HTML skeleton (check before inlining; the inlined code has its own strings)
      const skeleton = out
        .replace(/<script\b[^>]*\ssrc="\.\/[^"]+"[^>]*><\/script>/g, "")
        .replace(/<link\b[^>]*\shref="\.\/[^"]+\.css"[^>]*>/g, "");
      const rest = skeleton.match(/\s(?:src|href)="(?!data:|https?:|#)[^"]*"/g);
      if (rest) this.error(`Externe Referenzen in ${OUTPUT_HTML}: ${rest.join(", ")}`);

      const used = new Set<string>(["index.html"]);
      out = out.replace(
        /<script\b([^>]*?)\s+src="\.\/([^"]+)"([^>]*)><\/script>/g,
        (tag, pre: string, file: string, post: string) => {
          const chunk = bundle[file];
          if (!chunk || chunk.type !== "chunk") return tag;
          used.add(file);
          const attrs = `${pre}${post}`.replace(/\s+crossorigin\b/g, "");
          // Run inline modules only once the DOM is ready (like <script type=module src>)
          return `<script${attrs}>${escapeInlineScript(chunk.code)}</script>`;
        },
      );
      out = out.replace(/<link\b[^>]*?\s+href="\.\/([^"]+\.css)"[^>]*>/g, (tag, file: string) => {
        const css = bundle[file];
        if (!css || css.type !== "asset") return tag;
        used.add(file);
        return `<style>${String(css.source).replace(/<\/(style)/gi, "<\\/$1")}</style>`;
      });

      // Anything that was not inlined must not exist
      for (const name of Object.keys(bundle)) {
        if (!used.has(name)) this.error(`Nicht eingebettete Ausgabedatei: ${name}`);
      }

      // Installer and CI read the version from exactly this meta tag
      const versionTags = out.split(`name="alias-version"`).length - 1;
      if (versionTags !== 1 || !out.includes(versionMeta())) {
        this.error(`${OUTPUT_HTML}: erwartet genau ein ${versionMeta()} (gefunden: ${versionTags})`);
      }

      if (out.includes("__VITE_PRELOAD__")) this.error("Unaufgelöster Platzhalter __VITE_PRELOAD__");

      for (const name of used) delete bundle[name];
      this.emitFile({ type: "asset", fileName: OUTPUT_HTML, source: out });
      },
    },
  };
}

/** Version tag in <head>; installer and CI read it literally from alias.html. */
function versionMeta(): string {
  return `<meta name="alias-version" content="${pkg.version}">`;
}

function versionMetaTag(): Plugin {
  return {
    name: "alias:version-meta",
    transformIndexHtml(html) {
      // App icon as a data URI: Vite does not inline <link rel="icon"> files
      const icon = readFileSync(join(rootDir, "src/assets/app-icon-224.png")).toString("base64");
      return html
        .replace(/<meta charset="UTF-8" \/>/, (m) => `${m}\n    ${versionMeta()}`)
        .replace('href="data:," data-alias-icon', `href="data:image/png;base64,${icon}"`);
    },
  };
}

/** `vite preview`: redirect the start page to alias.html. */
function previewRedirect(): Plugin {
  return {
    name: "alias:preview-redirect",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/" || req.url === "/index.html") {
          res.statusCode = 302;
          res.setHeader("Location", `/${OUTPUT_HTML}`);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Relative paths: the build in dist/ can be hosted in any subfolder (intranet, GitHub Pages, …)
  base: "./",

  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },

  plugins: [gzipBase64(), versionMetaTag(), singleFile(), previewRedirect()],

  resolve: {
    alias: [
      {
        // transformers.js imports the WebGPU bundle of onnxruntime-web; its built-in glue code
        // points via new URL(..., import.meta.url) to the 27 MB Asyncify WASM, which Vite would
        // otherwise inline (twice). We only need CPU/WASM: the plain WASM bundle, matching
        // ort-wasm-simd-threaded.{mjs,wasm}, which worker.ts provides itself.
        find: /^onnxruntime-web\/webgpu$/,
        replacement: join(rootDir, "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs"),
      },
    ],
  },

  worker: {
    // Classic worker: under file:// Chromium refuses module workers from Blob URLs
    // ("Refused to cross-origin redirects of the top-level worker script"); classic ones run,
    // including Cache API, fetch and import() of Blob modules. data: workers would have no Cache API.
    format: "iife",
    plugins: () => [gzipBase64()],
  },

  build: {
    target: "es2022",
    // Everything ends up in one HTML file
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    // No polyfill needed, there is only one module
    modulePreload: { polyfill: false },
    copyPublicDir: false,
    sourcemap: false,
    // The inlined ONNX Runtime (~5 MB) and pdf.js are expected to be large
    chunkSizeWarningLimit: 20000,
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },

  server: {
    port: 1420,
    strictPort: true,
  },

  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
