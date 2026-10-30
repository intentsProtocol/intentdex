import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Plus, X, Users, Edit2, Check, Trash2, ChevronDown, ChevronUp } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface Recipient {
    id: string
    value: string
    type: "email" | "twitter" | "discord"
}

interface BulkRecipientInputProps {
    recipients: Recipient[]
    onChange: (recipients: Recipient[]) => void
    type: "email" | "twitter" | "discord"
    placeholder?: string
    error?: string
}

export function BulkRecipientInput({ recipients, onChange, type, placeholder, error }: BulkRecipientInputProps) {
    const [inputValue, setInputValue] = useState("")
    const [isOpen, setIsOpen] = useState(false)
    const [editId, setEditId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const handleAdd = () => {
        if (!inputValue.trim()) return

        // Basic validation/cleaning could go here
        const newRecipient: Recipient = {
            id: Math.random().toString(36).substr(2, 9),
            value: inputValue.trim(),
            type
        }

        onChange([...recipients, newRecipient])
        setInputValue("")
        inputRef.current?.focus()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            handleAdd()
        }
    }

    const handleRemove = (id: string) => {
        onChange(recipients.filter(r => r.id !== id))
    }

    const startEdit = (recipient: Recipient) => {
        setEditId(recipient.id)
        setEditValue(recipient.value)
    }

    const saveEdit = () => {
        if (!editId) return

        onChange(recipients.map(r =>
            r.id === editId ? { ...r, value: editValue } : r
        ))
        setEditId(null)
    }

    const cancelEdit = () => {
        setEditId(null)
    }

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        ref={inputRef}
                        placeholder={placeholder || `Enter ${type} address`}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={cn("pr-24", error && "border-red-500 focus-visible:ring-red-500")}
                    />
                    {/* Quick Action in Input */}
                    {recipients.length > 0 && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            <Popover open={isOpen} onOpenChange={setIsOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs bg-purple-500/20 text-purple-300 hover:bg-purple-500/30">
                                        <Users className="h-3 w-3 mr-1" />
                                        {recipients.length}
                                        {isOpen ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-0 bg-zinc-900 border-white/10 text-white z-50" align="end">
                                    <div className="p-3 bg-zinc-900/50 border-b border-white/10 flex justify-between items-center">
                                        <span className="font-medium text-sm">Recipient List</span>
                                        <span className="text-xs text-gray-400">{recipients.length} total</span>
                                    </div>
                                    <ScrollArea className="h-64">
                                        <div className="p-2 space-y-1">
                                            {recipients.map((recipient, i) => (
                                                <div key={recipient.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-white/5 group text-sm">
                                                    <span className="text-xs text-gray-500 w-4">{i + 1}.</span>

                                                    {editId === recipient.id ? (
                                                        <div className="flex-1 flex items-center gap-1">
                                                            <Input
                                                                value={editValue}
                                                                onChange={(e) => setEditValue(e.target.value)}
                                                                className="h-7 text-xs bg-black/50 border-white/20 text-white focus:ring-purple-500/50"
                                                                autoFocus
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') saveEdit()
                                                                    if (e.key === 'Escape') cancelEdit()
                                                                }}
                                                            />
                                                            <Button size="icon" variant="ghost" className="h-6 w-6 text-green-400 hover:text-green-300 hover:bg-green-400/20" onClick={saveEdit}>
                                                                <Check className="h-3 w-3" />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-400/20" onClick={cancelEdit}>
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <span className="flex-1 truncate text-gray-200">{recipient.value}</span>
                                                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                                                                <Button size="icon" variant="ghost" className="h-6 w-6 text-gray-500 hover:text-purple-400 hover:bg-purple-400/20" onClick={() => startEdit(recipient)}>
                                                                    <Edit2 className="h-3 w-3" />
                                                                </Button>
                                                                <Button size="icon" variant="ghost" className="h-6 w-6 text-gray-500 hover:text-red-400 hover:bg-red-400/20" onClick={() => handleRemove(recipient.id)}>
                                                                    <Trash2 className="h-3 w-3" />
                                                                </Button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                    <div className="p-2 border-t border-white/10 bg-zinc-900/50 flex justify-end">
                                        <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300 hover:bg-red-400/20 h-7" onClick={() => onChange([])}>
                                            Clear All
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}
                </div>
                <Button
                    type="button"
                    onClick={handleAdd}
                    disabled={!inputValue.trim()}
                    className="bg-purple-600 hover:bg-purple-700"
                >
                    <Plus className="h-4 w-4" />
                    <span className="sr-only">Add</span>
                </Button>
            </div>

            {/* Quick List Preview (Last 3) */}
            {recipients.length > 0 && !isOpen && (
                <div className="flex flex-wrap gap-2 text-xs">
                    {recipients.slice(-3).reverse().map((r) => (
                        <Badge key={r.id} variant="secondary" className="pl-2 pr-1 py-0.5 flex items-center gap-1 group">
                            <span className="max-w-[150px] truncate">{r.value}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 rounded-full p-0 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                onClick={() => handleRemove(r.id)}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    ))}
                    {recipients.length > 3 && (
                        <span className="text-xs text-gray-400 self-center">+{recipients.length - 3} more</span>
                    )}
                </div>
            )}
        </div>
    )
}
