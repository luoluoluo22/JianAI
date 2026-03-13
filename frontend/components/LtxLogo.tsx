interface LtxLogoProps {
  className?: string
}

export function LtxLogo({ className = "h-6" }: LtxLogoProps) {
  return (
    <div className={`${className} inline-flex items-center gap-2 text-white`}>
      <div className="flex h-full aspect-square items-center justify-center rounded-md bg-white/10 px-2 text-[0.72em] font-black tracking-wider text-white">
        剪
      </div>
      <span className="text-[0.95em] font-black tracking-[0.18em] leading-none">JianAI</span>
    </div>
  )
}
