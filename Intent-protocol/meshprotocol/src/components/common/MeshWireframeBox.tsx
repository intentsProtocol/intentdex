import React from 'react';
import { cn } from '@/lib/utils';

export function CornerCrosshair({ className }: { className?: string }) {
  return (
    <svg
      className={cn(
        "rounded-full size-6 stroke-neutral-400 bg-[#F4F4F5] dark:bg-[#18181b] dark:stroke-neutral-500 absolute z-20 pointer-events-none transition-colors",
        className
      )}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 28 28"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 14h14" />
      <path d="M14 7v14" />
    </svg>
  );
}

interface WireframeSectionProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  id?: string;
}

export function WireframeSection({
  children,
  className,
  innerClassName,
  id,
}: WireframeSectionProps) {
  return (
    <section id={id} className={cn("border-b border-[#c0c2c4] dark:border-neutral-800 px-4 sm:px-6 relative", className)}>
      <div className={cn("border-x border-[#c0c2c4] dark:border-neutral-800 relative max-w-7xl mx-auto p-6 sm:p-10 md:p-12", innerClassName)}>
        <CornerCrosshair className="-left-3 -top-3" />
        <CornerCrosshair className="-right-3 -top-3" />
        <CornerCrosshair className="-left-3 -bottom-3" />
        <CornerCrosshair className="-right-3 -bottom-3" />
        {children}
      </div>
    </section>
  );
}
