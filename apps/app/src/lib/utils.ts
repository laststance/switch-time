import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// `text-display` (the elapsed-time hero) is a font size; stock tailwind-merge reads an unknown `text-*` as a colour and would drop it.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['display'] }] } },
})

/**
 * Merges class lists the shadcn / React Native Reusables way: later classes win on conflicts.
 * @example cn('bg-surface', active && 'bg-accent') // 'bg-accent' when active
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
