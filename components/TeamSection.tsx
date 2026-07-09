'use client';

import { Users, ExternalLink, Mail } from 'lucide-react';

interface TeamMember {
  name: string;
  title: string;
  bio: string;
  initials: string;
  gradientFrom: string;
  gradientTo: string;
}

const team: TeamMember[] = [
  {
    name: 'Alexander Hartono',
    title: 'Chief Investment Officer',
    bio: 'Former Head of Quantitative Strategies at Goldman Sachs Asia. PhD in Financial Engineering from MIT. 15+ years managing $5B+ in systematic strategies.',
    initials: 'AH',
    gradientFrom: '#00e5ff',
    gradientTo: '#7c4dff',
  },
  {
    name: 'Sarah Chen Wei',
    title: 'Head of Research',
    bio: 'Ex-Citadel senior researcher specializing in alternative data and NLP-driven alpha signals. MS in Computer Science from Stanford. Published 20+ papers in quantitative finance.',
    initials: 'SC',
    gradientFrom: '#7c4dff',
    gradientTo: '#ff6d00',
  },
  {
    name: 'Michael Prasetyo',
    title: 'Chief Risk Officer',
    bio: 'Previously VP of Risk at JP Morgan Jakarta desk. MBA from Wharton. Designed risk frameworks for $10B+ multi-strategy portfolios across emerging markets.',
    initials: 'MP',
    gradientFrom: '#00e676',
    gradientTo: '#00e5ff',
  },
  {
    name: 'Diana Kusuma',
    title: 'Head of Technology',
    bio: 'Former engineering lead at Two Sigma and Binance. Built low-latency trading systems processing 1M+ orders/second. BS in CS from Carnegie Mellon.',
    initials: 'DK',
    gradientFrom: '#ff6d00',
    gradientTo: '#ff1744',
  },
];

export default function TeamSection() {
  return (
    <div id="team" className="glass-card p-6 sm:p-8">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-primary" />
        <p className="text-xs font-medium text-primary uppercase tracking-[0.2em]">
          Leadership
        </p>
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2">Executive Team</h2>
      <p className="text-sm text-text-secondary mb-8">
        World-class talent from the most prestigious financial institutions and technology companies.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {team.map((member) => (
          <div
            key={member.name}
            className="group p-5 rounded-xl bg-background/30 border border-border hover:border-primary/20 transition-all duration-500 hover:-translate-y-1"
          >
            {/* Avatar */}
            <div className="mb-4 flex justify-center">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-xl font-bold text-background relative overflow-hidden group-hover:scale-105 transition-transform duration-300"
                style={{
                  background: `linear-gradient(135deg, ${member.gradientFrom}, ${member.gradientTo})`,
                }}
              >
                {member.initials}
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-all duration-300" />
              </div>
            </div>

            {/* Info */}
            <div className="text-center">
              <h3 className="text-sm font-semibold text-foreground mb-1">{member.name}</h3>
              <p className="text-xs text-primary font-medium mb-3">{member.title}</p>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">{member.bio}</p>

              {/* Social links */}
              <div className="flex justify-center gap-3">
                <button className="p-1.5 rounded-lg bg-border hover:bg-primary-dim hover:text-primary transition-all duration-300 text-text-secondary">
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 rounded-lg bg-border hover:bg-primary-dim hover:text-primary transition-all duration-300 text-text-secondary">
                  <Mail className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
