"use client";

import React, { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

// ============================================================================
// ANDROS — LOGO GENERATIVO MUTANTE
//   · Cada letra de A-N-D-R-O-S cambia de tipografía por su cuenta, a su ritmo.
//   · Pasar el cursor → salto elástico + mutación instantánea.
//   · Clic → la letra queda fijada (punto de acento) hasta volver a tocarla.
//   · `shuffleSignal` cambia → nueva combinación para todas las letras libres.
//   · `clean` = true → todas las letras se alinean en el logo oficial limpio.
// ============================================================================

interface TypeFace {
  id: string;
  cssVar: string;
  weights: number[];
  italic: boolean;
}

/** Las 8 familias cargadas en src/app/layout.tsx. */
const FACES: TypeFace[] = [
  { id: "inter", cssVar: "--font-sans", weights: [200, 400, 800, 900], italic: true },
  { id: "mono", cssVar: "--font-mono", weights: [200, 400, 700, 800], italic: true },
  { id: "playfair", cssVar: "--font-playfair", weights: [400, 700, 900], italic: true },
  { id: "grotesk", cssVar: "--font-space-grotesk", weights: [300, 500, 700], italic: false },
  { id: "syne", cssVar: "--font-syne", weights: [400, 600, 800], italic: false },
  { id: "instrument", cssVar: "--font-instrument-serif", weights: [400], italic: true },
  { id: "bebas", cssVar: "--font-bebas", weights: [400], italic: false },
  { id: "cormorant", cssVar: "--font-cormorant", weights: [300, 500, 700], italic: true },
];

const LETTERS = ["A", "N", "D", "R", "O", "S"] as const;
/** Cómo se escribe cada letra en el logo oficial de la barra superior ("Andros"). */
const CLEAN_LETTERS = ["A", "n", "d", "r", "o", "s"] as const;
/** Inclinación de cada letra al hacer hover (fija para que no "tiemble"). */
const HOVER_TILT = [-7, 5, -4, 8, -6, 4];

interface Gene {
  key: string;
  face: TypeFace;
  weight: number;
  italic: boolean;
  smallCaps: boolean;
}

let geneCounter = 0;

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Genera un "gen" tipográfico distinto de la familia anterior. */
function randomGene(previous?: Gene): Gene {
  const candidates = previous ? FACES.filter((f) => f.id !== previous.face.id) : FACES;
  const face = pick(candidates);
  geneCounter += 1;
  return {
    key: `${face.id}-${geneCounter}`,
    face,
    weight: pick(face.weights),
    italic: face.italic && Math.random() < 0.38,
    // Bebas Neue solo tiene mayúsculas: las versalitas no aportan nada ahí.
    smallCaps: face.id !== "bebas" && Math.random() < 0.18,
  };
}

const CLEAN_GENE: Gene = {
  key: "clean",
  face: FACES[0],
  weight: 600,
  italic: false,
  smallCaps: false,
};

const SPRING = { type: "spring", stiffness: 420, damping: 14, mass: 0.7 } as const;
const SWAP = { duration: 0.45, ease: [0.16, 1, 0.3, 1] } as const;

// ---------------------------------------------------------------------------
// Letra individual
// ---------------------------------------------------------------------------

interface MutantLetterProps {
  index: number;
  gene: Gene;
  pinned: boolean;
  clean: boolean;
  onHover: (index: number) => void;
  onToggle: (index: number) => void;
}

const MutantLetter: React.FC<MutantLetterProps> = ({
  index,
  gene,
  pinned,
  clean,
  onHover,
  onToggle,
}) => {
  const char = clean ? CLEAN_LETTERS[index] : gene.smallCaps ? LETTERS[index].toLowerCase() : LETTERS[index];

  return (
    <motion.button
      type="button"
      layout="position"
      onHoverStart={() => onHover(index)}
      onClick={() => onToggle(index)}
      whileHover={clean ? undefined : { scale: 1.15, rotate: HOVER_TILT[index] }}
      whileTap={clean ? undefined : { scale: 0.92 }}
      transition={SPRING}
      aria-pressed={pinned}
      aria-label={`Letter ${LETTERS[index]}${pinned ? " (locked)" : ""}`}
      title={pinned ? "Locked — click to release" : "Click to lock this letter"}
      className="relative inline-flex items-center justify-center h-[1.1em] cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-andros-accent/50 rounded-lg"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={clean ? "clean" : gene.key}
          initial={{ opacity: 0, y: "0.22em", filter: "blur(10px)" }}
          animate={{ opacity: 1, y: "0em", filter: "blur(0px)" }}
          exit={{ opacity: 0, y: "-0.22em", filter: "blur(10px)" }}
          transition={SWAP}
          className="block leading-none"
          style={{
            fontFamily: `var(${gene.face.cssVar})`,
            fontWeight: gene.weight,
            fontStyle: gene.italic ? "italic" : "normal",
            fontVariantCaps: gene.smallCaps ? "small-caps" : "normal",
          }}
        >
          {char}
        </motion.span>
      </AnimatePresence>

      <AnimatePresence>
        {pinned && !clean && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={SPRING}
            className="absolute -bottom-[0.12em] left-1/2 -ml-[4px] w-2 h-2 rounded-full bg-andros-accent"
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
};

// ---------------------------------------------------------------------------
// Logo completo
// ---------------------------------------------------------------------------

interface MutantAndrosLogoProps {
  /** Cada vez que cambia este número se mezcla el ADN de las letras libres. */
  shuffleSignal: number;
  /** Tamaño de letra CSS del logo. */
  fontSize?: string;
  /** Alinea las letras en el logo oficial limpio y detiene la mutación. */
  clean?: boolean;
  className?: string;
}

export const MutantAndrosLogo = forwardRef<HTMLDivElement, MutantAndrosLogoProps>(
  function MutantAndrosLogo(
    { shuffleSignal, fontSize = "clamp(4.25rem, 15vw, 10.5rem)", clean = false, className = "" },
    ref,
  ) {
    const reduceMotion = useReducedMotion();
    const [genes, setGenes] = useState<Gene[]>(() => LETTERS.map(() => randomGene()));
    const [pinned, setPinned] = useState<boolean[]>(() => LETTERS.map(() => false));
    const pinnedRef = useRef(pinned);
    useEffect(() => {
      pinnedRef.current = pinned;
    }, [pinned]);

    const mutate = useCallback((index: number) => {
      if (pinnedRef.current[index]) return;
      setGenes((prev) => {
        const next = [...prev];
        next[index] = randomGene(prev[index]);
        return next;
      });
    }, []);

    // Ciclo asíncrono: cada letra tiene su propio reloj con ritmo aleatorio.
    useEffect(() => {
      if (clean || reduceMotion) return;
      const timers: number[] = [];
      const schedule = (index: number) => {
        timers[index] = window.setTimeout(() => {
          mutate(index);
          schedule(index);
        }, 1100 + Math.random() * 2400);
      };
      LETTERS.forEach((_, i) => {
        // Arranque escalonado para que nunca cambien todas a la vez.
        timers[i] = window.setTimeout(() => schedule(i), 300 + i * 220);
      });
      return () => timers.forEach((t) => window.clearTimeout(t));
    }, [clean, reduceMotion, mutate]);

    // Botón "Mezclar ADN tipográfico": cuando cambia la señal, nueva combinación.
    const [lastShuffle, setLastShuffle] = useState(shuffleSignal);
    if (shuffleSignal !== lastShuffle) {
      setLastShuffle(shuffleSignal);
      setGenes((prev) => prev.map((g, i) => (pinned[i] ? g : randomGene(g))));
    }

    const handleHover = useCallback(
      (index: number) => {
        if (!clean) mutate(index);
      },
      [clean, mutate],
    );

    const handleToggle = useCallback(
      (index: number) => {
        if (clean) return;
        setPinned((prev) => prev.map((p, i) => (i === index ? !p : p)));
      },
      [clean],
    );

    return (
      <div
        ref={ref}
        role="group"
        aria-label="Andros"
        className={`inline-flex items-center text-andros-primary leading-none ${
          clean ? "pointer-events-none" : ""
        } ${className}`}
        style={{ fontSize, transformOrigin: "0% 50%" }}
      >
        {LETTERS.map((_, i) => (
          <MutantLetter
            key={i}
            index={i}
            gene={clean ? CLEAN_GENE : genes[i]}
            pinned={pinned[i]}
            clean={clean}
            onHover={handleHover}
            onToggle={handleToggle}
          />
        ))}
      </div>
    );
  },
);
