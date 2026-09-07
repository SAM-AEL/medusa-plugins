declare const __BACKEND_URL__: string | undefined

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
    Container, Heading, Button, Input, Label, Switch,
    Table, Badge, Text, Select, FocusModal, toast, Tabs
} from "@medusajs/ui"
import { useState, useEffect, useCallback, useRef } from "react"
import { getSuggestedDataPathsForEvent } from "../../../../shared/discord-fields"

const BACKEND_URL = (__BACKEND_URL__ ?? "").replace(/\/+$/, "")

async function api(path: string, options?: RequestInit) {
    const res = await fetch(`${BACKEND_URL}/admin/discord${path}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers,
        },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
        const errMsg = data?.message || data?.error || (data?.code ? `Error (${data.code})` : null) || `Request failed with status ${res.status}`
        throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg))
    }
    return data
}

const PRESET_EVENTS = [
    { value: "order.placed", label: "Order Placed (order.placed)" },
    { value: "order.fulfillment_created", label: "Fulfillment Created (order.fulfillment_created)" },
    { value: "fulfillment.shipment_created", label: "Shipment Created (fulfillment.shipment_created)" },
    { value: "order.completed", label: "Order Completed (order.completed)" },
    { value: "order.canceled", label: "Order Canceled (order.canceled)" },
    { value: "payment.captured", label: "Payment Captured (payment.captured)" },
    { value: "payment.refunded", label: "Payment Refunded (payment.refunded)" },
    { value: "customer.created", label: "Customer Created (customer.created)" },
    { value: "customer.updated", label: "Customer Updated (customer.updated)" },
]

const EXAMPLE_TEMPLATES: Record<string, string> = {
    "order.placed": JSON.stringify({
        embeds: [{
            title: "🛍️ New Order #{display_id}!",
            description: "An order was just placed by **{email}**.",
            color: 3447003,
            fields: [
                { name: "Total Amount", value: "**{total}**", inline: true },
                { name: "Payment Status", value: "{payment_status}", inline: true },
                { name: "Items", value: "{items}", inline: false }
            ],
            thumbnail: { url: "{thumbnail}" },
            footer: { text: "Powered by Medusa" }
        }]
    }, null, 2),
    "order.fulfillment_created": JSON.stringify({
        embeds: [{
            title: "📦 Fulfillment Created!",
            description: "Items for order **#{display_id}** are being packed.",
            color: 15105570
        }]
    }, null, 2),
    "fulfillment.shipment_created": JSON.stringify({
        embeds: [{
            title: "🚚 Order Shipped!",
            description: "Order **#{display_id}** is on its way!\n\n**Tracking:** {tracking_links}",
            color: 3066993
        }]
    }, null, 2),
    "order.completed": JSON.stringify({
        embeds: [{
            title: "✅ Order Completed!",
            description: "Order **#{display_id}** is now complete.",
            color: 3066993
        }]
    }, null, 2),
    "order.canceled": JSON.stringify({
        embeds: [{
            title: "❌ Order Canceled!",
            description: "Order **#{display_id}** has been canceled.",
            color: 15158332
        }]
    }, null, 2),
    "payment.captured": JSON.stringify({
        embeds: [{
            title: "💰 Payment Captured!",
            description: "Payment for order **#{display_id}** was successfully captured.",
            color: 3066993
        }]
    }, null, 2),
    "payment.refunded": JSON.stringify({
        embeds: [{
            title: "💸 Payment Refunded!",
            description: "Payment for order **#{display_id}** was refunded.",
            color: 15105570
        }]
    }, null, 2),
    "customer.created": JSON.stringify({
        embeds: [{
            title: "👤 New Customer!",
            description: "**{first_name} {last_name}** ({email}) just registered.",
            color: 3447003
        }]
    }, null, 2),
    "customer.updated": JSON.stringify({
        embeds: [{
            title: "👤 Customer Updated!",
            description: "Customer **{email}** updated their profile.",
            color: 3447003
        }]
    }, null, 2)
}

const EMPTY_FORM = {
    event_name: "order.placed",
    webhook_url: "",
    channel_name: "",
    is_active: true,
    message_template: "",
    bot_name: "",
}

function MappingModal({
    open,
    onClose,
    editingId,
    onSaved,
}: {
    open: boolean
    onClose: () => void
    editingId: string | null
    onSaved: () => void
}) {
    const [form, setForm] = useState({ ...EMPTY_FORM })
    const [saving, setSaving] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    // When editingId changes and modal opens, load that mapping's data
    useEffect(() => {
        if (!open) return
        if (!editingId) {
            setForm({ ...EMPTY_FORM })
            return
        }
        // find in parent - passed via onSaved reload, but we fetch directly
        api(`/mappings`).then((data) => {
            const m = (data.mappings || []).find((x: any) => x.id === editingId)
            if (m) {
                setForm({
                    event_name: m.event_name,
                    webhook_url: m.webhook_url,
                    channel_name: m.channel_name || "",
                    is_active: m.is_active,
                    message_template: m.message_template || "",
                    bot_name: m.bot_name || "",
                })
            }
        })
    }, [open, editingId])

    const handlePlaceholderClick = (placeholder: string) => {
        const textarea = textareaRef.current
        if (!textarea) {
            navigator.clipboard.writeText(`{${placeholder}}`)
            toast.success(`Copied {${placeholder}} to clipboard`)
            return
        }
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const text = textarea.value
        const newText = text.substring(0, start) + `{${placeholder}}` + text.substring(end)
        setForm({ ...form, message_template: newText })
        setTimeout(() => {
            textarea.focus()
            textarea.setSelectionRange(start + placeholder.length + 2, start + placeholder.length + 2)
        }, 0)
    }

    const save = async () => {
        if (!form.webhook_url.trim()) {
            toast.error("Webhook URL is required")
            return
        }
        if (
            !form.webhook_url.startsWith("https://discord.com/api/webhooks/") &&
            !form.webhook_url.startsWith("https://discordapp.com/api/webhooks/")
        ) {
            toast.error("Please enter a valid Discord Webhook URL")
            return
        }

        setSaving(true)
        try {
            if (editingId) {
                const data = await api(`/mappings/${editingId}`, {
                    method: "POST",
                    body: JSON.stringify(form),
                })
                if (data.success) {
                    toast.success("Mapping updated successfully")
                    onSaved()
                    onClose()
                } else {
                    toast.error(data.message || "Failed to update mapping")
                }
            } else {
                const data = await api("/mappings", {
                    method: "POST",
                    body: JSON.stringify(form),
                })
                if (data.success) {
                    toast.success("Mapping created successfully")
                    onSaved()
                    onClose()
                } else {
                    toast.error(data.message || "Failed to create mapping")
                }
            }
        } catch {
            toast.error("Something went wrong while saving")
        } finally {
            setSaving(false)
        }
    }

    return (
        <FocusModal open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <FocusModal.Content className="overflow-y-auto">
                <FocusModal.Header>
                    <div className="flex items-center gap-3">
                        <Heading level="h2">{editingId ? "Edit Webhook Mapping" : "New Webhook Mapping"}</Heading>
                    </div>
                    <Button onClick={save} isLoading={saving}>
                        {editingId ? "Save Changes" : "Create Mapping"}
                    </Button>
                </FocusModal.Header>

                <FocusModal.Body className="p-8">
                    <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Left — Form controls */}
                        <div className="md:col-span-2 space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="modal-event-name">Event Trigger</Label>
                                    <Select
                                        value={form.event_name}
                                        onValueChange={(val) => setForm({ ...form, event_name: val })}
                                    >
                                        <Select.Trigger id="modal-event-name">
                                            <Select.Value placeholder="Select event..." />
                                        </Select.Trigger>
                                        <Select.Content>
                                            {PRESET_EVENTS.map((evt) => (
                                                <Select.Item key={evt.value} value={evt.value}>
                                                    {evt.label}
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select>
                                </div>
                                <div>
                                    <Label htmlFor="modal-channel-name">Channel Label (Optional)</Label>
                                    <Input
                                        id="modal-channel-name"
                                        placeholder="e.g. #orders, #signups"
                                        value={form.channel_name}
                                        onChange={(e) => setForm({ ...form, channel_name: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <Label htmlFor="modal-bot-name">Bot Name</Label>
                                <Input
                                    id="modal-bot-name"
                                    placeholder='Leave empty to use global fallback'
                                    value={form.bot_name}
                                    onChange={(e) => setForm({ ...form, bot_name: e.target.value })}
                                />
                            </div>

                            <div>
                                <Label htmlFor="modal-webhook-url">Discord Webhook URL</Label>
                                <Input
                                    id="modal-webhook-url"
                                    placeholder="https://discord.com/api/webhooks/..."
                                    value={form.webhook_url}
                                    onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <Label htmlFor="modal-message-template">Custom Message Template (Optional)</Label>
                                    <div className="flex items-center gap-3">
                                        <Text
                                            size="xsmall"
                                            className="text-ui-fg-interactive cursor-pointer hover:underline transition-colors"
                                            onClick={() => setForm({ ...form, message_template: EXAMPLE_TEMPLATES[form.event_name] || EXAMPLE_TEMPLATES["order.placed"] })}
                                        >
                                            Load Example
                                        </Text>
                                        <span className="text-[10px] text-ui-fg-subtle">Supports Discord Markdown</span>
                                    </div>
                                </div>
                                <textarea
                                    ref={textareaRef}
                                    id="modal-message-template"
                                    rows={7}
                                    className="flex w-full rounded-md border border-ui-border-base bg-ui-bg-component px-3 py-2 text-ui-fg-base placeholder-ui-fg-muted focus:outline-none focus:ring-1 focus:ring-ui-border-interactive min-h-[160px] font-mono text-sm"
                                    placeholder={EXAMPLE_TEMPLATES[form.event_name] || "Leave empty to use the default rich embed layout."}
                                    value={form.message_template}
                                    onChange={(e) => setForm({ ...form, message_template: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-2">
                                <Switch
                                    id="modal-active-toggle"
                                    checked={form.is_active}
                                    onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                                />
                                <Label htmlFor="modal-active-toggle">Enabled</Label>
                            </div>
                        </div>

                        {/* Right — Placeholder reference */}
                        <div className="bg-ui-bg-component border border-ui-border-base rounded-md p-4 flex flex-col max-h-[480px]">
                            <Heading level="h3" className="text-sm font-semibold mb-1">
                                Available Placeholders
                            </Heading>
                            <Text size="xsmall" className="text-ui-fg-subtle mb-3">
                                Click to insert at cursor in the template.
                            </Text>
                            <div className="overflow-y-auto flex-1 pr-1 space-y-1.5">
                                {getSuggestedDataPathsForEvent(form.event_name).map((field) => (
                                    <div
                                        key={field}
                                        onClick={() => handlePlaceholderClick(field)}
                                        className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-ui-bg-subtle cursor-pointer border border-transparent hover:border-ui-border-base transition-all group"
                                    >
                                        <code className="text-ui-fg-interactive text-xs font-mono">
                                            {`{${field}}`}
                                        </code>
                                        <span className="text-[10px] text-ui-fg-muted opacity-0 group-hover:opacity-100 transition-opacity">
                                            Insert
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </FocusModal.Body>
            </FocusModal.Content>
        </FocusModal>
    )
}

function SettingsTab() {
    const [form, setForm] = useState({ avatar_url: "", footer_text: "" })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        api("/settings").then((data) => {
            if (data?.settings) {
                setForm({
                    avatar_url: data.settings.avatar_url || "",
                    footer_text: data.settings.footer_text || "",
                })
            }
            setLoading(false)
        }).catch(() => {
            toast.error("Failed to load settings")
            setLoading(false)
        })
    }, [])

    const handleSave = async () => {
        setSaving(true)
        try {
            await api("/settings", {
                method: "POST",
                body: JSON.stringify(form)
            })
            toast.success("Settings saved successfully")
        } catch {
            toast.error("Failed to save settings")
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="p-6"><Text>Loading settings...</Text></div>

    return (
        <Container className="p-6">
            <Heading level="h2" className="mb-4">Global Settings</Heading>
            <div className="flex flex-col gap-4 max-w-lg">
                <div className="flex flex-col gap-2">
                    <Label>Default Avatar URL</Label>
                    <Input 
                        placeholder="https://example.com/logo.png" 
                        value={form.avatar_url}
                        onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                    />
                    <Text size="small" className="text-ui-fg-subtle">
                        The icon URL to use for the Discord bot avatar if no custom bot name/avatar is provided in the mappings. Leave empty to use Discord's default.
                    </Text>
                </div>
                <div className="flex flex-col gap-2">
                    <Label>Default Footer Text</Label>
                    <Input 
                        placeholder="Medusa Storefront" 
                        value={form.footer_text}
                        onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
                    />
                    <Text size="small" className="text-ui-fg-subtle">
                        The footer text displayed at the bottom of the rich embeds for orders and customers.
                    </Text>
                </div>
                <div className="flex justify-end mt-4">
                    <Button variant="primary" onClick={handleSave} isLoading={saving}>
                        Save Settings
                    </Button>
                </div>
            </div>
        </Container>
    )
}

function DiscordNotificationsPage() {
    const [mappings, setMappings] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [testingId, setTestingId] = useState<string | null>(null)

    const loadMappings = useCallback(async () => {
        setLoading(true)
        try {
            const data = await api("/mappings")
            setMappings(data.mappings || [])
        } catch {
            toast.error("Failed to load webhook mappings")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadMappings()
    }, [loadMappings])

    const openAdd = () => {
        setEditingId(null)
        setModalOpen(true)
    }

    const openEdit = (m: any) => {
        setEditingId(m.id)
        setModalOpen(true)
    }

    const deleteMapping = async (id: string) => {
        if (!confirm("Are you sure you want to delete this webhook mapping?")) return
        try {
            const data = await api(`/mappings/${id}`, { method: "DELETE" })
            if (data.success) {
                toast.success("Mapping deleted")
                loadMappings()
            } else {
                toast.error(data.message || "Failed to delete mapping")
            }
        } catch {
            toast.error("Failed to delete mapping")
        }
    }

    const toggleActive = async (m: any, checked: boolean) => {
        try {
            const data = await api(`/mappings/${m.id}`, {
                method: "POST",
                body: JSON.stringify({ is_active: checked }),
            })
            if (data.success) {
                toast.success(checked ? "Webhook enabled" : "Webhook disabled")
                loadMappings()
            } else {
                toast.error(data.message || "Failed to toggle status")
            }
        } catch {
            toast.error("Failed to toggle mapping status")
        }
    }

    const testWebhook = async (id: string) => {
        setTestingId(id)
        try {
            const data = await api(`/verify`, {
                method: "POST",
                body: JSON.stringify({ id }),
            })
            if (data.success) {
                toast.success("Test notification sent successfully!")
            } else {
                toast.error(data.message || "Webhook test failed")
            }
        } catch {
            toast.error("Test request failed")
        } finally {
            setTestingId(null)
        }
    }

    const maskWebhookUrl = (url: string) => {
        if (!url) return ""
        try {
            const parts = url.split("/webhooks/")
            if (parts.length < 2) return url
            const [id, token] = parts[1].split("/")
            return `.../webhooks/${id.slice(0, 4)}...${id.slice(-4)}/${token.slice(0, 6)}...${token.slice(-6)}`
        } catch {
            return ".../webhooks/xxxx/xxxx"
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <Heading level="h1">Discord Notifications</Heading>
                    <Text size="small" className="text-ui-fg-subtle mt-0.5">
                        Route events from your Medusa store directly to your Discord channels using webhooks.
                    </Text>
                </div>
                <Button variant="secondary" onClick={openAdd}>
                    Add Mapping
                </Button>
            </div>

            <MappingModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                editingId={editingId}
                onSaved={loadMappings}
            />

            <Tabs defaultValue="webhooks">
                <Tabs.List>
                    <Tabs.Trigger value="webhooks">Webhooks</Tabs.Trigger>
                    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="webhooks" className="mt-4">
                    <Container className="p-0 overflow-hidden border border-ui-border-base rounded-lg">
                {loading ? (
                    <div className="p-6">
                        <Text>Loading mappings...</Text>
                    </div>
                ) : mappings.length === 0 ? (
                    <div className="p-6 text-center">
                        <Text className="text-ui-fg-muted">No webhook mappings configured yet.</Text>
                    </div>
                ) : (
                    <Table>
                        <Table.Header>
                            <Table.Row>
                                <Table.HeaderCell>Event Name</Table.HeaderCell>
                                <Table.HeaderCell>Channel Label</Table.HeaderCell>
                                <Table.HeaderCell>Webhook URL</Table.HeaderCell>
                                <Table.HeaderCell>Status</Table.HeaderCell>
                                <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {mappings.map((m: any) => (
                                <Table.Row key={m.id}>
                                    <Table.Cell>
                                        <Badge color="blue">{m.event_name}</Badge>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Text size="small" className="font-mono">{m.channel_name || "—"}</Text>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Text size="small" className="text-ui-fg-subtle font-mono">
                                            {maskWebhookUrl(m.webhook_url)}
                                        </Text>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={m.is_active}
                                                onCheckedChange={(checked) => toggleActive(m, checked)}
                                            />
                                            <Badge color={m.is_active ? "green" : "grey"}>
                                                {m.is_active ? "Active" : "Inactive"}
                                            </Badge>
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="secondary"
                                                size="small"
                                                onClick={() => testWebhook(m.id)}
                                                isLoading={testingId === m.id}
                                            >
                                                Test
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="small"
                                                onClick={() => openEdit(m)}
                                            >
                                                Edit
                                            </Button>
                                            <Button
                                                variant="danger"
                                                size="small"
                                                onClick={() => deleteMapping(m.id)}
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                )}
                    </Container>
                </Tabs.Content>
                <Tabs.Content value="settings" className="mt-4">
                    <SettingsTab />
                </Tabs.Content>
            </Tabs>
        </div>
    )
}

export const config = defineRouteConfig({
    label: "Discord Notifications",
})

export default DiscordNotificationsPage
