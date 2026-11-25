import { build, context } from "esbuild";

const config = {
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: process.env.NODE_ENV === "production",
  sourcemap: true,
  outfile: "dist/assets/app.js",
  loader: { ".jsx": "jsx", ".svg": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development") }
};

if (process.argv.includes("--watch")) {
  const ctx = await context(config);
  await ctx.watch();
  console.log("FirstLink V2 is watching for changes.");
} else {
  await build(config);
  console.log("FirstLink V2 build complete.");
}