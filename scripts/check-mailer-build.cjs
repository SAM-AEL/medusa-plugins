const assert = require("node:assert/strict")
const path = require("node:path")

const packageDir = path.resolve(__dirname, "../packages/medusa-plugin-mailer")
process.chdir(packageDir)
const templateUtils = require(path.join(packageDir, ".medusa/server/src/shared/template-utils.js"))
const template = templateUtils.readTemplate("order_placed.html")

assert.ok(template, "bundled order_placed template should resolve from the built package")
assert.ok(template.html.includes("{{"), "bundled template should contain template variables")
