'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import * as DismissableLayerPrimitive from '@radix-ui/react-dismissable-layer'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption {
  label: string
  value: string | number
  group?: string
}

export interface SelectGroup {
  label: string
  options: SelectOption[]
}

export interface BaseSelectProps {
  value: string | number
  onValueChange: (value: string | number) => void
  options: SelectOption[] | SelectGroup[]
  placeholder?: string
  searchable?: boolean
  className?: string
}

type DropdownPosition = {
  left: number
  maxHeight: number
  portalContainer: HTMLElement
  position: 'absolute' | 'fixed'
  top: number
  width: number
}

export function BaseSelect({
  value,
  onValueChange,
  options,
  placeholder = '请选择...',
  searchable = true,
  className,
}: BaseSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null)

  // Normalize groups
  const normalizedGroups = useMemo(() => {
    if (!options.length) return []
    const first = options[0] as SelectGroup
    if ('options' in first && Array.isArray(first.options)) {
      return (options as SelectGroup[]).map(g => ({
        label: g.label || '',
        options: g.options.map(o => ({ label: o.label ?? String(o.value), value: o.value })),
      }))
    }
    const map = new Map<string, SelectOption[]>()
    for (const o of options as SelectOption[]) {
      const key = o.group || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ label: o.label ?? String(o.value), value: o.value })
    }
    return Array.from(map.entries()).map(([label, opts]) => ({ label, options: opts }))
  }, [options])

  // Filter
  const filteredGroups = useMemo(() => {
    if (!search) return normalizedGroups
    const q = search.toLowerCase()
    return normalizedGroups
      .map(g => ({
        label: g.label,
        options: g.options.filter(o => o.label.toLowerCase().includes(q)),
      }))
      .filter(g => g.options.length > 0)
  }, [normalizedGroups, search])

  const flatOptions = useMemo(() => filteredGroups.flatMap(g => g.options), [filteredGroups])

  const selectedLabel = useMemo(() => {
    for (const g of normalizedGroups) {
      const found = g.options.find(o => o.value === value)
      if (found) return found.label
    }
    return ''
  }, [normalizedGroups, value])

  const handleOpen = useCallback(() => {
    setOpen(true)
    setHighlightedIdx(flatOptions.findIndex(o => o.value === value))
    setSearch('')
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [flatOptions, value])

  const handlePick = useCallback((val: string | number) => {
    onValueChange(val)
    setOpen(false)
  }, [onValueChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIdx(i => Math.min(i + 1, flatOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIdx >= 0 && flatOptions[highlightedIdx]) {
        handlePick(flatOptions[highlightedIdx].value)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }, [flatOptions, highlightedIdx, handlePick])

  // Close on click outside
  useEffect(() => {
    if (!open) return

    const updateDropdownPosition = () => {
      if (!rootRef.current) return

      const rect = rootRef.current.getBoundingClientRect()
      const dialogContent = rootRef.current.closest<HTMLElement>('[data-slot="dialog-content"]')

      if (dialogContent) {
        const containerRect = dialogContent.getBoundingClientRect()
        const spaceBelow = containerRect.bottom - rect.bottom - 12
        const spaceAbove = rect.top - containerRect.top - 12
        const shouldOpenUpward = spaceBelow < 240 && spaceAbove > spaceBelow
        const maxHeight = Math.max(160, Math.min(320, shouldOpenUpward ? spaceAbove : spaceBelow))
        const top = shouldOpenUpward
          ? Math.max(8, rect.top - containerRect.top - maxHeight - 4)
          : Math.max(8, Math.min(containerRect.height - maxHeight - 8, rect.bottom - containerRect.top + 4))

        setDropdownPosition({
          left: Math.max(0, rect.left - containerRect.left),
          top,
          width: rect.width,
          maxHeight,
          position: 'absolute',
          portalContainer: dialogContent,
        })
        return
      }

      const viewportHeight = window.innerHeight
      const spaceBelow = viewportHeight - rect.bottom - 12
      const spaceAbove = rect.top - 12
      const shouldOpenUpward = spaceBelow < 240 && spaceAbove > spaceBelow
      const maxHeight = Math.max(160, Math.min(320, shouldOpenUpward ? spaceAbove : spaceBelow))
      const top = shouldOpenUpward
        ? Math.max(8, rect.top - maxHeight - 4)
        : Math.max(8, Math.min(viewportHeight - maxHeight - 8, rect.bottom + 4))

      setDropdownPosition({
        left: rect.left,
        top,
        width: rect.width,
        maxHeight,
        position: 'fixed',
        portalContainer: document.body,
      })
    }

    updateDropdownPosition()

    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setOpen(false)
      }
    }

    const handleViewportChange = () => updateDropdownPosition()

    document.addEventListener('mousedown', handler)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open])

  // Scroll highlighted into view
  useEffect(() => {
    if (highlightedIdx < 0 || !optionsRef.current) return
    const el = optionsRef.current.querySelector<HTMLElement>(`[data-option-index="${highlightedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIdx])

  return (
    <div ref={rootRef} className={cn('relative inline-flex w-full min-w-0', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleOpen}
        className={cn(
          'inline-flex items-center justify-between gap-1.5 px-2.5 py-[7px] text-xs',
          'bg-bg-input border border-border rounded-[8px] cursor-pointer',
          'transition-all duration-150 w-full whitespace-nowrap min-w-0 flex-shrink-0',
          'hover:border-border-strong hover:bg-bg-0',
          open && 'border-border-focus ring-[3px] ring-accent/20 bg-bg-0',
        )}
      >
        <span className={cn(
          'overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 text-left',
          selectedLabel ? 'text-text-0' : 'text-text-3 font-light',
        )}>
          {selectedLabel || placeholder}
        </span>
        <ChevronsUpDown
          size={13}
          className={cn(
            'ml-auto text-text-2 flex-shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown */}
      {open && dropdownPosition && typeof document !== 'undefined'
        ? createPortal(
            <DismissableLayerPrimitive.Branch
              ref={dropdownRef}
              data-dialog-allow-outside-interaction=""
              className={cn(
                'fixed z-[60] overflow-hidden rounded-[14px] border border-border bg-bg-0 shadow-shadow-lg',
                'animate-[baseSelectIn_0.15s_cubic-bezier(0.16,1,0.3,1)]',
              )}
              style={{
                left: dropdownPosition.left,
                top: dropdownPosition.top,
                width: dropdownPosition.width,
                position: dropdownPosition.position,
              }}
            >
              {/* Search */}
              {searchable && (
                <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-text-2">
                  <Search size={12} />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 border-none bg-transparent text-[13px] font-body text-text-0 outline-none placeholder:text-text-3"
                    placeholder="搜索..."
                  />
                </div>
              )}

              {/* Options */}
              <div
                ref={optionsRef}
                className="overflow-y-auto p-1"
                style={{ maxHeight: dropdownPosition.maxHeight }}
              >
                {flatOptions.length > 0 ? (
                  filteredGroups.map((group, gi) => (
                    <div key={gi}>
                      {group.label && (
                        <div className="mt-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-3 first:mt-0">
                          {group.label}
                        </div>
                      )}
                      {group.options.map(opt => {
                        const isSelected = opt.value === value
                        const globalIdx = flatOptions.indexOf(opt)
                        const isHighlighted = globalIdx === highlightedIdx
                        return (
                          <button
                            key={String(opt.value)}
                            type="button"
                            data-option-index={globalIdx}
                            className={cn(
                              'block w-full rounded-[4px] border-none bg-transparent px-2.5 py-[7px] text-left text-[13px] font-body',
                              'cursor-pointer break-all transition-colors duration-100',
                              isSelected ? 'bg-accent-bg font-semibold text-accent-dark' : 'text-text-1',
                              isHighlighted && !isSelected && 'bg-bg-hover text-text-0',
                            )}
                            onClick={() => handlePick(opt.value)}
                            onMouseMove={() => setHighlightedIdx(globalIdx)}
                          >
                            <span className="flex items-center gap-2">
                              {opt.label}
                              {isSelected && <Check size={12} className="ml-auto text-accent" />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-[13px] text-text-3">无匹配结果</div>
                )}
              </div>
            </DismissableLayerPrimitive.Branch>,
            dropdownPosition.portalContainer,
          )
        : null}
    </div>
  )
}
