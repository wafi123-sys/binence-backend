'use client';
export default function LoginModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return <div onClick={onClose}>Login</div>;
}
