declare const __BACKEND_URL__: string | undefined

import { ArrowLeftMini } from "@medusajs/icons"
import { Container, Heading, Button, Input, Table, Badge, Text, Toaster, IconButton, FocusModal } from "@medusajs/ui"
import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"

const BACKEND_URL = (__BACKEND_URL__ ?? "").replace(/\/+$/, "")
const PAGE_SIZE = 20

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

function parseErrorMessage(raw: string | null): string | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw)
        return parsed?.message || parsed?.error?.message || raw
    } catch {
        return raw
    }
}

function LogDetailsModal({ log, open, onOpenChange }: { log: any; open: boolean; onOpenChange: (v: boolean) => void }) {
    if (!log) return null
    return (
        <FocusModal open={open} onOpenChange={onOpenChange}>
            <FocusModal.Content>
                <FocusModal.Header>
                    <FocusModal.Title>Message Details</FocusModal.Title>
                </FocusModal.Header>
                <FocusModal.Body className="p-6 overflow-auto">
                    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
                        <div>
                            <Text weight="plus" className="mb-2">Request Payload</Text>
                            <pre className="bg-ui-bg-subtle rounded-lg p-4 text-xs overflow-auto whitespace-pre-wrap break-all">
                                {JSON.stringify(log.request_payload, null, 2)}
                            </pre>
                        </div>
                        <div>
                            <Text weight="plus" className="mb-2">Response Payload</Text>
                            <pre className="bg-ui-bg-subtle rounded-lg p-4 text-xs overflow-auto whitespace-pre-wrap break-all">
                                {JSON.stringify(log.response_payload, null, 2)}
                            </pre>
                        </div>
                        {log.wa_message_id && (
                            <div>
                                <Text weight="plus" className="mb-1">WhatsApp Message ID</Text>
                                <Text size="small" className="text-ui-fg-muted">{log.wa_message_id}</Text>
                            </div>
                        )}
                    </div>
                </FocusModal.Body>
            </FocusModal.Content>
        </FocusModal>
    )
}

const LogsPage = () => {
    const navigate = useNavigate()
    const [logs, setLogs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [count, setCount] = useState(0)
    const [offset, setOffset] = useState(0)
    const [search, setSearch] = useState("")
    const [searchInput, setSearchInput] = useState("")
    const [detailLog, setDetailLog] = useState<any>(null)
    const [detailOpen, setDetailOpen] = useState(false)

    const loadLogs = useCallback(async () => {
        setLoading(true)
        const params = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(offset),
        })
        if (search) params.set("q", search)
        const data = await api(`/logs?${params.toString()}`)
        setLogs(data.logs || [])
        setCount(data.count || 0)
        setLoading(false)
    }, [offset, search])

    useEffect(() => { loadLogs() }, [loadLogs])

    const handleSearch = () => {
        setOffset(0)
        setSearch(searchInput)
    }

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSearch()
    }

    const handleClearSearch = () => {
        setSearchInput("")
        setOffset(0)
        setSearch("")
    }

    const openDetails = (log: any) => {
        setDetailLog(log)
        setDetailOpen(true)
    }

    const totalPages = Math.ceil(count / PAGE_SIZE)
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1

    const statusColor = (status: string) => {
        switch (status) {
            case "sent": return "green"
            case "delivered": return "green"
            case "failed": return "red"
            default: return "grey"
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <Toaster />
            <LogDetailsModal log={detailLog} open={detailOpen} onOpenChange={setDetailOpen} />

            <div className="flex items-center gap-3">
                <IconButton variant="transparent" onClick={() => navigate("/whatsapp")}>
                    <ArrowLeftMini />
                </IconButton>
                <Heading level="h1">Message Logs</Heading>
            </div>

            <Container className="p-6">
                {/* Search Bar */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="flex-1">
                        <Input
                            id="log-search"
                            placeholder="Search by phone number..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                    </div>
                    <Button variant="secondary" onClick={handleSearch}>
                        Search
                    </Button>
                    {search && (
                        <Button variant="transparent" onClick={handleClearSearch}>
                            Clear
                        </Button>
                    )}
                    <Button variant="secondary" size="small" onClick={() => { setOffset(0); loadLogs() }}>
                        Refresh
                    </Button>
                </div>

                {search && (
                    <div className="mb-4">
                        <Text size="small" className="text-ui-fg-muted">
                            Showing results for: <strong>{search}</strong> ({count} total)
                        </Text>
                    </div>
                )}

                {/* Logs Table */}
                {loading ? (
                    <Text>Loading logs...</Text>
                ) : logs.length === 0 ? (
                    <Text className="text-ui-fg-muted">
                        {search ? "No logs found matching your search." : "No messages sent yet."}
                    </Text>
                ) : (
                    <>
                        <Table>
                            <Table.Header>
                                <Table.Row>
                                    <Table.HeaderCell>Event</Table.HeaderCell>
                                    <Table.HeaderCell>Template</Table.HeaderCell>
                                    <Table.HeaderCell>Recipient</Table.HeaderCell>
                                    <Table.HeaderCell>Status</Table.HeaderCell>
                                    <Table.HeaderCell>Time</Table.HeaderCell>
                                    <Table.HeaderCell>Response</Table.HeaderCell>
                                    <Table.HeaderCell className="text-right">Details</Table.HeaderCell>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {logs.map((log: any) => {
                                    const isManual = log.event_name === "test_message"
                                    const errorMsg = parseErrorMessage(log.error_message)
                                    return (
                                        <Table.Row key={log.id}>
                                            <Table.Cell>
                                                {isManual ? (
                                                    <Badge color="grey">Manual</Badge>
                                                ) : (
                                                    <Badge color="blue">{log.event_name}</Badge>
                                                )}
                                            </Table.Cell>
                                            <Table.Cell>{log.template_name}</Table.Cell>
                                            <Table.Cell>{log.recipient_phone}</Table.Cell>
                                            <Table.Cell>
                                                <Badge color={statusColor(log.status)}>
                                                    {log.status}
                                                </Badge>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Text size="small">
                                                    {new Date(log.created_at).toLocaleString()}
                                                </Text>
                                            </Table.Cell>
                                            <Table.Cell>
                                                {errorMsg && (
                                                    <Text size="small" className="text-ui-fg-error max-w-xs truncate">
                                                        {errorMsg}
                                                    </Text>
                                                )}
                                            </Table.Cell>
                                            <Table.Cell className="text-right">
                                                <Button
                                                    variant="secondary"
                                                    size="small"
                                                    onClick={() => openDetails(log)}
                                                >
                                                    View
                                                </Button>
                                            </Table.Cell>
                                        </Table.Row>
                                    )
                                })}
                            </Table.Body>
                        </Table>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-4">
                                <Text size="small" className="text-ui-fg-muted">
                                    Page {currentPage} of {totalPages} ({count} total logs)
                                </Text>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        disabled={offset === 0}
                                        onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                                    >
                                        Previous
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        disabled={offset + PAGE_SIZE >= count}
                                        onClick={() => setOffset(offset + PAGE_SIZE)}
                                    >
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </Container>
        </div>
    )
}

export default LogsPage
