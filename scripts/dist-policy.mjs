import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const required = [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/suite/index.js",
    "dist/replay/index.js",
    "dist/shrink/index.js",
    "dist/corpus/index.js",
    "dist/http/index.js"
];

const publicExports = [
    "suite",
    "replay",
    "shrink",
    "corpusFromReport",
    "jsonHttpRunner",
    "contractFromSchema"
];

let failed = false;

for (let index = 0; index < required.length; index += 1) {
    const path = required[index];
    if (path === undefined) {
        continue;
    }
    await access(path, constants.R_OK).then(
        () => undefined,
        () => {
            console.error(`missing dist file: ${path}`);
            failed = true;
        }
    );
}

const indexSource = await readFile("dist/index.d.ts", "utf8");
for (let index = 0; index < publicExports.length; index += 1) {
    const name = publicExports[index];
    if (name !== undefined && !indexSource.includes(name)) {
        console.error(`missing public export in dist/index.d.ts: ${name}`);
        failed = true;
    }
}

await scanDist("dist");

if (failed) {
    process.exitCode = 1;
}

/**
 * @brief Scan dist for leaked TypeScript source files.
 * @param path Directory path.
 */
async function scanDist(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry === undefined) {
            continue;
        }
        const child = join(path, entry.name);
        if (entry.isDirectory()) {
            await scanDist(child);
            continue;
        }
        if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            console.error(`unexpected TypeScript source in dist: ${child}`);
            failed = true;
        }
    }
}
