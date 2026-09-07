#!/usr/bin/env node
/**
 * Root Test Runner for Medusa Plugins Monorepo
 * Executes automated unit test suites across all packages using Node's native test runner.
 */

const { spawnSync } = require("node:child_process")
const path = require("node:path")
const fs = require("node:fs")

const ROOT_DIR = path.resolve(__dirname, "..")
const PACKAGES_DIR = path.join(ROOT_DIR, "packages")
const LOADER_PATH = "./scripts/ts-loader.mjs"

const testFiles = [
    "packages/medusa-plugin-payu/src/tests/payu.test.ts",
    "packages/medusa-plugin-discord/src/tests/discord.test.ts",
    "packages/medusa-plugin-shiprocket/src/tests/shiprocket.test.ts",
    "packages/medusa-plugin-mailer/src/tests/mailer.test.ts",
    "packages/medusa-plugin-whatsapp/src/tests/whatsapp.test.ts",
]

console.log("================================================================")
console.log(" Medusa Plugins Monorepo — Running Test Suites")
console.log("================================================================\n")

let anyFailed = false

for (const relTestFile of testFiles) {
    const pkgName = relTestFile.split("/")[1]
    console.log(`[TEST] ${pkgName} (${path.basename(relTestFile)})`)

    const absTestFile = path.join(ROOT_DIR, relTestFile)
    if (!fs.existsSync(absTestFile)) {
        console.error(`  ERROR: Test file not found: ${absTestFile}`)
        anyFailed = true
        continue
    }

    const result = spawnSync(
        process.execPath,
        [
            "--no-warnings",
            "--loader", LOADER_PATH,
            "--test", relTestFile,
        ],
        {
            cwd: ROOT_DIR,
            stdio: "inherit",
            env: { ...process.env, NODE_ENV: "test" },
        }
    )

    if (result.status !== 0) {
        anyFailed = true
        console.error(`\n✖ ${pkgName} tests failed with status code ${result.status}\n`)
    } else {
        console.log(`✔ ${pkgName} passed\n`)
    }
}

console.log("================================================================")
if (anyFailed) {
    console.error(" STATUS: FAILED — Some test suites encountered failures.")
    process.exit(1)
} else {
    console.log(" STATUS: SUCCESS — All 5 plugin test suites passed cleanly!")
    process.exit(0)
}
