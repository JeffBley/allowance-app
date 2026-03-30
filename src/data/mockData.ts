export type KidId = 'jacob' | 'sarah' | 'kaitlyn'

export type AllowanceFrequency = 'Weekly' | 'Bi-weekly' | 'Monthly'

export interface KidSettings {
  allowanceEnabled: boolean
  allowanceAmount: number
  allowanceFrequency: AllowanceFrequency
  dayOfWeek: string   // e.g. 'Friday' — used for Weekly/Bi-weekly
  timeOfDay: string   // e.g. '09:00'
  timezone: string    // IANA, e.g. 'America/New_York'
}

export interface Transaction {
  id: string
  date: string // ISO date YYYY-MM-DD
  type: 'deposit' | 'withdrawal'
  amount: number
  notes: string
  tithingApplies: boolean | null // null for withdrawals
}

export interface Kid {
  id: KidId
  name: string
  balance: number
  tithingOwed: number
  lastTithingPaid: string
  allowanceAmount: number
  allowanceFrequency: string
  nextAllowanceDate: string
  transactions: Transaction[]
  settings: KidSettings
}

// ── Audit log ──────────────────────────────────────────────

export interface EditLogEntry {
  id: string
  action: 'edit'
  timestamp: string       // ISO datetime
  childId: KidId
  childName: string
  transactionId: string
  before: Transaction
  after: Transaction
  performedBy: string     // 'admin' or kid name
}

export interface DeleteLogEntry {
  id: string
  action: 'delete'
  timestamp: string
  childId: KidId
  childName: string
  transaction: Transaction
  performedBy: string
}

export type LogEntry = EditLogEntry | DeleteLogEntry

export const auditLog: LogEntry[] = [
  {
    id: 'log1',
    action: 'edit',
    timestamp: '2026-03-28T14:32:00',
    childId: 'jacob',
    childName: 'Jacob',
    transactionId: 'j2',
    performedBy: 'admin',
    before: { id: 'j2', date: '2026-03-01', type: 'withdrawal', amount: 10.00, notes: 'Pizza', tithingApplies: null },
    after:  { id: 'j2', date: '2026-03-01', type: 'withdrawal', amount: 12.50, notes: 'Pizza with friends', tithingApplies: null },
  },
  {
    id: 'log2',
    action: 'delete',
    timestamp: '2026-03-25T09:15:00',
    childId: 'sarah',
    childName: 'Sarah',
    performedBy: 'admin',
    transaction: { id: 's5', date: '2026-02-10', type: 'withdrawal', amount: 3.50, notes: 'Ice cream', tithingApplies: null },
  },
  {
    id: 'log3',
    action: 'edit',
    timestamp: '2026-03-20T16:05:00',
    childId: 'kaitlyn',
    childName: 'Kaitlyn',
    transactionId: 'k3',
    performedBy: 'admin',
    before: { id: 'k3', date: '2026-03-08', type: 'withdrawal', amount: 5.00, notes: 'Candy', tithingApplies: null },
    after:  { id: 'k3', date: '2026-03-08', type: 'withdrawal', amount: 5.00, notes: 'Candy at the store', tithingApplies: null },
  },
  {
    id: 'log4',
    action: 'delete',
    timestamp: '2026-02-18T11:44:00',
    childId: 'jacob',
    childName: 'Jacob',
    performedBy: 'admin',
    transaction: { id: 'j-old1', date: '2026-02-15', type: 'deposit', amount: 5.00, notes: 'Duplicate entry', tithingApplies: false },
  },
  {
    id: 'log5',
    action: 'edit',
    timestamp: '2026-02-10T08:20:00',
    childId: 'sarah',
    childName: 'Sarah',
    transactionId: 's3',
    performedBy: 'admin',
    before: { id: 's3', date: '2026-03-05', type: 'deposit', amount: 12.00, notes: 'Babysitting', tithingApplies: true },
    after:  { id: 's3', date: '2026-03-05', type: 'deposit', amount: 15.00, notes: 'Babysitting for the Johnsons', tithingApplies: true },
  },
]

const jacobTransactions: Transaction[] = [
  { id: 'j1',  date: '2026-03-15', type: 'deposit',    amount: 20.00, notes: 'Mowed lawns',                            tithingApplies: true  },
  { id: 'j2',  date: '2026-03-01', type: 'withdrawal', amount: 12.50, notes: 'Pizza with friends',                     tithingApplies: null  },
  { id: 'j3',  date: '2026-02-22', type: 'deposit',    amount: 10.00, notes: 'Allowance',                              tithingApplies: false },
  { id: 'j4',  date: '2026-02-14', type: 'deposit',    amount: 25.00, notes: "Valentine's birthday money from Grandma", tithingApplies: true  },
  { id: 'j5',  date: '2026-02-08', type: 'withdrawal', amount: 8.00,  notes: 'Movie ticket',                           tithingApplies: null  },
  { id: 'j6',  date: '2026-02-01', type: 'deposit',    amount: 10.00, notes: 'Allowance',                              tithingApplies: false },
  { id: 'j7',  date: '2026-01-25', type: 'withdrawal', amount: 5.50,  notes: 'Tithing payment',                        tithingApplies: null  },
  { id: 'j8',  date: '2026-01-20', type: 'withdrawal', amount: 15.00, notes: 'Video game',                             tithingApplies: null  },
  { id: 'j9',  date: '2026-01-15', type: 'deposit',    amount: 10.00, notes: 'Allowance',                              tithingApplies: false },
  { id: 'j10', date: '2026-01-10', type: 'deposit',    amount: 30.00, notes: 'Christmas money',                        tithingApplies: true  },
  { id: 'j11', date: '2026-01-01', type: 'deposit',    amount: 10.00, notes: 'Allowance',                              tithingApplies: false },
  { id: 'j12', date: '2025-12-25', type: 'deposit',    amount: 20.00, notes: 'Christmas gift from Aunt Sue',           tithingApplies: true  },
]

