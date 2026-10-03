#!/usr/bin/env node
/**
 * Typecheck every workspace package.
 *
 * Replaces the previous `yarn workspaces run typecheck`, which is Yarn 1 syntax
 * and fails under the Yarn 4 pinned in packageManager ("Command not found;
 * did you mean one of: yarn workspaces foreach ...").
 *
 * Uses the root tsc against each package's own tsconfig so a failure names the
 * package that caused it.
 */

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const ROOT_DIR = path.resolve(__dirname, "..")
const PACKAGES_DIR = path.join(ROOT_DIR, "packages")
const TSC = path.join(ROOT_DIR, "node_modules", ".bin", "tsc")

if (!fs.existsSync(TSC)) {
    console.error(
        "typescript not found at node_modules/.bin/tsc — run `yarn install` first."
    )
    process.exit(1)
}

const packages = fs
    .readdirSync(PACKAGES_DIR)
    .filter((name) => fs.existsSync(path.join(PACKAGES_DIR, name, "tsconfig.json")))

let failed = 0

for (const name of packages) {
    const result = spawnSync(TSC, ["--noEmit", "-p", "tsconfig.json"], {
        cwd: path.join(PACKAGES_DIR, name),
        encoding: "utf8",
    })

    const output = `${result.stdout || ""}${result.stderr || ""}`.trim()

    if (result.status === 0) {
        console.log(`✔ ${name}`)
    } else {
        failed++
        console.error(`✖ ${name}`)
        console.error(output)
    }
}

console.log("================================================================")
if (failed) {
    console.error(` STATUS: FAILED — ${failed} of ${packages.length} package(s) failed typecheck.`)
    process.exit(1)
} else {
    console.log(` STATUS: SUCCESS — all ${packages.length} package(s) typecheck cleanly.`)
}