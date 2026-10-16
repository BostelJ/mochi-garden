// Types for the page's JavaScript, checked through JSDoc (npm run check). Nothing is compiled.

// Globals from the vendored xterm.js scripts (ui/vendor), loaded as plain scripts by index.html.
declare const Terminal: any;
declare const FitAddon: { FitAddon: any };
declare const WebLinksAddon: { WebLinksAddon: any };

/** One Claude Code session's place in the garden. Saved fields are listed in persist.js. */
interface Plot {
  id: string;
  sessionId: string | null;
  flavour: string;
  /** desk corner, in world tiles; null until the session's first prompt */
  x: number | null;
  y: number | null;
  title: string | null;
  /** a name the session gave its mochi (build.js name) */
  name?: string;
  created?: number;
  cwd?: string | null;
  seed: number;

  // tokens: the whole session's, and the main transcript's alone (subagents' are added on top)
  tokens: number;
  mainTokens?: number;
  agentTokens?: number;
  /** tokens waiting to be paid out as seeds (seeds.js) */
  bank?: number;
  /** the first token read of an adopted session sets the total, without a burst of seeds */
  adopting?: boolean;

  // session state
  live?: boolean;
  activity?: 'arriving' | 'working' | 'idle' | 'sleep' | 'leaving';
  bubble?: '!' | '?' | null;
  selected?: boolean;
  /** packed away: the session ended, its garden is kept for when it's resumed */
  away?: boolean;
  /** the desk is built (after the first answer) */
  built?: boolean;
  /** 0..1 while the desk is being built */
  build?: number;
  lastHook?: number;
  lastEvent?: number;
  lastStop?: number;
  streak?: number;
  pending?: Pending | null;
  pendingAgents?: string[];
  helpers?: Helper[];
  effort?: number;
  seedAcc?: number;
  burst?: any;

  // the garden (farm.js, build.js)
  pieces?: Piece[];
  /** seeds landed on bare grass, by "x,y": wildflowers */
  wild?: Record<string, number>;
  /** coins spent (in coins once `coins` is set; older gardens counted materials) */
  spent?: number;
  coins?: number;
  outfit?: Outfit | null;
  gifts?: Gift[];
  errands?: Errand[];
  landRev?: number;
  _land?: Map<string, LandTile>;
  _landRev?: number;

  // drawing
  m?: Mochi | null;
  tw?: any;

  // from gardens before the land model (farm.js migrateLand)
  dug?: number;
  fenced?: number;
  crops?: ({ k: string; w: number } | null)[];
}

/** Something built in a garden, at tiles from the plot's corner. */
interface Piece {
  k: string;
  x: number;
  y: number;
  /** variant (flower colour, tree kind, roof colour) */
  v?: string;
  /** a sign's text */
  txt?: string;
  /** built: 0..1 while the mochi builds it */
  b: number;
  crop?: Crop;
}

interface Crop {
  k: string;
  /** seeds it has had: its growth */
  w: number;
  wet?: number;
  grew?: number;
}

interface LandTile {
  desk?: boolean;
  ground?: Piece;
  object?: Piece;
}

/** A plot's mochi, as drawn and moved by garden.js. */
interface Mochi {
  x: number;
  y: number;
  tx: number;
  ty: number;
  phase: number;
  prints: { x: number; y: number; t: number }[];
  walking?: boolean;
  lastHop?: number;
  wait?: { x: number; y: number };
  visit?: any;
  job?: any;
  digHop?: number;
  pop?: number;
  throwAt?: number;
  mergeAt?: number;
  greetAt?: number;
  heartAt?: number;
  dressedAt?: number;
  eatAt?: number;
  eatK?: string;
}

interface Pending {
  kind: 'perm' | 'ask';
  tool?: string;
  detail?: string;
  question?: string;
  options?: string[];
}

interface Helper {
  id: string;
  label: string;
  slot: number;
  state: string;
  [k: string]: any;
}

/** What a mochi wears, by slot: an item and its colour. */
type Outfit = Partial<Record<'head' | 'neck' | 'face' | 'back', { i: string; c: string | null }>>;

interface Gift {
  k: string;
  from: string;
}

interface Errand {
  kind: 'gift';
  to: string;
  k: string;
}

/** A live terminal tab and the plot it shows. */
interface Tab {
  tab: string;
  plot: Plot;
  term: any;
  fit: any;
  el: HTMLElement;
  li: HTMLElement | null;
  started: number;
}
