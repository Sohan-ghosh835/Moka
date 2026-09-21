import { Activity, CheckSquare, CircleUserRound, Heart } from "lucide-react";

export type NavTab = "Mood" | "Track" | "Profile" | "Todo";

const items: { label: NavTab; icon: typeof Heart }[] = [
  { label: "Mood", icon: Heart },
  { label: "Track", icon: Activity },
  { label: "Profile", icon: CircleUserRound },
  { label: "Todo", icon: CheckSquare },
];

export function BottomBar({
  active,
  setActive,
}: {
  active: NavTab;
  setActive: (tab: NavTab) => void;
}) {
  const activeIndex = items.findIndex((item) => item.label === active);

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="relative mx-auto grid h-[76px] w-full max-w-[520px] grid-cols-5 items-center rounded-[2.25rem] border border-white/[0.08] bg-[#1e1019]/80 px-1 text-[#f5e8e8] shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 left-1 w-[calc((100%-0.5rem)/5)] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(74,32,56,0.96)_0%,rgba(74,32,56,0.78)_54%,rgba(74,32,56,0.32)_78%,transparent_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(150,61,108,0.12)] transition-transform duration-500 ease-out"
          style={{ transform: `translateX(${activeIndex >= 2 ? (activeIndex + 1) * 100 : activeIndex * 100}%)` }}
        />

        {items.slice(0, 2).map((item) => (
          <BarButton
            key={item.label}
            {...item}
            active={active === item.label}
            onClick={() => setActive(item.label)}
          />
        ))}

        <div
          aria-hidden="true"
          className="relative z-10 mx-auto flex size-[58px] items-center justify-center rounded-full border border-[#963d6c]/35 bg-[#2a1722]/90 shadow-[0_0_24px_rgba(150,61,108,0.22),inset_0_1px_0_rgba(255,255,255,0.1)]"
        >
          <span className="absolute inset-1 rounded-full bg-[radial-gradient(circle_at_50%_35%,rgba(150,61,108,0.58),rgba(74,32,56,0.16)_68%,transparent)]" />
          <img src="./lotus.png" alt="Lotus Emblem" className="relative size-8 object-contain invert opacity-90" />
        </div>

        {items.slice(2).map((item) => (
          <BarButton
            key={item.label}
            {...item}
            active={active === item.label}
            onClick={() => setActive(item.label)}
          />
        ))}
      </div>
    </nav>
  );
}

function BarButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: NavTab;
  icon: typeof Heart;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`relative z-10 flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d58aae] ${
        active ? "text-[#f5e8e8] font-semibold" : "text-[#9e8a95] hover:text-[#e0c4d4]"
      }`}
    >
      <Icon aria-hidden="true" className="size-5" strokeWidth={active ? 2.2 : 1.8} />
      <span>{label}</span>
    </button>
  );
}
