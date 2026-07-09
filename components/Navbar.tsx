'use client';

import { useState } from 'react';
import { Activity, Shield, Menu, X } from 'lucide-react';
import LoginModal from './LoginModal';

export default function Navbar() {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass-card-sm !rounded-none border-t-0 border-l-0 border-r-0">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Activity className="w-7 h-7 text-primary" />
                <div className="absolute inset-0 blur-md bg-primary/30 rounded-full" />
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-foreground">
                  STARFALL
                </span>
                <span className="text-lg font-light tracking-tight text-primary ml-1">
                  CAPITAL
                </span>
              </div>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#overview" className="text-sm text-text-secondary hover:text-primary transition-colors duration-300">
                Overview
              </a>
              <a href="#portfolio" className="text-sm text-text-secondary hover:text-primary transition-colors duration-300">
                Portfolio
              </a>
              <a href="#markets" className="text-sm text-text-secondary hover:text-primary transition-colors duration-300">
                Markets
              </a>
              <a href="#team" className="text-sm text-text-secondary hover:text-primary transition-colors duration-300">
                Team
              </a>
            </div>

            {/* Login Button */}
            <div className="hidden md:flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-success">
                <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-glow" />
                LIVE
              </div>
              <button
                onClick={() => setIsLoginOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground glass-card-sm hover:border-primary/30 transition-all duration-300 cursor-pointer group"
              >
                <Shield className="w-4 h-4 text-primary group-hover:text-primary" />
                Investor Portal
              </button>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden text-text-secondary hover:text-primary transition-colors"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-border px-4 py-4 space-y-3">
            <a href="#overview" className="block text-sm text-text-secondary hover:text-primary transition-colors">Overview</a>
            <a href="#portfolio" className="block text-sm text-text-secondary hover:text-primary transition-colors">Portfolio</a>
            <a href="#markets" className="block text-sm text-text-secondary hover:text-primary transition-colors">Markets</a>
            <a href="#team" className="block text-sm text-text-secondary hover:text-primary transition-colors">Team</a>
            <button
              onClick={() => { setIsLoginOpen(true); setIsMobileMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground glass-card-sm w-full"
            >
              <Shield className="w-4 h-4 text-primary" />
              Investor Portal
            </button>
          </div>
        )}
      </nav>

      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </>
  );
}