const sarahTransactions: Transaction[] = [
  { id: 's1', date: '2026-03-20', type: 'deposit',    amount: 5.00,  notes: 'Allowance',                         tithingApplies: false },
  { id: 's2', date: '2026-03-10', type: 'withdrawal', amount: 6.25,  notes: 'Craft supplies',                    tithingApplies: null  },
  { id: 's3', date: '2026-03-05', type: 'deposit',    amount: 15.00, notes: 'Babysitting for the Johnsons',      tithingApplies: true  },
  { id: 's4', date: '2026-02-20', type: 'deposit',    amount: 5.00,  notes: 'Allowance',                         tithingApplies: false },
  { id: 's5', date: '2026-02-10', type: 'withdrawal', amount: 3.50,  notes: 'Ice cream',                         tithingApplies: null  },
  { id: 's6', date: '2026-01-20', type: 'deposit',    amount: 5.00,  notes: 'Allowance',                         tithingApplies: false },
  { id: 's7', date: '2026-01-15', type: 'withdrawal', amount: 2.50,  notes: 'Tithing payment',                   tithingApplies: null  },
  { id: 's8', date: '2026-01-10', type: 'deposit',    amount: 20.00, notes: 'Christmas money',                   tithingApplies: true  },
]

const kaitlynTransactions: Transaction[] = [
  { id: 'k1', date: '2026-03-22', type: 'deposit',    amount: 8.00,  notes: 'Allowance',                         tithingApplies: false },
  { id: 'k2', date: '2026-03-15', type: 'deposit',    amount: 20.00, notes: 'Birthday money from Grandpa',       tithingApplies: true  },
  { id: 'k3', date: '2026-03-08', type: 'withdrawal', amount: 5.00,  notes: 'Candy at the store',                tithingApplies: null  },
  { id: 'k4', date: '2026-02-22', type: 'deposit',    amount: 8.00,  notes: 'Allowance',                         tithingApplies: false },
  { id: 'k5', date: '2026-02-10', type: 'withdrawal', amount: 4.00,  notes: 'Stickers and notebook',             tithingApplies: null  },
  { id: 'k6', date: '2026-01-22', type: 'deposit',    amount: 8.00,  notes: 'Allowance',                         tithingApplies: false },
  { id: 'k7', date: '2026-01-12', type: 'withdrawal', amount: 4.00,  notes: 'Tithing payment',                   tithingApplies: null  },
  { id: 'k8', date: '2026-01-05', type: 'deposit',    amount: 25.00, notes: 'Christmas money',                   tithingApplies: true  },
]

export const kidsData: Record<KidId, Kid> = {
  jacob: {
    id: 'jacob',
    name: 'Jacob',
    balance: 47.50,
    tithingOwed: 12.00,
    lastTithingPaid: '2026-01-25',
    allowanceAmount: 10.00,
    allowanceFrequency: 'Monthly',
    nextAllowanceDate: '2026-04-01',
    transactions: jacobTransactions,
    settings: {
      allowanceEnabled: true,
      allowanceAmount: 10,
      allowanceFrequency: 'Monthly',
      dayOfWeek: 'Friday',
      timeOfDay: '09:00',
      timezone: 'America/New_York',
    },
  },
  sarah: {
    id: 'sarah',
    name: 'Sarah',
    balance: 23.75,
    tithingOwed: 5.50,
    lastTithingPaid: '2026-01-15',
    allowanceAmount: 5.00,
    allowanceFrequency: 'Monthly',
    nextAllowanceDate: '2026-04-20',
    transactions: sarahTransactions,
    settings: {
      allowanceEnabled: true,
      allowanceAmount: 5,
      allowanceFrequency: 'Monthly',
      dayOfWeek: 'Friday',
      timeOfDay: '09:00',
      timezone: 'America/New_York',
    },
  },
  kaitlyn: {
    id: 'kaitlyn',
    name: 'Kaitlyn',
    balance: 31.00,
    tithingOwed: 8.00,
    lastTithingPaid: '2026-01-12',
    allowanceAmount: 8.00,
    allowanceFrequency: 'Monthly',
    nextAllowanceDate: '2026-04-22',
    transactions: kaitlynTransactions,
    settings: {
      allowanceEnabled: true,
      allowanceAmount: 8,
      allowanceFrequency: 'Monthly',
      dayOfWeek: 'Friday',
      timeOfDay: '09:00',
      timezone: 'America/New_York',
    },
  },
}
