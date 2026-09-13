// Bundles each AppSync JS resolver with esbuild at synth time so resolvers can share
// ./shared.js and the rubric in ../../web/js/criteria.js (single source of truth).
// Output goes to infra/.build/resolvers/<name>.js and is uploaded as a CDK asset.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const here = import.meta.dirname;
export const RESOLVERS_DIR = path.resolve(here, "..", "resolvers");
export const BUILD_DIR = path.resolve(here, "..", ".build", "resolvers");

export function bundleResolver(fileName) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const entry = path.join(RESOLVERS_DIR, fileName);
  const outfile = path.join(BUILD_DIR, fileName);
  esbuild.buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "esnext",
    sourcemap: "inline",
    sourcesContent: false,
    treeShaking: true,
    external: ["@aws-appsync/utils", "@aws-appsync/utils/*"],
    logLevel: "error",
  });
  return outfile;
}
