import { colorFor, colorMap } from "../shared/color";
import { sortByKey } from "../shared/orderKey";
import type { Board, Column, Story, Task } from "../shared/types";

const NOTE_ICON =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 11h16M4 16h9"/></svg>';
const CLIP_ICON =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
// Card size adapts to the column share so two cards always sit side by side in an
// ordinary column: full size when the share allows (4 columns on a laptop), gently
// smaller when more columns squeeze it. CSS reads the result via --cardw/--cardh.
const CARD_MAX = 146;
const CARD_MIN = 110;
const CARD_GAP = 8; // keep in sync with .cards gap
const CELL_PAD = 22; // 9px cell padding ×2 + 1px border + rounding slack — short here means cards wrap instead of pairing up
const FONT_MAX = 12;
const FONT_MIN = 10;

function hints(note: string, attachments: unknown[]): HTMLElement | null {
  if (!note && !attachments.length) return null;
  const box = document.createElement("span");
  box.innerHTML = (note ? NOTE_ICON : "") + (attachments.length ? CLIP_ICON : "");
  box.title = [note ? "Has a note" : "", attachments.length ? `${attachments.length} attachment${attachments.length > 1 ? "s" : ""}` : ""]
    .filter(Boolean)
    .join(" · ");
  return box;
}

export type EditDraft = { columns: Column[] };

export type RenderCtx = {
  filter: string;
  doneDays: number; // 0 = show all
  edit: EditDraft | null;
  colRename: { id: string; draft: string } | null;
  editing: Map<string, string>; // taskId → editor name
  selected: Set<string>;
  lastSelected: string | null;
  collapseStories: boolean; // narrow-viewport mode: stories shrink to a strip, cards get the width
};

function flowColumns(b: Board, edit?: EditDraft | null): Column[] {
  return [...(edit?.columns ?? b.columns), { id: "done", name: "Done" }];
}

export function storiesSorted(b: Board): Story[] {
  return sortByKey(Object.values(b.stories));
}

export function cellTasks(b: Board, storyId: string, col: string): Task[] {
  return sortByKey(Object.values(b.tasks).filter((t) => t.storyId === storyId && t.column === col));
}

function columnEmpty(b: Board, colId: string): boolean {
  return !Object.values(b.tasks).some((t) => t.column === colId);
}

let colors = new Map<string, { c: string; a: string }>(); // board-coordinated assignee colors, rebuilt per render

