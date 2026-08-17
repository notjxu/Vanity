import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ShoppingBag, Menu, X, Plus, Minus, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Motion system — applying a handful of concrete rules from the referenced
// design-intelligence skill's GSAP/motion catalog, reimplemented in plain
// CSS + IntersectionObserver (no GSAP dependency available in this runtime):
//   spring-physics        → cubic-bezier(0.16,1,0.3,1) ("easeOutExpo"-ish,
//                            no linear/default-ease anywhere)
//   stagger-sequence       → grid/list items reveal 40ms apart, not at once
//   exit-faster-than-enter → drawers close in ~65% of their open duration
//   scale-feedback         → 0.95 press-scale on every tappable control
//   parallax-subtle        → hero backdrop only, disabled under reduced motion
//   interruptible /
//   no-blocking-animation  → everything is a declarative CSS transition on
//                            state, so re-toggling mid-animation just retargets
//                            it — nothing is a blocking JS-driven sequence
//   reduced-motion         → respected globally, not just on one component
// ---------------------------------------------------------------------------

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap');
.font-display { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; }
.font-body { font-family: 'Inter', sans-serif; }

html { scroll-behavior: smooth; }

.reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 600ms cubic-bezier(0.16,1,0.3,1), transform 600ms cubic-bezier(0.16,1,0.3,1);
}
.reveal.in { opacity: 1; transform: translateY(0); }

@keyframes rise {
  from { opacity: 0; transform: translateY(22px); }
  to { opacity: 1; transform: translateY(0); }
}
.hero-rise { animation: rise 800ms cubic-bezier(0.16,1,0.3,1) both; }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// Reveals an element once it scrolls into view; stagger via `delayMs`.
function useReveal(delayMs = 0) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reducedMotion]);

  return {
    ref,
    className: `reveal ${inView ? "in" : ""}`,
    style: { transitionDelay: inView ? `${delayMs}ms` : "0ms" },
  };
}

// Subtle vertical parallax on scroll — hero backdrop only, capped, and fully
// disabled under reduced motion rather than just slowed down.
function useParallax(factor = 0.15) {
  const ref = useRef(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    let raf = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        if (ref.current) {
          const offset = Math.min(window.scrollY * factor, 120);
          ref.current.style.transform = `translate3d(0, ${offset}px, 0)`;
        }
        raf = null;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [factor, reducedMotion]);

  return ref;
}

const PRODUCTS = [
  {
    id: "p1",
    name: "Requiem Compression Tee",
    price: 18.5,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Onyx"],
    blurb: "4-way stretch, flatlock seams, engraved-print back panel.",
  },
  {
    id: "p2",
    name: "Wraith Long Sleeve",
    price: 22.0,
    sizes: ["S", "M", "L", "XL", "XXL"],
    colors: ["Onyx"],
    blurb: "Thermo-regulating compression knit for cold sessions.",
  },
  {
    id: "p3",
    name: "Thorn Compression Tee",
    price: 18.5,
    sizes: ["XS", "S", "M", "L"],
    colors: ["Onyx"],
    blurb: "Our lightest weave — built for high-rep training days.",
  },
  {
    id: "p4",
    name: "Sable Half-Zip",
    price: 27.0,
    sizes: ["S", "M", "L", "XL"],
    colors: ["Onyx"],
    blurb: "Layer piece. Compression base with a structured half-zip shell.",
  },
];

// Abstract thorn/vein linework — an original decorative motif, not a copy of
// any specific artwork. Used as the "hidden until it catches light" signature.
function ThornPattern({ id, className }) {
  return (
    <svg viewBox="0 0 200 260" className={className} preserveAspectRatio="xMidYMid slice">
      <defs>
        <g id={`branch-${id}`}>
          <path d="M100 10 C 95 60, 110 90, 90 140 S 115 200, 100 250" fill="none" strokeWidth="1.2" />
          <path d="M100 40 L 70 55 M100 40 L 130 50" fill="none" strokeWidth="1" />
          <path d="M92 90 L 60 80 M92 90 L 65 105" fill="none" strokeWidth="1" />
          <path d="M108 130 L 140 120 M108 130 L 145 145" fill="none" strokeWidth="1" />
          <path d="M92 175 L 58 165 M92 175 L 62 195" fill="none" strokeWidth="1" />
          <path d="M100 215 L 130 205 M100 215 L 128 235" fill="none" strokeWidth="1" />
        </g>
      </defs>
      <use href={`#branch-${id}`} stroke="currentColor" transform="translate(-15,0) rotate(-3 100 130)" />
      <use href={`#branch-${id}`} stroke="currentColor" transform="translate(15,0) scale(0.85) rotate(4 100 130)" opacity="0.6" />
    </svg>
  );
}

