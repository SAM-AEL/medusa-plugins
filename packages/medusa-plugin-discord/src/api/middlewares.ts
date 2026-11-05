import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
    routes: [
        {
            matcher: "/admin/discord/*",
            middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
        },
    ],
})