export function renderBoard(table: HTMLTableElement, b: Board, ctx: RenderCtx): void {
  colors = colorMap(Object.values(b.tasks).map((t) => t.assignee));
  table.textContent = "";
  const cols = flowColumns(b, ctx.edit);
  const addcolAt = ctx.edit ? cols.findIndex((c) => c.id === "todo") + 1 : -1;
  const doneCutoff = ctx.doneDays ? Date.now() - ctx.doneDays * DAY : 0;

  // Columns start equal — the share fits two cards side by side at four columns on
  // a 14" laptop (that's what the 12.5vw stories cap buys) — and ordinary moves
  // never resize anything. Only a genuinely crowded column, three or more cards in
  // one cell, grows to fit them in a row; the others fund it evenly, never
  // shrinking below one card wide.
  const cellMax = new Map<string, number>(); // colId → most cards in any one cell
  const counts = new Map<string, number>();
  for (const t of Object.values(b.tasks)) {
    if (ctx.filter && t.assignee.trim().toLowerCase() !== ctx.filter.trim().toLowerCase()) continue;
    if (t.column === "done" && doneCutoff && t.doneAt && t.doneAt < doneCutoff) continue;
    const k = `${t.storyId}|${t.column}`;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    cellMax.set(t.column, Math.max(cellMax.get(t.column) ?? 0, n));
  }
  table.classList.toggle("scollapsed", ctx.collapseStories);
  const tableW = table.clientWidth || document.documentElement.clientWidth;
  const storiesW = ctx.collapseStories ? 34 : Math.max(160, 0.125 * tableW);
  const avail = tableW - storiesW - 30;
  const fairW = avail / cols.length;
  const cardW = Math.max(CARD_MIN, Math.min(CARD_MAX, Math.floor((fairW - CARD_GAP - CELL_PAD) / 2)));
  table.style.setProperty("--cardw", `${cardW}px`);
  table.style.setProperty("--cardh", `${Math.round(cardW * 0.89)}px`); // the original 122×108 sticky aspect
  const needW = (m: number) => m * cardW + (m - 1) * CARD_GAP + CELL_PAD;
  const oneCard = needW(1);
  const need = (c: Column) => needW(cellMax.get(c.id) ?? 0);
  const needy = cols.filter((c) => (cellMax.get(c.id) ?? 0) > 2 && need(c) > fairW);
  const colW = new Map<string, number>();
  if (!needy.length) {
    for (const c of cols) colW.set(c.id, fairW);
  } else if (needy.length < cols.length) {
    const extra = needy.reduce((s, c) => s + need(c) - fairW, 0);
    const givers = cols.length - needy.length;
    const giverW = Math.max(oneCard, fairW - extra / givers);
    const funded = (fairW - giverW) * givers; // what the givers actually raised
    for (const c of cols) colW.set(c.id, needy.includes(c) ? fairW + (need(c) - fairW) * Math.min(1, funded / extra) : giverW);
  } else {
    // every column is crowded — split proportionally to need, cells wrap
    const total = cols.reduce((s, c) => s + need(c), 0);
    for (const c of cols) colW.set(c.id, Math.max(oneCard, (avail * need(c)) / total));
  }

  const hr = table.createTHead().insertRow();
  const hs = el("th", "stories col-stories");
  const tog = el("span", "stoggle");
  tog.dataset.act = "stoggle";
  tog.textContent = ctx.collapseStories ? "›" : "‹";
  tog.title = ctx.collapseStories ? "Expand stories" : "Collapse stories";
  if (ctx.collapseStories) {
    hs.style.width = "34px";
    hs.append(tog);
  } else {
    hs.append(tog, "Stories ");
    const plus = el("span", "plusmini");
    plus.title = "New story";
    plus.textContent = "＋";
    plus.dataset.act = "newstory";
    hs.append(plus);
  }
  hr.append(hs, el("th", "plushead"));
  cols.forEach((c, i) => {
    if (i === addcolAt) {
      const add = el("th", "addcol-h");
      add.textContent = "＋";
      add.title = "Add column";
      add.dataset.act = "addcol";
      hr.append(add);
    }
    const th = el("th", c.id === "done" ? "" : "colhead");
    th.style.width = `${colW.get(c.id)}px`;
    th.dataset.col = c.id;
    if (c.id !== "done") {
      const grip = el("span", "grip");
      grip.title = "Drag to reorder";
      grip.textContent = "⋮⋮";
      th.append(grip);
      th.title = "Double-click to rename";
    }
    if (ctx.colRename?.id === c.id) {
      const input = document.createElement("input");
      input.className = "colinput";
      input.value = ctx.colRename.draft;
      input.setAttribute("aria-label", "Column name");
      th.append(input);
    } else {
      th.append(c.name);
    }
    if (c.id === "done") {
      const menu = el("span", "menu-btn");
      menu.title = "Done options";
      menu.textContent = "⋯";
      menu.dataset.act = "donemenu";
      th.append(" ", menu);
    } else if (ctx.edit && c.id !== "todo" && c.id !== "inprog" && columnEmpty(b, c.id)) {
      const x = el("a", "colx");
      (x as HTMLAnchorElement).href = "#";
      x.title = "Remove column";
      x.textContent = "✕";
      x.dataset.act = "removecol";
      x.dataset.col = c.id;
      th.append(x);
    }
    hr.append(th);
  });

  const tbody = table.createTBody();
  for (const s of storiesSorted(b)) {
    const tr = tbody.insertRow();
    tr.dataset.story = s.id;
    const td = el("td", "story col-stories");
    const box = el("div", "storybox");
    box.dataset.story = s.id;
    box.append(document.createTextNode(s.title));
    const shint = hints(s.note, s.attachments);
    if (shint) {
      shint.className = "sclip";
      box.append(shint);
    }
    const editor = ctx.editing.get(s.id);
    if (editor) {
      const badge = el("div", "badge");
      badge.textContent = `✎ ${editor}`;
      box.append(badge);
    }
    td.append(box);
    const plusTd = el("td", "plus");
    plusTd.textContent = "+";
    plusTd.title = "Add card";
    plusTd.dataset.story = s.id;
    tr.append(td, plusTd);
    cols.forEach((c, i) => {
      if (i === addcolAt) tr.append(el("td", "addcol-c"));
      const cell = el("td", "cell");
      const cards = el("div", "cards");
      cards.dataset.story = s.id;
      cards.dataset.col = c.id;
      let tasks = cellTasks(b, s.id, c.id);
      if (c.id === "done" && doneCutoff) tasks = tasks.filter((t) => !t.doneAt || t.doneAt >= doneCutoff);
      for (const t of tasks) {
        const card = renderCard(t, ctx);
        if (card) cards.append(card);
      }
      if (!cards.childElementCount) cell.classList.add("empty");
      cell.append(cards);
      tr.append(cell);
    });
  }

  const fr = table.createTFoot().insertRow();
  const nf = el("td", "newstory col-stories");
  const a = document.createElement("a");
  a.href = "#";
  a.textContent = ctx.collapseStories ? "＋" : "New Story"; // collapsed click expands first, then opens the input
  if (ctx.collapseStories) a.title = "New story";
  a.dataset.act = "newstory";
  nf.append(a);
  fr.append(nf, el("td", ""));
  cols.forEach((_, i) => {
    if (i === addcolAt) fr.append(el("td", "addcol-c"));
    fr.append(el("td", "cellfoot"));
  });

  fitCardText(table);
}

