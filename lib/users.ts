// ============================================================
// Order Book Arena — Pre-defined User Accounts
// 9 regular players + 1 whale account
// ============================================================

export interface UserAccount {
  id: string;       // unique user ID (used as playerId in engine)
  username: string; // display name / login name
  password: string; // plain text (demo only — no real auth needed)
  balance: number;  // starting cash balance in IDR
  role: 'player' | 'whale';
  avatar: string;   // emoji avatar
}

export const USER_ACCOUNTS: UserAccount[] = [
  // ── 9 Regular Players ────────────────────────────────────
  {
    id: 'player-001',
    username: 'andi_trade',
    password: 'andi123',
    balance: 500_000_000,   // Rp 500 juta
    role: 'player',
    avatar: '🦊',
  },
  {
    id: 'player-002',
    username: 'budi_invest',
    password: 'budi456',
    balance: 750_000_000,   // Rp 750 juta
    role: 'player',
    avatar: '🐻',
  },
  {
    id: 'player-003',
    username: 'citra_saham',
    password: 'citra789',
    balance: 300_000_000,   // Rp 300 juta
    role: 'player',
    avatar: '🦋',
  },
  {
    id: 'player-004',
    username: 'deni_scalp',
    password: 'deni321',
    balance: 1_000_000_000,  // Rp 1 miliar
    role: 'player',
    avatar: '🐺',
  },
  {
    id: 'player-005',
    username: 'eka_swing',
    password: 'eka654',
    balance: 450_000_000,   // Rp 450 juta
    role: 'player',
    avatar: '🦅',
  },
  {
    id: 'player-006',
    username: 'fajar_momentum',
    password: 'fajar987',
    balance: 600_000_000,   // Rp 600 juta
    role: 'player',
    avatar: '🐉',
  },
  {
    id: 'player-007',
    username: 'gita_value',
    password: 'gita111',
    balance: 250_000_000,   // Rp 250 juta
    role: 'player',
    avatar: '🦁',
  },
  {
    id: 'player-008',
    username: 'hendra_quant',
    password: 'hendra222',
    balance: 800_000_000,   // Rp 800 juta
    role: 'player',
    avatar: '🐯',
  },
  {
    id: 'player-009',
    username: 'indra_algo',
    password: 'indra333',
    balance: 550_000_000,   // Rp 550 juta
    role: 'player',
    avatar: '🦈',
  },

  // ── 1 Whale Account ───────────────────────────────────────
  {
    id: 'whale-001',
    username: 'sultan_market',
    password: 'sultan999',
    balance: 500_000_000_000,  // Rp 500 miliar 🐳
    role: 'whale',
    avatar: '🐳',
  },
];

// ── Auth Helper Functions ────────────────────────────────────

/**
 * Authenticate a user by username + password.
 * Returns the UserAccount if valid, null otherwise.
 */
export function authenticateUser(
  username: string,
  password: string
): UserAccount | null {
  const user = USER_ACCOUNTS.find(
    (u) => u.username === username && u.password === password
  );
  return user ?? null;
}

/**
 * Get a user by their ID.
 */
export function getUserById(id: string): UserAccount | null {
  return USER_ACCOUNTS.find((u) => u.id === id) ?? null;
}

/**
 * Format balance as Rupiah string.
 */
export function formatRupiah(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(1)} M`;
  }
  if (amount >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(0)} jt`;
  }
  return `Rp ${amount.toLocaleString('id-ID')}`;
}
