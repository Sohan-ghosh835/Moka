import { useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import "./Carousel.css";

export interface CarouselItemData {
  id: string | number;
  title: string;
  description: string;
  moodValue: number;
  imageSrc: string;
  badgeText: string;
}

interface CarouselProps {
  items: CarouselItemData[];
  baseWidth?: number;
  autoplay?: boolean;
  autoplayDelay?: number;
  pauseOnHover?: boolean;
  loop?: boolean;
  round?: boolean;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
}

const DRAG_BUFFER = 30;
const VELOCITY_THRESHOLD = 300;
const GAP = 16;
const SPRING_OPTIONS = { type: "spring" as const, stiffness: 300, damping: 30 };
const REPEATS = 9;

function CarouselItemCard({
  item,
  index,
  itemWidth,
  round,
  trackItemOffset,
  x,
  isActive,
}: {
  item: CarouselItemData;
  index: number;
  itemWidth: number;
  round?: boolean;
  trackItemOffset: number;
  x: any;
  isActive: boolean;
}) {
  const range = [
    -(index + 1) * trackItemOffset,
    -index * trackItemOffset,
    -(index - 1) * trackItemOffset,
  ];
  const outputRange = [35, 0, -35];
  const rotateY = useTransform(x, range, outputRange, { clamp: true });

  return (
    <motion.div
      key={`${item?.id ?? index}-${index}`}
      className={`carousel-item ${round ? "round" : ""} ${isActive ? "carousel-item-active" : ""}`}
      style={{
        width: itemWidth,
        height: round ? itemWidth : "100%",
        rotateY: rotateY,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        ...(round && { borderRadius: "50%" }),
      }}
    >
      <div className="relative w-full h-44 overflow-hidden rounded-t-xl bg-background/50 flex items-center justify-center p-3 select-none">
        <img
          src={item.imageSrc}
          alt={item.title}
          className="w-full h-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.6)] pointer-events-none"
        />
        <span className="absolute top-3 right-3 rounded-full bg-primary/40 px-2.5 py-0.5 font-mono text-[10px] font-bold text-primary-foreground backdrop-blur-md ring-1 ring-primary/50">
          {item.badgeText}
        </span>
      </div>
      <div className="p-4 flex flex-col justify-between flex-1 select-none">
        <div>
          <div className="font-display text-base font-bold text-foreground">
            {item.title}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {item.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function Carousel({
  items,
  baseWidth = 300,
  autoplay = false,
  autoplayDelay = 3000,
  pauseOnHover = false,
  loop = true,
  round = false,
  initialIndex = 0,
  onIndexChange,
}: CarouselProps) {
  const containerPadding = 16;
  const itemWidth = baseWidth - containerPadding * 2;
  const trackItemOffset = itemWidth + GAP;
  const N = items.length;
  const centerSetIndex = Math.floor(REPEATS / 2);

  const itemsForRender = useMemo(() => {
    if (!loop || N === 0) return items;
    const ribbon: CarouselItemData[] = [];
    for (let r = 0; r < REPEATS; r++) {
      ribbon.push(...items);
    }
    return ribbon;
  }, [items, loop, N]);

  const startPos = loop && N > 0 ? centerSetIndex * N + initialIndex : initialIndex;
  const [position, setPosition] = useState(startPos);

  // Initialize x directly to the starting position offset
  const x = useMotionValue(-startPos * trackItemOffset);

  // Dynamic perspective origin tracking x smoothly in real time
  const perspectiveOrigin = useTransform(
    x,
    (val) => `${-val + itemWidth / 2}px 50%`
  );

  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const animControlsRef = useRef<any>(null);

  const activeIndex = N === 0 ? 0 : ((position % N) + N) % N;

  const prevIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (prevIndexRef.current !== activeIndex) {
      prevIndexRef.current = activeIndex;
      onIndexChange?.(activeIndex);
    }
  }, [activeIndex, onIndexChange]);

  // Synchronize initialIndex changes from parent if initialIndex updates
  const prevInitialIndexRef = useRef(initialIndex);
  useEffect(() => {
    if (prevInitialIndexRef.current !== initialIndex) {
      prevInitialIndexRef.current = initialIndex;
      const newPos = loop && N > 0 ? centerSetIndex * N + initialIndex : initialIndex;
      setPosition(newPos);
      x.set(-newPos * trackItemOffset);
    }
  }, [initialIndex, loop, N, centerSetIndex, trackItemOffset, x]);

  const checkLoopReset = (currentPos: number) => {
    if (!loop || N === 0) return;
    const currentRealIndex = ((currentPos % N) + N) % N;
    const centerPos = centerSetIndex * N + currentRealIndex;
    if (currentPos !== centerPos) {
      x.set(-centerPos * trackItemOffset);
      setPosition(centerPos);
    }
  };

  const animateToPosition = (targetPos: number) => {
    if (animControlsRef.current) {
      animControlsRef.current.stop();
    }
    const targetX = -targetPos * trackItemOffset;
    setPosition(targetPos);
    animControlsRef.current = animate(x, targetX, {
      ...SPRING_OPTIONS,
      onComplete: () => {
        checkLoopReset(targetPos);
      },
    });
  };

  useEffect(() => {
    if (pauseOnHover && containerRef.current) {
      const container = containerRef.current;
      const handleMouseEnter = () => setIsHovered(true);
      const handleMouseLeave = () => setIsHovered(false);
      container.addEventListener("mouseenter", handleMouseEnter);
      container.addEventListener("mouseleave", handleMouseLeave);
      return () => {
        container.removeEventListener("mouseenter", handleMouseEnter);
        container.removeEventListener("mouseleave", handleMouseLeave);
      };
    }
  }, [pauseOnHover]);

  useEffect(() => {
    if (!autoplay || itemsForRender.length <= 1) return undefined;
    if (pauseOnHover && isHovered) return undefined;

    const timer = setInterval(() => {
      animateToPosition(position + 1);
    }, autoplayDelay);

    return () => clearInterval(timer);
  }, [autoplay, autoplayDelay, isHovered, pauseOnHover, itemsForRender.length, position]);

  const handleDragEnd = (_: any, info: { offset: { x: number }; velocity: { x: number } }) => {
    const { offset, velocity } = info;
    const direction =
      offset.x < -DRAG_BUFFER || velocity.x < -VELOCITY_THRESHOLD
        ? 1
        : offset.x > DRAG_BUFFER || velocity.x > VELOCITY_THRESHOLD
        ? -1
        : 0;

    const targetPos = position + direction;
    const max = itemsForRender.length - 1;
    const clampedPos = Math.max(0, Math.min(targetPos, max));

    animateToPosition(clampedPos);
  };

  return (
    <div
      ref={containerRef}
      className={`carousel-container ${round ? "round" : ""}`}
      style={{
        width: `${baseWidth}px`,
        ...(round && { height: `${baseWidth}px`, borderRadius: "50%" }),
      }}
    >
      <motion.div
        className="carousel-track"
        drag="x"
        initial={false}
        style={{
          width: itemWidth,
          gap: `${GAP}px`,
          perspective: 1000,
          perspectiveOrigin,
          x,
        }}
        onDragEnd={handleDragEnd}
      >
        {itemsForRender.map((item, index) => {
          const itemRealIndex = N === 0 ? 0 : ((index % N) + N) % N;
          return (
            <CarouselItemCard
              key={`${item?.id ?? index}-${index}`}
              item={item}
              index={index}
              itemWidth={itemWidth}
              round={round}
              trackItemOffset={trackItemOffset}
              x={x}
              isActive={itemRealIndex === activeIndex}
            />
          );
        })}
      </motion.div>
      <div className={`carousel-indicators-container ${round ? "round" : ""}`}>
        <div className="carousel-indicators">
          {items.map((item, index) => (
            <motion.button
              type="button"
              key={item.id}
              className={`carousel-indicator ${activeIndex === index ? "active" : "inactive"}`}
              aria-label={`Select ${item.title}`}
              aria-current={activeIndex === index}
              animate={{
                scale: activeIndex === index ? 1.3 : 1,
              }}
              onClick={() => {
                if (loop && N > 0) {
                  let diff = index - activeIndex;
                  if (diff > N / 2) diff -= N;
                  if (diff < -N / 2) diff += N;
                  animateToPosition(position + diff);
                } else {
                  animateToPosition(index);
                }
              }}
              transition={{ duration: 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

