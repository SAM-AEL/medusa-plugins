import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
    routes: [
        {
            matcher: "/admin/mailer/*",
            middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
        },
    ],
})
