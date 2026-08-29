// Support Tickets: the recovery route for a toy lock, dressed up as a support desk. Every ticket
// lives ONLY in this browser/app's own localStorage — nothing here is ever sent anywhere, because
// there is nowhere for it to go. See docs/toy-locks.md's "Support Tickets" section.
import { create } from 'zustand'

export type TicketStatus = 'open' | 'in-review' | 'resolved'

export interface SupportTicket {
  id: string
  number: string
  category: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical-but-not-really'
  status: TicketStatus
  createdAt: number
  resolvedAt?: number
}

const STORAGE_KEY = 'nodeterm.supportTickets'
const COUNTER_KEY = 'nodeterm.supportTickets.nextNumber'

function loadFromStorage(): SupportTicket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveToStorage(tickets: SupportTicket[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets))
  } catch {
    // Best-effort — a full/blocked localStorage should never crash the app over a fake ticket.
  }
}

function nextTicketNumber(): string {
  let n = 1001
  try {
    const raw = localStorage.getItem(COUNTER_KEY)
    if (raw) n = Math.max(1001, Number(raw) || 1001)
  } catch {
    // fall through with the default
  }
  try {
    localStorage.setItem(COUNTER_KEY, String(n + 1))
  } catch {
    // non-fatal
  }
  return `NT-${n}`
}

interface SupportTicketsState {
  tickets: SupportTicket[]
  create(category: string, description: string, severity: SupportTicket['severity']): SupportTicket
  advance(id: string): void
  remove(id: string): void
}

export const useSupportTickets = create<SupportTicketsState>((set, get) => ({
  tickets: loadFromStorage(),

  create(category, description, severity) {
    const ticket: SupportTicket = {
      id: crypto.randomUUID(),
      number: nextTicketNumber(),
      category,
      description,
      severity,
      status: 'open',
      createdAt: Date.now()
    }
    const tickets = [ticket, ...get().tickets]
    set({ tickets })
    saveToStorage(tickets)
    return ticket
  },

  advance(id) {
    const order: TicketStatus[] = ['open', 'in-review', 'resolved']
    const tickets = get().tickets.map((t) => {
      if (t.id !== id) return t
      const idx = order.indexOf(t.status)
      const status = order[Math.min(order.length - 1, idx + 1)]
      return { ...t, status, resolvedAt: status === 'resolved' ? Date.now() : t.resolvedAt }
    })
    set({ tickets })
    saveToStorage(tickets)
  },

  remove(id) {
    const tickets = get().tickets.filter((t) => t.id !== id)
    set({ tickets })
    saveToStorage(tickets)
  }
}))
