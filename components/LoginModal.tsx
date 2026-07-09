'use client';

import { useState, useEffect } from 'react';
import { Shield, Lock, Eye, EyeOff, X, AlertCircle, Users, Loader2 } from 'lucide-react';
import { useMarket } from '../hooks/useMarket';
import { USER_ACCOUNTS } from '../lib/users';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { login, authError, isAuthenticated, connectionStatus } = useMarket();

  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  // Close modal on successful login
  useEffect(() => {
    if (isAuthenticated) {
      setIsLoading(false);
      onClose();
    }
  }, [isAuthenticated, onClose]);

  // Reset loading on auth error
  useEffect(() => {
    if (authError) {
      setIsLoading(false);
    }
  }, [authError]);

  if (!isOpen) return null;

  const handleLogin = () => {
    if (!username.trim() || !password.trim()) return;
    setIsLoading(true);
    login(username.trim(), password.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setShowAccounts(false);
  };

  const isConnected = connectionStatus === 'connected';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-overlay"
      onClick={onClose}
    >
      <div
        className="glass-card glow-primary w-full max-w-md p-8 relative animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-secondary hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-dim mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Order Book Arena</h2>
          <p className="text-sm text-text-secondary mt-2">
            Masukkan username dan password akun Anda
          </p>
        </div>

        {/* Connection Status */}
        {!isConnected && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400">
              {connectionStatus === 'reconnecting' ? 'Menghubungkan ke server...' : 'Server tidak terhubung.'}
            </p>
          </div>
        )}

        {/* Auth Error */}
        {authError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400">{authError}</p>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="masukkan username"
              autoComplete="username"
              className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder:text-text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="••••••••••••"
                autoComplete="current-password"
                className="w-full px-4 py-3 pr-11 bg-background border border-border rounded-lg text-foreground placeholder:text-text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-sm"
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            id="login-submit"
            onClick={handleLogin}
            disabled={isLoading || !isConnected || !username.trim() || !password.trim()}
            className="w-full py-3 gradient-primary rounded-lg text-sm font-semibold text-background hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Masuk...
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Masuk ke Arena
              </>
            )}
          </button>
        </div>

        {/* Quick Account Selector */}
        <div className="mt-5">
          <button
            onClick={() => setShowAccounts(!showAccounts)}
            className="w-full flex items-center justify-center gap-2 text-xs text-text-secondary hover:text-foreground transition-colors py-2"
          >
            <Users className="w-3.5 h-3.5" />
            {showAccounts ? 'Sembunyikan' : 'Lihat semua akun demo'}
          </button>

          {showAccounts && (
            <div className="mt-3 rounded-lg border border-border overflow-hidden max-h-56 overflow-y-auto">
              {USER_ACCOUNTS.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => handleQuickFill(acc.username, acc.password)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left border-b border-border/50 last:border-0"
                >
                  <span className="text-lg">{acc.avatar}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{acc.username}</p>
                    <p className="text-xs text-text-muted truncate">pass: {acc.password}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {acc.role === 'whale' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-medium">
                        🐳 Whale
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">
                        Rp {(acc.balance / 1_000_000).toFixed(0)}jt
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 text-center">
          <p className="text-xs text-text-muted">
            10 akun tersedia · Demo environment
          </p>
        </div>
      </div>
    </div>
  );
}
