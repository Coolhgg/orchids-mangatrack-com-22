"use client"

import { useState } from "react"
import { ShieldAlert, CheckCircle2, XCircle } from "lucide-react"

interface AgeVerificationModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function AgeVerificationModal({ isOpen, onConfirm, onCancel }: AgeVerificationModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="p-6 text-center space-y-6">
          <div className="mx-auto size-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <ShieldAlert className="size-8 text-red-600 dark:text-red-400" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-2xl font-black tracking-tight">Age Verification Required</h2>
            <p className="text-zinc-500 dark:text-zinc-400">
              You are attempting to enable Not Safe for Work (NSFW) content. You must be at least 18 years old to proceed.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 pt-2">
            <button
              onClick={onConfirm}
              className="w-full py-4 px-6 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="size-5" />
              I am 18+ years old
            </button>
            <button
              onClick={onCancel}
              className="w-full py-4 px-6 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
            >
              <XCircle className="size-5" />
              Cancel
            </button>
          </div>
          
          <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
            Legal Compliance Audit Requirement • 2026 Standards
          </p>
        </div>
      </div>
    </div>
  )
}