// long text shrinks to fit the fixed card (12 → 8px); whatever still overflows at
// 8px gets the grey long-card treatment: clamp to whole lines, full text on hover
function fitCardText(table: HTMLTableElement): void {
  for (const txt of table.querySelectorAll<HTMLElement>(".card .txt")) {
    let f = FONT_MAX;
    while (txt.scrollHeight > txt.clientHeight + 1 && f > FONT_MIN) {
      f--;
      txt.style.fontSize = `${f}px`;
    }
    if (txt.scrollHeight > txt.clientHeight + 1) {
      const card = txt.closest<HTMLElement>(".card")!;
      card.classList.add("long");
      card.title = txt.textContent ?? "";
      card.style.setProperty("--c", "#ececec"); // inline assignee color would beat the .long rule
      card.style.setProperty("--a", "#dcdfe3");
      // cut at a whole-line boundary: whatever fits between the paddings (8 top + 22 bottom)
      const lines = Math.max(1, Math.floor((txt.clientHeight - 30) / (f * 1.3)));
      txt.style.flex = "none";
      txt.style.paddingBottom = "0";
      txt.style.height = `${8 + lines * f * 1.3}px`;
    }
  }
}

function renderCard(t: Task, ctx: RenderCtx): HTMLElement | null {
  if (ctx.filter && t.assignee.trim().toLowerCase() !== ctx.filter.trim().toLowerCase()) return null;
  const card = el("div", "card");
  card.dataset.id = t.id;
  if (t.priority) card.classList.add("prio");
  if (t.assignee) {
    const { c, a } = colors.get(t.assignee.trim().toLowerCase()) ?? colorFor(t.assignee);
    card.style.setProperty("--c", c);
    card.style.setProperty("--a", a);
  }
  const editor = ctx.editing.get(t.id);
  if (editor) {
    const badge = el("div", "badge");
    badge.textContent = `✎ ${editor}`;
    card.append(badge);
  }
  card.append(el("div", "bar"));
  const txt = el("div", "txt");
  txt.textContent = t.title;
  card.append(txt);
  const who = el("div", "who");
  if (t.assignee) {
    const name = el("span", "name");
    name.textContent = t.assignee;
    who.append(el("span", "dot"), name);
  } else {
    who.classList.add("none");
    who.textContent = "UNASSIGNED";
  }
  card.append(who);
  const chint = hints(t.note, t.attachments);
  if (chint) {
    chint.className = "cclip";
    card.append(chint);
  }
  if (ctx.selected.has(t.id)) {
    card.classList.add("selected");
    if (ctx.lastSelected === t.id && ctx.selected.size > 1) {
      const hint = el("div", "selhint");
      hint.textContent = `${ctx.selected.size} selected — drag moves them`;
      card.append(hint);
    }
  }
  return card;
}

const DAY = 24 * 60 * 60 * 1000;

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