function ProductCard({ product, index, onSelect }) {
  const reveal = useReveal(index * 40); // stagger-sequence: 40ms per item
  return (
    <button
      ref={reveal.ref}
      className={`${reveal.className} group text-left w-full focus:outline-none active:scale-[0.98] transition-transform`}
      style={reveal.style}
      onClick={() => onSelect(product)}
    >
      <div className="relative aspect-[3/4] bg-neutral-900 border border-neutral-800 overflow-hidden group-focus-visible:ring-2 group-focus-visible:ring-white">
        {/* base (resting) layer — faint, low-contrast */}
        <ThornPattern
          id={product.id}
          className="absolute inset-0 w-full h-full text-neutral-700 opacity-40 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none group-hover:opacity-0 scale-100"
        />
        {/* resolved layer — sharp, revealed on hover/focus */}
        <ThornPattern
          id={`${product.id}-hi`}
          className="absolute inset-0 w-full h-full text-white opacity-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none group-hover:opacity-100 group-hover:scale-[1.04] group-focus-visible:opacity-100 scale-100"
        />
        <div className="absolute inset-x-0 bottom-0 p-3 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent">
          <span className="font-body text-[11px] tracking-widest uppercase text-neutral-300">
            {product.colors[0]}
          </span>
          <span className="font-body text-[11px] tracking-widest uppercase text-neutral-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300">
            View
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between font-body">
        <h3 className="text-sm text-white">{product.name}</h3>
        <span className="text-sm text-neutral-400">${product.price.toFixed(2)}</span>
      </div>
    </button>
  );
}

