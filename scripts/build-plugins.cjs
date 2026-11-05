const { spawnSync } = require("node:child_process")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const medusa = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "medusa.cmd" : "medusa")
const packages = [
    "medusa-plugin-discord",
    "medusa-plugin-mailer",
    "medusa-plugin-payu",
    "medusa-plugin-shiprocket",
    "medusa-plugin-whatsapp",
]

for (const name of packages) {
    console.log(`[BUILD] ${name}`)
    const result = spawnSync(medusa, ["plugin:build"], {
        cwd: path.join(root, "packages", name),
        stdio: "inherit",
        shell: process.platform === "win32",
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status || 1)
}
