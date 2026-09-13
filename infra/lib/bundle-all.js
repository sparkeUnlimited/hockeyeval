#!/usr/bin/env node
// Bundle every resolver into infra/.build/resolvers/ (used by the SAM path; the CDK stack bundles at synth).
import * as fs from "node:fs";
import { bundleResolver, RESOLVERS_DIR, BUILD_DIR } from "./bundle.js";

const files = fs.readdirSync(RESOLVERS_DIR).filter((f) => f.endsWith(".js") && f !== "shared.js");
for (const f of files) bundleResolver(f);
console.log(`bundled ${files.length} resolvers into ${BUILD_DIR}`);