function ProductPanel({ product, onClose, onAdd }) {
  const [size, setSize] = useState(null);
  const open = !!product;

  // reset size choice whenever a new product opens
  useEffect(() => {
    setSize(null);
  }, [product]);

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end transition-opacity ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{ transitionDuration: open ? "300ms" : "200ms" }}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative w-full max-w-md h-full bg-neutral-950 border-l border-neutral-800 overflow-y-auto"
        style={{
          transitionProperty: "transform",
          transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
          // exit-faster-than-enter: closing runs at ~65% of the opening duration
          transitionDuration: open ? "420ms" : "270ms",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        <div className="flex items-center justify-between p-5 border-b border-neutral-800">
          <span className="font-display text-2xl text-white">DETAIL</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-400 hover:text-white active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
          >
            <X size={20} />
          </button>
        </div>
        {product && (
          <>
            <div className="aspect-[3/4] bg-neutral-900 border-b border-neutral-800">
              <ThornPattern id={`${product.id}-panel`} className="w-full h-full text-neutral-300" />
            </div>
            <div className="p-5 font-body space-y-5">
              <div>
                <h2 className="font-display text-3xl text-white leading-none">{product.name}</h2>
                <p className="text-neutral-400 text-sm mt-2">{product.blurb}</p>
                <p className="text-white mt-3 text-lg">${product.price.toFixed(2)}</p>
              </div>

              <div>
                <p className="text-[11px] tracking-widest uppercase text-neutral-500 mb-2">Size</p>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSize(s)}
                      className={`w-11 h-11 text-sm font-body border transition-all duration-200 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                        ${size === s ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300 hover:border-neutral-400"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <button
                disabled={!size}
                onClick={() => {
                  onAdd(product, size);
                  onClose();
                }}
                className="w-full py-3.5 font-body text-sm tracking-widest uppercase transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                  disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed disabled:active:scale-100
                  bg-white text-black hover:bg-neutral-200"
              >
                {size ? "Add to bag" : "Select a size"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CartDrawer({ items, open, onClose, onQty }) {
  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.qty, 0),
    [items]
  );
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end transition-opacity ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{ transitionDuration: open ? "300ms" : "200ms" }}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative w-full max-w-sm h-full bg-neutral-950 border-l border-neutral-800 flex flex-col"
        style={{
          transitionProperty: "transform",
          transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
          transitionDuration: open ? "420ms" : "270ms", // exit-faster-than-enter
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        <div className="flex items-center justify-between p-5 border-b border-neutral-800">
          <span className="font-display text-2xl text-white">BAG</span>
          <button
            onClick={onClose}
            aria-label="Close bag"
            className="text-neutral-400 hover:text-white active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto font-body">
          {items.length === 0 ? (
            <p className="p-5 text-sm text-neutral-500">Your bag is empty. Add something built to move.</p>
          ) : (
            items.map((item, idx) => (
              <div key={idx} className="flex gap-3 p-5 border-b border-neutral-900">
                <div className="w-16 h-20 bg-neutral-900 border border-neutral-800 shrink-0 flex items-center justify-center">
                  <ThornPattern id={`cart-${idx}`} className="w-full h-full text-neutral-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.name}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Size {item.size}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => onQty(idx, -1)}
                      aria-label="Decrease quantity"
                      className="text-neutral-400 hover:text-white active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="text-sm text-white w-4 text-center">{item.qty}</span>
                    <button
                      onClick={() => onQty(idx, 1)}
                      aria-label="Increase quantity"
                      className="text-neutral-400 hover:text-white active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <span className="text-sm text-neutral-300">${(item.price * item.qty).toFixed(2)}</span>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="p-5 border-t border-neutral-800 font-body">
            <div className="flex justify-between text-sm text-neutral-400 mb-4">
              <span>Subtotal</span>
              <span className="text-white">${subtotal.toFixed(2)}</span>
            </div>
            <button className="w-full py-3.5 bg-white text-black text-sm tracking-widest uppercase hover:bg-neutral-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              Continue to payment <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VanityStorefront() {
  const [navOpen, setNavOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cart, setCart] = useState([]);
  const parallaxRef = useParallax(0.12);
  const sectionReveal = useReveal(0);

  const addToCart = (product, size) => {
    setCart((prev) => {
      const existing = prev.findIndex((i) => i.id === product.id && i.size === size);
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = { ...copy[existing], qty: copy[existing].qty + 1 };
        return copy;
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, size, qty: 1 }];
    });
    setCartOpen(true);
  };

  const changeQty = (idx, delta) => {
    setCart((prev) =>
      prev
        .map((item, i) => (i === idx ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  return (
    <div className="min-h-screen bg-black font-body">
      <style>{FONTS}</style>

      {/* Nav */}
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-neutral-900">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <button
            className="md:hidden text-neutral-300 active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {navOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <span className="font-display text-2xl text-white tracking-[0.08em]">VANITY</span>

          <nav className="hidden md:flex items-center gap-8 font-body text-xs tracking-widest uppercase text-neutral-300">
            <a href="#shop" className="hover:text-white transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Shop</a>
            <a href="#about" className="hover:text-white transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">About</a>
          </nav>

          <button
            onClick={() => setCartOpen(true)}
            aria-label={`Open bag, ${cartCount} items`}
            className="relative text-neutral-300 hover:text-white active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
          >
            <ShoppingBag size={20} />
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-white text-black text-[10px] leading-4 text-center font-body">
                {cartCount}
              </span>
            )}
          </button>
        </div>
        <div
          className="md:hidden overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ maxHeight: navOpen ? "160px" : "0px" }}
        >
          <div className="border-t border-neutral-900 px-5 py-4 flex flex-col gap-4 font-body text-xs tracking-widest uppercase text-neutral-300">
            <a href="#shop" onClick={() => setNavOpen(false)}>Shop</a>
            <a href="#about" onClick={() => setNavOpen(false)}>About</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-neutral-900">
        <ThornPattern
          id="hero"
          className="absolute -right-24 top-0 h-full w-[65%] text-neutral-900 opacity-70 pointer-events-none will-change-transform"
        />
        {/* parallax-subtle: drifts slower than scroll, capped, off under reduced motion */}
        <div ref={parallaxRef} className="absolute -right-24 top-0 h-[130%] w-[65%] pointer-events-none will-change-transform">
          <ThornPattern id="hero-parallax" className="h-full w-full text-neutral-800 opacity-40" />
        </div>
        <div className="relative max-w-6xl mx-auto px-5 pt-24 pb-28 md:pt-36 md:pb-40">
          <p className="hero-rise font-body text-[11px] tracking-[0.3em] uppercase text-neutral-500 mb-5" style={{ animationDelay: "0ms" }}>
            Engineered compression — Bahrain
          </p>
          <h1 className="font-display text-white leading-[0.85] text-[15vw] md:text-[7.5rem]">
            <span className="hero-rise block" style={{ animationDelay: "80ms" }}>STILL,</span>
            <span className="hero-rise block" style={{ animationDelay: "160ms" }}>UNDER PRESSURE.</span>
          </h1>
          <p className="hero-rise font-body text-neutral-400 max-w-md mt-6 text-sm leading-relaxed" style={{ animationDelay: "260ms" }}>
            Compression shirts built for output, finished in a quiet, near-black
            palette. The print only shows itself when you move.
          </p>
          <a
            href="#shop"
            className="hero-rise inline-flex items-center gap-2 mt-8 border border-neutral-700 text-white px-6 py-3 text-xs tracking-widest uppercase hover:border-white active:scale-[0.97] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ animationDelay: "340ms" }}
          >
            Shop the collection <ChevronRight size={14} />
          </a>
        </div>
      </section>

      {/* Eyebrow strip */}
      <div className="border-b border-neutral-900 overflow-hidden">
        <div className="max-w-6xl mx-auto px-5 py-3 flex gap-10 font-body text-[10px] tracking-[0.25em] uppercase text-neutral-600 whitespace-nowrap overflow-x-auto">
          <span>4-way stretch</span>
          <span>Flatlock seams</span>
          <span>Made for training</span>
          <span>Local brand, Manama</span>
        </div>
      </div>

      {/* Product grid */}
      <section id="shop" className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div
          ref={sectionReveal.ref}
          className={`${sectionReveal.className} flex items-end justify-between mb-10`}
          style={sectionReveal.style}
        >
          <h2 className="font-display text-3xl md:text-4xl text-white">THE COLLECTION</h2>
          <span className="font-body text-xs text-neutral-500">{PRODUCTS.length} styles</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 md:gap-6">
          {PRODUCTS.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} onSelect={setSelected} />
          ))}
        </div>
      </section>

      {/* About / footer */}
      <footer id="about" className="border-t border-neutral-900">
        <div className="max-w-6xl mx-auto px-5 py-16 grid md:grid-cols-2 gap-10">
          <div>
            <span className="font-display text-2xl text-white">VANITY</span>
            <p className="font-body text-sm text-neutral-500 mt-3 max-w-sm leading-relaxed">
              A Manama-based compression wear label. Minimal on the outside,
              deliberate underneath — every seam and print exists for a reason.
            </p>
          </div>
          <div className="font-body text-xs tracking-widest uppercase text-neutral-500 flex flex-col gap-2 md:items-end">
            <a href="#" className="hover:text-white transition-colors duration-200">Shipping</a>
            <a href="#" className="hover:text-white transition-colors duration-200">Returns</a>
            <a href="#" className="hover:text-white transition-colors duration-200">Contact</a>
          </div>
        </div>
        <div className="border-t border-neutral-900 px-5 py-5 text-center font-body text-[11px] text-neutral-600">
          © {new Date().getFullYear()} Vanity. All rights reserved.
        </div>
      </footer>

      <ProductPanel product={selected} onClose={() => setSelected(null)} onAdd={addToCart} />
      <CartDrawer items={cart} open={cartOpen} onClose={() => setCartOpen(false)} onQty={changeQty} />
    </div>
  );
}
