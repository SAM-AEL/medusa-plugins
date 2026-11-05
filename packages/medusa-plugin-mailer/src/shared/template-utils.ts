import * as fs from "fs"
import * as path from "path"

function resolveBundledTemplatesDir(): string {
    const candidates = [
        ...(typeof __dirname === "string" ? [path.resolve(__dirname, "../../../../email_templates")] : []),
        path.resolve(process.cwd(), "email_templates"),
        path.resolve(process.cwd(), "packages/medusa-plugin-mailer/email_templates"),
        path.resolve(process.cwd(), "node_modules/@sam-ael/medusa-plugin-mailer/email_templates"),
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

const BUNDLED_TEMPLATES_DIR = resolveBundledTemplatesDir()

export function resolveTemplatesDir(): string {
    const envDir = process.env.MAILER_TEMPLATES_DIR

    if (envDir) {
        const resolved = path.isAbsolute(envDir)
            ? envDir
            : path.resolve(process.cwd(), envDir)

        if (fs.existsSync(resolved)) {
            return resolved
        }
        // eslint-disable-next-line no-console
        console.warn(`[Mailer] MAILER_TEMPLATES_DIR does not exist: ${resolved}. Falling back to bundled templates.`)
    }

    return BUNDLED_TEMPLATES_DIR
}

export function resolveTemplatePath(templateName: string): string | null {
    if (!templateName || typeof templateName !== "string") {
        return null
    }

    const templatesDir = resolveTemplatesDir()
    const normalizedPath = path.resolve(templatesDir, templateName)
    const relativePath = path.relative(templatesDir, normalizedPath)

    if (
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath) ||
        path.extname(normalizedPath).toLowerCase() !== ".html"
    ) {
        return null
    }

    // Resolve symlinks and re-check containment (symlink escape guard)
    try {
        const realDir = fs.realpathSync(templatesDir)
        const realPath = fs.realpathSync(normalizedPath)
        const realRelative = path.relative(realDir, realPath)
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
            return null
        }
    } catch {
        // Target does not exist yet / cannot be resolved: fall back to lexical check above
    }

    return normalizedPath
}

export function stripHtml(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

export function readTemplate(templateName: string): {
    html: string
    templatePath: string
    templatesDir: string
} | null {
    const templatePath = resolveTemplatePath(templateName)
    const templatesDir = resolveTemplatesDir()

    if (!templatePath || !fs.existsSync(templatePath)) {
        return null
    }

    return {
        html: fs.readFileSync(templatePath, "utf-8"),
        templatePath,
        templatesDir,
    }
}
