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
    balance: 50_000_000,   // Rp 50 juta
    role: 'player',
    avatar: '🦊',
  },
  {
    id: 'player-002',
    username: 'budi_invest',
    password: 'budi456',
    balance: 75_000_000,   // Rp 75 juta
    role: 'player',
    avatar: '🐻',
  },
  {
    id: 'player-003',
    username: 'citra_saham',
    password: 'citra789',
    balance: 30_000_000,   // Rp 30 juta
    role: 'player',
    avatar: '🦋',
  },
  {
    id: 'player-004',
    username: 'deni_scalp',
    password: 'deni321',
    balance: 100_000_000,  // Rp 100 juta
    role: 'player',
    avatar: '🐺',
  },
  {
    id: 'player-005',
    username: 'eka_swing',
    password: 'eka654',
    balance: 45_000_000,   // Rp 45 juta
    role: 'player',
    avatar: '🦅',
  },
  {
    id: 'player-006',
    username: 'fajar_momentum',
    password: 'fajar987',
    balance: 60_000_000,   // Rp 60 juta
    role: 'player',
    avatar: '🐉',
  },
  {
    id: 'player-007',
    username: 'gita_value',
    password: 'gita111',
    balance: 25_000_000,   // Rp 25 juta
    role: 'player',
    avatar: '🦁',
  },
  {
    id: 'player-008',
    username: 'hendra_quant',
    password: 'hendra222',
    balance: 80_000_000,   // Rp 80 juta
    role: 'player',
    avatar: '🐯',
  },
  {
    id: 'player-009',
    username: 'indra_algo',
    password: 'indra333',
    balance: 55_000_000,   // Rp 55 juta
    role: 'player',
    avatar: '🦈',
  },

  // ── 1 Whale Account ───────────────────────────────────────
  {
    id: 'whale-001',
    username: 'sultan_market',
    password: 'sultan999',
    balance: 50_000_000_000,  // Rp 50 miliar 🐳
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
