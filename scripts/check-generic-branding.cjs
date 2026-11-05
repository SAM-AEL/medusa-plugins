const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const packagesDir = path.resolve(__dirname, "../packages")
const matches = []

function visit(file) {
    const stat = fs.statSync(file)
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(file)) {
            if (["node_modules", ".medusa"].includes(entry)) continue
            visit(path.join(file, entry))
        }
        return
    }
    if (!/\.(md|ts|tsx|html|json)$/i.test(file)) return
    const text = fs.readFileSync(file, "utf8")
    if (/huetana/i.test(text)) matches.push(path.relative(packagesDir, file))
}

visit(packagesDir)
assert.deepEqual(matches, [], `consumer-specific Huetana branding found: ${matches.join(", ")}`)
