declare const __BACKEND_URL__: string | undefined

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight, EllipsisHorizontal } from "@medusajs/icons"
import { Container, Heading, Button, Input, Label, Switch, Table, Badge, Text, Select, Toaster, toast, FocusModal, DropdownMenu, IconButton } from "@medusajs/ui"
import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { getSuggestedDataPathsForEvent, WHATSAPP_EVENTS } from "../../../shared/whatsapp-fields"

const BACKEND_URL = (__BACKEND_URL__ ?? "").replace(/\/+$/, "")

async function api(path: string, options?: RequestInit) {
    const res = await fetch(`${BACKEND_URL}/admin/whatsapp${path}`, {
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

// ─── Configuration Section ─────────────────────────────────────
function ConfigSection() {
    const [envPhoneNumberId, setEnvPhoneNumberId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        phone_number_id: "",
        active: true,
    })

    const loadConfig = useCallback(async () => {
        setLoading(true)
        const data = await api("/config")
        if (data.env_phone_number_id) setEnvPhoneNumberId(data.env_phone_number_id)
        if (data.config) {
            setForm({
                phone_number_id: data.config.phone_number_id || "",
                active: data.config.active ?? true,
            })
        }
        setLoading(false)
    }, [])

    useEffect(() => { loadConfig() }, [loadConfig])

    const saveConfig = async () => {
        setSaving(true)
        const payload: any = { ...form }
        await api("/config", { method: "POST", body: JSON.stringify(payload) })
        toast.success("Configuration saved")
        await loadConfig()
        setSaving(false)
    }

    if (loading) return <Text>Loading configuration...</Text>

    return (
        <Container className="p-6">
            <div className="flex items-center justify-between mb-4">
                <Heading level="h2">WhatsApp Configuration</Heading>
                <div className="flex items-center gap-2">
                    <Label htmlFor="wa-active">Active</Label>
                    <Switch
                        id="wa-active"
                        checked={form.active}
                        onCheckedChange={(checked) => setForm({ ...form, active: checked })}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="phone-id">Phone Number ID</Label>
                    <Input
                        id="phone-id"
                        placeholder={envPhoneNumberId ? `Env: ${envPhoneNumberId}` : "e.g. 1234567890"}
                        value={form.phone_number_id}
                        onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                    />
                </div>
                <div>
                    <Label>Access Token</Label>
                    <Text size="small" className="text-ui-fg-muted mt-1">
                        Configured as Environment Variable
                    </Text>
                </div>

            </div>

            <div className="mt-4 flex justify-end">
                <Button onClick={saveConfig} isLoading={saving}>
                    Save Configuration
                </Button>
            </div>


        </Container>
    )
}

// ─── Event Mappings Section ─────────────────────────────────────
const RECIPIENT_OPTIONS = [
    { value: "billing_shipping", label: "Billing phone (fallback: shipping)" },
    { value: "billing", label: "Billing phone only" },
    { value: "shipping", label: "Shipping phone only" },
    { value: "custom", label: "Custom phone number" },
]

function getDataPathsForEvent(eventName: string) {
    return getSuggestedDataPathsForEvent(eventName).map((value) => ({
        value,
        label: value
            .split(".")
            .map((part) => part.replace(/_/g, " "))
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" -> "),
    }))
}

type TemplateVar = { name: string; path: string }
const EMPTY_VAR: TemplateVar = { name: "", path: "" }
const MAX_VARS = 5

function MappingsSection() {
    const [mappings, setMappings] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [templateVars, setTemplateVars] = useState<TemplateVar[]>([{ ...EMPTY_VAR }])
    const [templates, setTemplates] = useState<any[]>([])
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [form, setForm] = useState({
        event_name: WHATSAPP_EVENTS[0],
        template_name: "",
        language_code: "en_US",
        recipient_type: "billing_shipping",
        recipient_phone: "",
        active: true,
    })

    const loadMappings = useCallback(async () => {
        setLoading(true)
        const data = await api("/mappings")
        setMappings(data.mappings || [])
        setLoading(false)
    }, [])

    useEffect(() => { loadMappings() }, [loadMappings])

    // Fetch templates when form opens — only if not already loaded
    useEffect(() => {
        if (showForm && templates.length === 0) {
            setLoadingTemplates(true)
            api("/templates").then((data) => {
                setTemplates(data.templates || [])
                setLoadingTemplates(false)
            }).catch(() => setLoadingTemplates(false))
        }
    }, [showForm])

    const onTemplateSelect = (name: string) => {
        const tpl = templates.find((t) => t.name === name)
        setForm((prev) => ({
            ...prev,
            template_name: name,
            language_code: tpl?.language || prev.language_code,
        }))
    }

    const resetForm = () => {
        setForm({ event_name: WHATSAPP_EVENTS[0], template_name: "", language_code: "en_US", recipient_type: "billing_shipping", recipient_phone: "", active: true })
        setTemplateVars([{ ...EMPTY_VAR }])
        setEditingId(null)
        setShowForm(false)
    }

    const updateVar = (index: number, field: keyof TemplateVar, value: string) => {
        setTemplateVars((prev) => prev.map((v, i) => i === index ? { ...v, [field]: value } : v))
    }
    const addVar = () => {
        if (templateVars.length < MAX_VARS) setTemplateVars((prev) => [...prev, { ...EMPTY_VAR }])
    }
    const removeVar = (index: number) => {
        setTemplateVars((prev) => prev.length <= 1 ? [{ ...EMPTY_VAR }] : prev.filter((_, i) => i !== index))
    }

    const saveMapping = async () => {
        // Convert rows to { name: path } JSON
        const variables: Record<string, string> = {}
        templateVars.forEach((v, i) => {
            const name = v.name.trim() || String(i + 1)
            if (v.path.trim()) variables[name] = v.path.trim()
        })

        const payload = { ...form, template_variables: variables }

        if (editingId) {
            await api(`/mappings/${editingId}`, { method: "POST", body: JSON.stringify(payload) })
            toast.success("Mapping updated")
        } else {
            await api("/mappings", { method: "POST", body: JSON.stringify(payload) })
            toast.success("Mapping created")
        }

        resetForm()
        await loadMappings()
    }

    const deleteMapping = async (id: string) => {
        await api(`/mappings/${id}`, { method: "DELETE" })
        toast.success("Mapping deleted")
        await loadMappings()
    }

    const editMapping = (m: any) => {
        // Convert JSON object back to rows — handle both string and object
        let vars: Record<string, string> = {}
        if (m.template_variables) {
            if (typeof m.template_variables === "string") {
                try { vars = JSON.parse(m.template_variables) } catch { /* ignore */ }
            } else {
                vars = m.template_variables
            }
        }
        const rows: TemplateVar[] = Object.entries(vars).map(([name, path]) => ({ name, path: path as string }))
        setTemplateVars(rows.length > 0 ? rows : [{ ...EMPTY_VAR }])
        setForm({
            event_name: m.event_name,
            template_name: m.template_name,
            language_code: m.language_code,
            recipient_type: m.recipient_type || "billing_shipping",
            recipient_phone: m.recipient_phone || "",
            active: m.active,
        })
        setEditingId(m.id)
        setShowForm(true)
    }

    const recipientLabel = (type: string, phone?: string) => {
        const opt = RECIPIENT_OPTIONS.find((o) => o.value === type)
        if (type === "custom" && phone) return `Custom: ${phone}`
        return opt?.label || type
    }

    return (
        <Container className="p-6">
            <div className="flex items-center justify-between mb-4">
                <Heading level="h2">Event → Template Mappings</Heading>
                <Button variant="secondary" onClick={() => { resetForm(); setShowForm(!showForm) }}>
                    {showForm ? "Cancel" : "Add Mapping"}
                </Button>
            </div>

            {showForm && (
                <div className="border rounded-lg p-4 mb-4 bg-ui-bg-subtle">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="event-name">Medusa Event</Label>
                            <Input
                                id="event-name"
                                list="medusa-events-list"
                                placeholder="Select or type a custom event..."
                                value={form.event_name}
                                onChange={(e) => setForm({ ...form, event_name: e.target.value })}
                            />
                            <datalist id="medusa-events-list">
                                {WHATSAPP_EVENTS.map((e) => (
                                    <option key={e} value={e} />
                                ))}
                            </datalist>
                            <Text size="small" className="text-ui-fg-muted mt-1">
                                Pick a preset or type any custom event name
                            </Text>
                        </div>
                        <div>
                            <Label htmlFor="tpl-name">WhatsApp Template</Label>
                            {templates.length > 0 ? (
                                <Select value={form.template_name} onValueChange={onTemplateSelect}>
                                    <Select.Trigger>
                                        <Select.Value placeholder={loadingTemplates ? "Loading..." : "Select a template"} />
                                    </Select.Trigger>
                                    <Select.Content>
                                        {templates.map((t: any) => (
                                            <Select.Item key={`${t.name}-${t.language}`} value={t.name}>
                                                {t.name} ({t.language})
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select>
                            ) : (
                                <Input
                                    id="tpl-name"
                                    placeholder={loadingTemplates ? "Loading templates..." : "e.g. order_confirmation"}
                                    value={form.template_name}
                                    onChange={(e) => setForm({ ...form, template_name: e.target.value })}
                                />
                            )}
                            {!loadingTemplates && templates.length === 0 && (
                                <Text size="small" className="text-ui-fg-muted mt-1">
                                    Set WHATSAPP_BUSINESS_ACCOUNT_ID env var to load templates
                                </Text>
                            )}
                        </div>
                        <div>
                            <Label htmlFor="recipient-type">Send To</Label>
                            <Select value={form.recipient_type} onValueChange={(val) => setForm({ ...form, recipient_type: val })}>
                                <Select.Trigger>
                                    <Select.Value placeholder="Select recipient" />
                                </Select.Trigger>
                                <Select.Content>
                                    {RECIPIENT_OPTIONS.map((opt) => (
                                        <Select.Item key={opt.value} value={opt.value}>{opt.label}</Select.Item>
                                    ))}
                                </Select.Content>
                            </Select>
                        </div>
                        {form.recipient_type === "custom" && (
                            <div>
                                <Label htmlFor="recipient-phone">Custom Phone Number</Label>
                                <Input
                                    id="recipient-phone"
                                    placeholder="e.g. 919876543210"
                                    value={form.recipient_phone}
                                    onChange={(e) => setForm({ ...form, recipient_phone: e.target.value })}
                                />
                                <Text size="small" className="text-ui-fg-muted mt-1">
                                    Include country code, no + prefix
                                </Text>
                            </div>
                        )}
                        <div className="flex items-end gap-2">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="mapping-active">Active</Label>
                                <Switch
                                    id="mapping-active"
                                    checked={form.active}
                                    onCheckedChange={(checked) => setForm({ ...form, active: checked })}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <Label>Template Variables</Label>
                            {templateVars.length < MAX_VARS && (
                                <Button variant="secondary" size="small" onClick={addVar}>
                                    + Add Variable
                                </Button>
                            )}
                        </div>
                        <Text size="small" className="text-ui-fg-muted mb-2">
                            Map WhatsApp template variable positions (e.g. 1, 2, 3) to order data fields.
                        </Text>
                        <div className="flex flex-col gap-2">
                            {templateVars.map((v, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <div className="w-24 flex-shrink-0">
                                        <Input
                                            placeholder={`${i + 1}`}
                                            value={v.name}
                                            onChange={(e) => updateVar(i, "name", e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <Input
                                            list="event-data-paths"
                                            placeholder="Select or type a data path..."
                                            value={v.path}
                                            onChange={(e) => updateVar(i, "path", e.target.value)}
                                        />
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={() => removeVar(i)}
                                    >
                                        ✕
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <datalist id="event-data-paths">
                            {getDataPathsForEvent(form.event_name).map((p) => (
                                <option key={p.value} value={p.value} label={p.label} />
                            ))}
                        </datalist>
                    </div>
                    <div className="mt-3 flex justify-end">
                        <Button onClick={saveMapping}>
                            {editingId ? "Update Mapping" : "Create Mapping"}
                        </Button>
                    </div>
                </div>
            )}

            {loading ? (
                <Text>Loading mappings...</Text>
            ) : mappings.length === 0 ? (
                <Text className="text-ui-fg-muted">No event mappings configured. Add one to get started.</Text>
            ) : (
                <Table>
                    <Table.Header>
                        <Table.Row>
                            <Table.HeaderCell>Event</Table.HeaderCell>
                            <Table.HeaderCell>Template</Table.HeaderCell>
                            <Table.HeaderCell>Send To</Table.HeaderCell>
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
                                <Table.Cell>{m.template_name}</Table.Cell>
                                <Table.Cell>
                                    <Text size="small">{recipientLabel(m.recipient_type, m.recipient_phone)}</Text>
                                </Table.Cell>

                                <Table.Cell>
                                    <Badge color={m.active ? "green" : "grey"}>
                                        {m.active ? "Active" : "Inactive"}
                                    </Badge>
                                </Table.Cell>
                                <Table.Cell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button variant="secondary" size="small" onClick={() => editMapping(m)}>
                                            Edit
                                        </Button>
                                        <Button variant="danger" size="small" onClick={() => deleteMapping(m.id)}>
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
    )
}

// ─── Manual Send Modal ─────────────────────────────────────────
type ManualVar = { name: string; value: string }
const EMPTY_MANUAL_VAR: ManualVar = { name: "", value: "" }
const MAX_MANUAL_VARS = 10

function ManualSendModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [sending, setSending] = useState(false)
    const [templates, setTemplates] = useState<any[]>([])
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [manualVars, setManualVars] = useState<ManualVar[]>([{ ...EMPTY_MANUAL_VAR }])
    const [form, setForm] = useState({
        phone_number: "",
        template_name: "",
        language_code: "en_US",
    })

    const updateManualVar = (index: number, field: keyof ManualVar, value: string) => {
        setManualVars((prev) => prev.map((v, i) => i === index ? { ...v, [field]: value } : v))
    }
    const addManualVar = () => {
        if (manualVars.length < MAX_MANUAL_VARS) setManualVars((prev) => [...prev, { ...EMPTY_MANUAL_VAR }])
    }
    const removeManualVar = (index: number) => {
        setManualVars((prev) => prev.length <= 1 ? [{ ...EMPTY_MANUAL_VAR }] : prev.filter((_, i) => i !== index))
    }

    // Fetch templates when modal opens
    useEffect(() => {
        if (open) {
            setLoadingTemplates(true)
            api("/templates").then((data) => {
                setTemplates(data.templates || [])
                setLoadingTemplates(false)
            }).catch(() => setLoadingTemplates(false))
        }
    }, [open])

    // When a template is selected, auto-fill its language code
    const onTemplateSelect = (name: string) => {
        setForm((prev) => {
            const tpl = templates.find((t) => t.name === name)
            return {
                ...prev,
                template_name: name,
                language_code: tpl?.language || prev.language_code,
            }
        })
    }

    const sendMessage = async () => {
        if (!form.phone_number || !form.template_name) {
            toast.error("Phone number and template name are required")
            return
        }
        setSending(true)
        // Convert variable rows to { name: value } JSON
        const variables: Record<string, string> = {}
        manualVars.forEach((v, i) => {
            const name = v.name.trim() || String(i + 1)
            if (v.value.trim()) variables[name] = v.value.trim()
        })

        const result = await api("/manual", {
            method: "POST",
            body: JSON.stringify({ ...form, template_variables: variables }),
        })

        if (result.success) {
            toast.success("Message sent!")
        } else {
            toast.error(`Failed: ${result.error?.error?.message || result.error || "Unknown error"}`)
        }
        setSending(false)
    }

    return (
        <FocusModal open={open} onOpenChange={onOpenChange}>
            <FocusModal.Content>
                <FocusModal.Header>
                    <FocusModal.Title>Send Message</FocusModal.Title>
                </FocusModal.Header>
                <FocusModal.Body className="p-6">
                    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
                        <Text className="text-ui-fg-muted">
                            Send a WhatsApp template message to a phone number.
                        </Text>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="manual-phone">Phone Number (with country code)</Label>
                                <Input
                                    id="manual-phone"
                                    placeholder="e.g. 919876543210"
                                    value={form.phone_number}
                                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="manual-tpl">Template Name</Label>
                                {templates.length > 0 ? (
                                    <Select value={form.template_name} onValueChange={onTemplateSelect}>
                                        <Select.Trigger>
                                            <Select.Value placeholder={loadingTemplates ? "Loading..." : "Select a template"} />
                                        </Select.Trigger>
                                        <Select.Content>
                                            {templates.map((t: any) => (
                                                <Select.Item key={`${t.name}-${t.language}`} value={t.name}>
                                                    {t.name} ({t.language})
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select>
                                ) : (
                                    <Input
                                        id="manual-tpl"
                                        placeholder={loadingTemplates ? "Loading templates..." : "e.g. hello_world"}
                                        value={form.template_name}
                                        onChange={(e) => setForm({ ...form, template_name: e.target.value })}
                                    />
                                )}
                                {!loadingTemplates && templates.length === 0 && (
                                    <Text size="small" className="text-ui-fg-muted mt-1">
                                        Set WHATSAPP_BUSINESS_ACCOUNT_ID env var to load templates
                                    </Text>
                                )}
                            </div>
                        </div>
                        <div className="mt-2">
                            <div className="flex items-center justify-between mb-2">
                                <Label>Template Variables</Label>
                                {manualVars.length < MAX_MANUAL_VARS && (
                                    <Button variant="secondary" size="small" onClick={addManualVar}>
                                        + Add Variable
                                    </Button>
                                )}
                            </div>
                            <Text size="small" className="text-ui-fg-muted mb-2">
                                Add template variable positions (e.g. 1, 2, 3) and their values.
                            </Text>
                            <div className="flex flex-col gap-2">
                                {manualVars.map((v, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <div className="w-24 flex-shrink-0">
                                            <Input
                                                placeholder={`${i + 1}`}
                                                value={v.name}
                                                onChange={(e) => updateManualVar(i, "name", e.target.value)}
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <Input
                                                placeholder="Variable value..."
                                                value={v.value}
                                                onChange={(e) => updateManualVar(i, "value", e.target.value)}
                                            />
                                        </div>
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            onClick={() => removeManualVar(i)}
                                        >
                                            ✕
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button onClick={sendMessage} isLoading={sending}>
                                Send Message
                            </Button>
                        </div>
                    </div>
                </FocusModal.Body>
            </FocusModal.Content>
        </FocusModal>
    )
}

// ─── Main Page ─────────────────────────────────────────────────
const WhatsAppPage = () => {
    const [testOpen, setTestOpen] = useState(false)
    const navigate = useNavigate()

    return (
        <div className="flex flex-col gap-4">
            <Toaster />
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <ChatBubbleLeftRight />
                    <Heading level="h1">WhatsApp Business</Heading>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setTestOpen(true)}>
                        Send Message
                    </Button>
                    <DropdownMenu>
                        <DropdownMenu.Trigger asChild>
                            <IconButton variant="transparent">
                                <EllipsisHorizontal />
                            </IconButton>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content>
                            <DropdownMenu.Item onClick={() => navigate("/whatsapp/logs")}>
                                Message Logs
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu>
                </div>
            </div>
            <ConfigSection />
            <MappingsSection />
            <ManualSendModal open={testOpen} onOpenChange={setTestOpen} />
        </div>
    )
}

export const config = defineRouteConfig({
    label: "WhatsApp",
    icon: ChatBubbleLeftRight,
})

export default WhatsAppPage
