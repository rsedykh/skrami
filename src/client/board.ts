import Sortable from "sortablejs";
import { applyOp, defaultBoard } from "../shared/applyOp";
import { colorFor, colorMap } from "../shared/color";
import { SLUG_RE, uid } from "../shared/id";
import { keyBetween, sortByKey } from "../shared/orderKey";
import type { Attachment, Board, Envelope, Op, PresenceUser, Task } from "../shared/types";
import { cacheDel, cacheGet } from "./db";
import { wireDrawer } from "./drawer";
import { openPasswordDialog, showUnlockGate } from "./password";
import { openPopup, popupEntity, popupOpen, popupRemoteDelete, popupRemoteUpdate } from "./popup";
import {
  boardFilter,
  boardPassword,
  boardToken,
  doneDays,
  dropRecent,
  effectiveDark,
  myName,
  setBoardFilter,
  setBoardPassword,
  setBoardToken,
  setDoneDays,
  setMyName,
  setTheme,
  touchRecent,
} from "./prefs";
import { cellTasks, renderBoard, storiesSorted, type EditDraft } from "./render";
import { Sync, type Status } from "./sync";

const slug = decodeURIComponent(location.pathname.split("/")[2] ?? "");
if (!SLUG_RE.test(slug)) location.replace("/");

const $ = (id: string) => document.getElementById(id)!;
const table = $("board") as HTMLTableElement;

document.title = `${slug} · Skrami`;
$("slugname").textContent = slug;
touchRecent(slug);
wireDrawer(slug);

let board: Board = defaultBoard(slug);
let filter = boardFilter(slug);
let doneDaysView = doneDays(slug);
let hoveredCard: string | null = null;
let hoveredCell: { story: string; col: string } | null = null;
let dragging = false;
let rendering = false;
let renderQueued = false;
let newStoryDraft: string | null = null;
let colRename: { id: string; draft: string } | null = null;
let editDraft: EditDraft | null = null;
const selected = new Set<string>();
let lastSelected: string | null = null;
let presence: PresenceUser[] = [];
let editingKey = "";
let isProtected = false;
let pendingPassword: string | null = null;
let leaving = false;
let userDeleted = false;
let floatMenu: HTMLElement | null = null;
let settleUntil = 0; // renders hold off until Sortable's drop animation lands

const sync = new Sync(slug, {
  onApply(env) {
    applyOp(board, env);
    routeToPopup(env);
    scheduleRender();
  },
  onSnapshot(b, _v, prot) {
    board = b;
    isProtected = prot;
    updatePwLabel();
    scheduleRender();
    sync.live({ t: "presence", name: myName() });
  },
  onDeleted() {
    void leaveBoard(userDeleted ? undefined : "This board was deleted.");
  },
  onStatus(s: Status) {
    $("syncdot").className = `dot ${s.state}`;
    $("synclabel").textContent =
      s.state === "synced" ? "Synced" : s.state === "syncing" ? "Syncing…" : s.queued ? `Offline (${s.queued} queued)` : "Offline";
  },
  onAuthRequired() {
    setBoardToken(slug, null);
    showUnlockGate(slug, (token, password) => {
      setBoardToken(slug, token);
      setBoardPassword(slug, password);
      isProtected = true;
      updatePwLabel();
      sync.setToken(token);
    });
  },
  onToken(token) {
    setBoardToken(slug, token);
    setBoardPassword(slug, token ? pendingPassword : null);
    pendingPassword = null;
    isProtected = !!token;
    updatePwLabel();
  },
  onMoved(newSlug) {
    void migrateTo(newSlug);
  },
  onRenameError() {
    alert("That board name is taken.");
  },
  onPresence(users) {
    presence = users;
    renderPresence();
    const key = users
      .filter((u) => u.editing && u.cid !== sync.cid && u.name)
      .map((u) => `${u.editing}:${u.name}`)
      .sort()
      .join("|");
    if (key !== editingKey) {
      editingKey = key;
      scheduleRender();
    }
  },
});

function emit(op: Op): void {
  void sync.submit(op);
}

function nameForCid(cid: string): string {
  return presence.find((u) => u.cid === cid)?.name ?? "";
}

// remote ops for the entity open in the dialog — conflict layer 3
function routeToPopup(env: Envelope): void {
  if (!popupOpen()) return;
  const op = env.op;
  if ((op.t === "task.set" || op.t === "story.set") && popupEntity() === op.id)
    popupRemoteUpdate(op.id, op.set, nameForCid(env.cid));
  else if (op.t === "task.del" || op.t === "story.del") popupRemoteDelete(op.id);
}

function editingMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of presence) if (u.editing && u.name && u.cid !== sync.cid) m.set(u.editing, u.name);
  return m;
}

function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render(): void {
  if (dragging) return; // drag end always schedules a render
  // a full rebuild mid-settle snaps Sortable's drop animation and the card blinks
  // across both spots — hold every render until the animation has landed
  const wait = settleUntil - performance.now();
  if (wait > 0) {
    setTimeout(scheduleRender, wait + 20);
    return;
  }
  rendering = true;
  renderBoard(table, board, {
    filter,
    doneDays: doneDaysView,
    edit: editDraft,
    colRename,
    editing: editingMap(),
    selected,
    lastSelected,
  });
  rendering = false;
  $("filterlabel").textContent = filter || "Everyone";
  $("filterchip").classList.toggle("on", !!filter);
  updateEditControls();
  renderPresence();
  for (const cards of table.querySelectorAll<HTMLElement>(".cards")) {
    new Sortable(cards, {
      group: "cards",
      animation: 120,
      forceFallback: true, // native HTML5 DnD leaves Chrome's drag image lingering after drop — the card blinks in two places
      fallbackTolerance: 3, // whole cards are handles now; don't let a 1px twitch swallow a click
      onStart() {
        dragging = true;
        freezeCols();
      },
      onEnd(evt) {
        dragging = false;
        settleUntil = performance.now() + 180;
        const item = evt.item as HTMLElement;
        const to = evt.to as HTMLElement;
        if (selected.has(item.dataset.id!) && selected.size > 1) onGroupDrop(item, to);
        else onDrop(item, to);
        scheduleRender();
      },
    });
  }
  const headRow = table.tHead?.rows[0];
  if (headRow) {
    new Sortable(headRow, {
      draggable: "th.colhead",
      handle: ".grip",
      animation: 120,
      forceFallback: true,
      onMove(evt) {
        const rel = evt.related as HTMLElement;
        if (rel.classList.contains("colhead")) return true;
        if (rel.dataset.col === "done") return !evt.willInsertAfter;
        return false;
      },
      onStart() {
        dragging = true;
      },
      onEnd() {
        dragging = false;
        settleUntil = performance.now() + 180;
        const order = [...headRow.querySelectorAll<HTMLElement>("th.colhead")].map((th) => th.dataset.col!);
        applyColumnOrder(order);
        scheduleRender();
      },
    });
  }
  const tbody = table.tBodies[0];
  if (tbody) {
    new Sortable(tbody, {
      draggable: "tr",
      handle: ".storybox",
      animation: 120,
      forceFallback: true,
      fallbackTolerance: 3,
      onStart() {
        dragging = true;
      },
      onEnd(evt) {
        dragging = false;
        settleUntil = performance.now() + 180;
        if (evt.oldIndex !== evt.newIndex) onStoryDrop(evt.item as HTMLElement);
        scheduleRender();
      },
    });
  }
  if (newStoryDraft !== null) mountStoryInput();
  if (colRename) mountColInput();
}

function applyColumnOrder(order: string[]): void {
  if (editDraft) {
    const byId = new Map(editDraft.columns.map((c) => [c.id, c]));
    editDraft.columns = order.map((id) => byId.get(id)!).filter(Boolean);
    return;
  }
  order.forEach((id, i) => {
    if (board.columns[i]?.id !== id) emit({ t: "col.move", id, index: i });
  });
}

// pin every column at its current width while a card is in flight — the item moving
// between cells must not resize columns under the cursor mid-drag; the pins die
// with the next full redraw (border-box so the pinned value equals the measured one)
function freezeCols(): void {
  const hr = table.tHead?.rows[0];
  if (!hr) return;
  for (const th of hr.cells) {
    th.style.boxSizing = "border-box";
    th.style.width = `${th.getBoundingClientRect().width}px`;
  }
}

function onStoryDrop(tr: HTMLElement): void {
  const id = tr.dataset.story!;
  if (!board.stories[id]) return;
  const prev = (tr.previousElementSibling as HTMLElement | null)?.dataset.story;
  const next = (tr.nextElementSibling as HTMLElement | null)?.dataset.story;
  let orderKey: string;
  try {
    orderKey = keyBetween(prev ? board.stories[prev]?.orderKey ?? null : null, next ? board.stories[next]?.orderKey ?? null : null);
  } catch {
    orderKey = keyBetween(prev ? board.stories[prev]?.orderKey ?? null : null, null); // concurrent-move collision — self-heals on render
  }
  emit({ t: "story.move", id, orderKey });
}

function onDrop(item: HTMLElement, to: HTMLElement): void {
  const id = item.dataset.id!;
  const task = board.tasks[id];
  const storyId = to.dataset.story!;
  const column = to.dataset.col!;
  if (!task || !board.stories[storyId]) return;
  const prev = (item.previousElementSibling as HTMLElement | null)?.dataset.id;
  const next = (item.nextElementSibling as HTMLElement | null)?.dataset.id;
  let orderKey: string;
  try {
    orderKey = keyBetween(prev ? board.tasks[prev]?.orderKey ?? null : null, next ? board.tasks[next]?.orderKey ?? null : null);
  } catch {
    orderKey = keyBetween(prev ? board.tasks[prev]?.orderKey ?? null : null, null); // concurrent-move collision — self-heals on render
  }
  emit({ t: "task.move", id, storyId, column, orderKey });
}

// the whole selection moves as one batch — the DO applies it in one turn
function onGroupDrop(item: HTMLElement, to: HTMLElement): void {
  const storyId = to.dataset.story!;
  const column = to.dataset.col!;
  if (!board.stories[storyId]) return;
  const group = sortByKey(Object.values(board.tasks).filter((t) => selected.has(t.id)));
  let prevEl = item.previousElementSibling as HTMLElement | null;
  while (prevEl && selected.has(prevEl.dataset.id!)) prevEl = prevEl.previousElementSibling as HTMLElement | null;
  let nextEl = item.nextElementSibling as HTMLElement | null;
  while (nextEl && selected.has(nextEl.dataset.id!)) nextEl = nextEl.nextElementSibling as HTMLElement | null;
  let prevKey = prevEl ? board.tasks[prevEl.dataset.id!]?.orderKey ?? null : null;
  const nextKey = nextEl ? board.tasks[nextEl.dataset.id!]?.orderKey ?? null : null;
  const ops: Op[] = [];
  for (const t of group) {
    let key: string;
    try {
      key = keyBetween(prevKey, nextKey);
    } catch {
      key = keyBetween(prevKey, null);
    }
    ops.push({ t: "task.move", id: t.id, storyId, column, orderKey: key });
    prevKey = key;
  }
  void sync.submitBatch(ops);
}

function sameAttachments(a: Attachment[], b: Attachment[]): boolean {
  return a.length === b.length && a.every((x, i) => x.url === b[i].url);
}

function distinctNames(): string[] {
  const seen = new Map<string, string>();
  for (const t of Object.values(board.tasks)) {
    const name = t.assignee.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function endKey(storyId: string, column: string): string {
  const last = cellTasks(board, storyId, column).at(-1);
  return keyBetween(last?.orderKey ?? null, null);
}

function rememberName(assignee: string): void {
  if (assignee && !myName()) {
    setMyName(assignee);
    sync.live({ t: "presence", name: assignee });
  }
}

function setUploadcareKey(key: string): boolean {
  emit({ t: "board.setKey", key });
  return true;
}

function openCreateTask(storyId: string, column: string): void {
  openPopup({
    kind: "task",
    mode: "create",
    initial: { assignee: myName() },
    names: distinctNames(),
    uploadcareKey: board.uploadcareKey,
    onSetKey: setUploadcareKey,
    onSave(r) {
      emit({
        t: "task.create",
        id: uid(),
        storyId,
        column,
        title: r.title,
        assignee: r.assignee,
        priority: r.priority,
        note: r.note,
        attachments: r.attachments,
        orderKey: endKey(storyId, column),
      });
      rememberName(r.assignee);
    },
  });
}

function openEditTask(id: string, focusAssignee = false): void {
  const t = board.tasks[id];
  if (!t) return;
  openPopup({
    kind: "task",
    mode: "edit",
    entityId: id,
    initial: { title: t.title, note: t.note, assignee: t.assignee, priority: t.priority, attachments: t.attachments },
    names: distinctNames(),
    focusAssignee,
    uploadcareKey: board.uploadcareKey,
    onSetKey: setUploadcareKey,
    onSave(r) {
      const set: Record<string, unknown> = {};
      if (r.title !== t.title) set.title = r.title;
      if (r.note !== t.note) set.note = r.note;
      if (r.assignee !== t.assignee) set.assignee = r.assignee;
      if (r.priority !== t.priority) set.priority = r.priority;
      if (!sameAttachments(r.attachments, t.attachments)) set.attachments = r.attachments;
      if (Object.keys(set).length) emit({ t: "task.set", id, set });
      rememberName(r.assignee);
    },
    onDelete() {
      emit({ t: "task.del", id });
    },
    onOpenChange(open) {
      sync.live({ t: "editing", id: open });
    },
  });
}

function openEditStory(id: string): void {
  const s = board.stories[id];
  if (!s) return;
  openPopup({
    kind: "story",
    mode: "edit",
    entityId: id,
    initial: { title: s.title, note: s.note, attachments: s.attachments },
    uploadcareKey: board.uploadcareKey,
    onSetKey: setUploadcareKey,
    onSave(r) {
      const set: Record<string, unknown> = {};
      if (r.title !== s.title) set.title = r.title;
      if (r.note !== s.note) set.note = r.note;
      if (!sameAttachments(r.attachments, s.attachments)) set.attachments = r.attachments;
      if (Object.keys(set).length) emit({ t: "story.set", id, set });
    },
    onDelete() {
      emit({ t: "story.del", id });
    },
  });
}

function mountStoryInput(): void {
  const cell = table.querySelector<HTMLElement>("td.newstory");
  if (!cell || cell.querySelector("input")) return;
  cell.textContent = "";
  const input = document.createElement("input");
  input.className = "storyinput";
  input.placeholder = "Story title";
  input.value = newStoryDraft ?? "";
  input.addEventListener("input", () => (newStoryDraft = input.value));
  input.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      const last = storiesSorted(board).at(-1);
      emit({ t: "story.create", id: uid(), title, orderKey: keyBetween(last?.orderKey ?? null, null) });
      newStoryDraft = "";
      input.value = "";
    } else if (e.code === "Escape") {
      newStoryDraft = null;
      render();
    }
  });
  input.addEventListener("blur", () => {
    if (rendering || !input.isConnected) return;
    newStoryDraft = null;
    render();
  });
  cell.append(input);
  input.focus();
}

function mountColInput(): void {
  const input = table.querySelector<HTMLInputElement>("input.colinput");
  if (!input) return;
  input.addEventListener("input", () => {
    if (colRename) colRename.draft = input.value;
  });
  input.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      e.preventDefault();
      commitColRename();
    } else if (e.code === "Escape") {
      colRename = null;
      render();
    }
  });
  input.addEventListener("blur", () => {
    if (rendering || !input.isConnected) return;
    commitColRename();
  });
  input.focus();
  input.select();
}

function commitColRename(): void {
  if (!colRename) return;
  const { id, draft } = colRename;
  colRename = null;
  const name = draft.trim();
  if (name) {
    if (editDraft) {
      const c = editDraft.columns.find((c) => c.id === id);
      if (c) c.name = name;
    } else {
      const c = board.columns.find((c) => c.id === id);
      if (c && c.name !== name) emit({ t: "col.set", id, name });
    }
  }
  render();
}

// ---------- edit-board mode: add/remove columns + slug rename, transactional ----------

const slugInput = $("slugedit") as HTMLInputElement;

function updateEditControls(): void {
  $("editlink").hidden = !!editDraft;
  ($("edittools") as HTMLElement).hidden = !editDraft;
  $("slugname").hidden = !!editDraft;
  slugInput.hidden = !editDraft;
}

window.addEventListener("resize", scheduleRender); // fair shares are computed in px per render

$("editlink").addEventListener("click", (e) => {
  e.preventDefault();
  editDraft = { columns: structuredClone(board.columns), slug };
  slugInput.value = slug;
  render();
});

$("editcancel").addEventListener("click", () => {
  editDraft = null;
  colRename = null;
  render();
});

$("editsave").addEventListener("click", () => {
  if (!editDraft) return;
  commitColRename();
  const draft = editDraft;
  editDraft = null;
  for (const c of board.columns) if (!draft.columns.some((d) => d.id === c.id)) emit({ t: "col.del", id: c.id });
  draft.columns.forEach((d, i) => {
    const existing = board.columns.find((c) => c.id === d.id);
    if (!existing) emit({ t: "col.add", id: d.id, name: d.name, index: i });
    else if (existing.name !== d.name) emit({ t: "col.set", id: d.id, name: d.name });
  });
  draft.columns.forEach((d, i) => {
    if (board.columns[i]?.id !== d.id) emit({ t: "col.move", id: d.id, index: i });
  });
  render();
  const newSlug = slugInput.value.trim();
  if (newSlug && newSlug !== slug) {
    if (!SLUG_RE.test(newSlug)) alert("Board names can use lowercase letters, digits and hyphens.");
    else if (!sync.live({ t: "rename", slug: newSlug })) alert("You're offline — reconnect to rename the board.");
  }
});

async function migrateTo(newSlug: string): Promise<void> {
  if (leaving) return;
  leaving = true;
  // move only what this device still has — a sibling tab may have migrated already,
  // and copying an absent key would clobber the value it just moved
  const token = boardToken(slug);
  if (token) setBoardToken(newSlug, token);
  const password = boardPassword(slug);
  if (password) setBoardPassword(newSlug, password);
  if (filter) setBoardFilter(newSlug, filter);
  if (doneDaysView) setDoneDays(newSlug, doneDaysView);
  setBoardToken(slug, null);
  setBoardPassword(slug, null);
  setBoardFilter(slug, "");
  setDoneDays(slug, 0);
  dropRecent(slug);
  touchRecent(newSlug);
  await cacheDel(slug);
  location.replace(`/b/${newSlug}`);
}

// ---------- table interactions ----------

table.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const hadSelection = selected.size > 0;
  const card = t.closest<HTMLElement>(".card");
  if (card && (e.metaKey || e.ctrlKey)) {
    const id = card.dataset.id!;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    lastSelected = selected.has(id) ? id : null;
    render();
    return;
  }
  if (selected.size && !card) {
    selected.clear();
    lastSelected = null;
    render();
  }
  if (t.closest("[data-act='newstory']")) {
    e.preventDefault();
    newStoryDraft = "";
    render();
    return;
  }
  if (t.closest("[data-act='addcol']") && editDraft) {
    const id = uid();
    const at = editDraft.columns.findIndex((c) => c.id === "todo") + 1;
    editDraft.columns.splice(at, 0, { id, name: "New column" });
    colRename = { id, draft: "New column" };
    render();
    return;
  }
  const rm = t.closest<HTMLElement>("[data-act='removecol']");
  if (rm && editDraft) {
    e.preventDefault();
    editDraft.columns = editDraft.columns.filter((c) => c.id !== rm.dataset.col);
    render();
    return;
  }
  const dm = t.closest<HTMLElement>("[data-act='donemenu']");
  if (dm) {
    openDoneMenu(dm);
    return;
  }
  const plus = t.closest<HTMLElement>("td.plus");
  if (plus) {
    openCreateTask(plus.dataset.story!, (editDraft?.columns ?? board.columns)[0].id);
    return;
  }
  // an empty cell shows a + on hover — a single click on it creates a card there
  // (unless the click was really "drop my selection")
  const empty = t.closest<HTMLElement>("td.cell.empty");
  if (empty && !hadSelection) {
    const cell = empty.querySelector<HTMLElement>(".cards")!;
    openCreateTask(cell.dataset.story!, cell.dataset.col!);
  }
});

table.addEventListener("dblclick", (e) => {
  const t = e.target as HTMLElement;
  const card = t.closest<HTMLElement>(".card");
  if (card) return openEditTask(card.dataset.id!);
  const box = t.closest<HTMLElement>(".storybox");
  if (box) return openEditStory(box.dataset.story!);
  const th = t.closest<HTMLElement>("th[data-col]");
  if (th && th.dataset.col !== "done") {
    const cols = editDraft?.columns ?? board.columns;
    const c = cols.find((x) => x.id === th.dataset.col);
    if (c) {
      colRename = { id: c.id, draft: c.name };
      render();
    }
    return;
  }
  const cards = t.closest<HTMLElement>("td.cell")?.querySelector<HTMLElement>(".cards");
  if (cards) openCreateTask(cards.dataset.story!, cards.dataset.col!);
});

table.addEventListener("mouseover", (e) => {
  const t = e.target as HTMLElement;
  hoveredCard = t.closest<HTMLElement>(".card")?.dataset.id ?? null;
  const cell = t.closest<HTMLElement>("td.cell")?.querySelector<HTMLElement>(".cards");
  hoveredCell = cell ? { story: cell.dataset.story!, col: cell.dataset.col! } : null;
});
table.addEventListener("mouseleave", () => {
  hoveredCard = null;
  hoveredCell = null;
});

function moveToEnd(task: Task, column: string): void {
  if (task.column === column) return;
  emit({ t: "task.move", id: task.id, storyId: task.storyId, column, orderKey: endKey(task.storyId, column) });
}

document.addEventListener("keydown", (e) => {
  if (popupOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
  if (e.code === "Escape" && (floatMenu || !menu.hidden)) {
    closeFloatMenu();
    menu.hidden = true;
    return;
  }
  if (e.code === "Escape" && selected.size) {
    selected.clear();
    lastSelected = null;
    render();
    return;
  }
  if (e.code === "KeyM") {
    if (myName()) setFilter(filter ? "" : myName());
    return;
  }
  if (e.code === "KeyC" && hoveredCell) {
    e.preventDefault();
    openCreateTask(hoveredCell.story, hoveredCell.col);
    return;
  }
  if (!hoveredCard) return;
  const task = board.tasks[hoveredCard];
  if (!task) return;
  if (e.code === "Delete" || e.code === "Backspace") {
    e.preventDefault();
    if (confirm("Delete this card?")) emit({ t: "task.del", id: task.id });
  } else if (e.code === "KeyE") {
    e.preventDefault(); // the shortcut key must not type into the field the popup focuses
    openEditTask(task.id);
  } else if (e.code === "KeyA") {
    e.preventDefault();
    if (myName()) emit({ t: "task.set", id: task.id, set: { assignee: myName() } });
    else openEditTask(task.id, true);
  } else if (e.code === "KeyI") {
    e.preventDefault();
    moveToEnd(task, "inprog");
  } else if (e.code === "KeyD") {
    e.preventDefault();
    moveToEnd(task, "done");
  }
});

// ---------- header ----------

function setFilter(name: string): void {
  filter = name;
  setBoardFilter(slug, name);
  render();
}

const menu = $("filtermenu");
$("filterchip").addEventListener("click", () => {
  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }
  menu.textContent = "";
  for (const n of ["", ...distinctNames()]) {
    const b = document.createElement("button");
    b.className = "mitem" + (n.toLowerCase() === filter.toLowerCase() ? " current" : "");
    b.textContent = n || "Everyone";
    b.onclick = () => {
      setFilter(n);
      menu.hidden = true;
    };
    menu.append(b);
  }
  menu.hidden = false;
});

function openDoneMenu(btn: HTMLElement): void {
  closeFloatMenu();
  const m = document.createElement("div");
  m.className = "menu float";
  const options: [string, number][] = [
    ["Show all", 0],
    ["Last day", 1],
    ["Last week", 7],
    ["Last month", 31],
  ];
  for (const [label, days] of options) {
    const b = document.createElement("button");
    b.className = "mitem" + (doneDaysView === days ? " current" : "");
    b.textContent = label;
    b.onclick = () => {
      doneDaysView = days;
      setDoneDays(slug, days);
      closeFloatMenu();
      render();
    };
    m.append(b);
  }
  const del = document.createElement("button");
  del.className = "mitem danger";
  del.textContent = "Delete all done tasks…";
  del.onclick = () => {
    closeFloatMenu();
    const done = Object.values(board.tasks).filter((t) => t.column === "done");
    if (!done.length) return;
    if (confirm(`Delete ${done.length} done ${done.length === 1 ? "task" : "tasks"}? This cannot be undone.`))
      void sync.submitBatch(done.map((t) => ({ t: "task.del", id: t.id }) as Op));
  };
  m.append(del);
  const r = btn.getBoundingClientRect();
  m.style.position = "fixed";
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.min(r.left, innerWidth - 200)}px`;
  document.body.append(m);
  floatMenu = m;
}

function closeFloatMenu(): void {
  floatMenu?.remove();
  floatMenu = null;
}

document.addEventListener("mousedown", (e) => {
  const t = e.target as HTMLElement;
  if (!menu.hidden && !t.closest(".filterwrap")) menu.hidden = true;
  if (floatMenu && !t.closest(".menu.float")) closeFloatMenu();
});

function renderPresence(): void {
  const box = $("presence");
  box.textContent = "";
  const names = new Map<string, string>();
  for (const u of presence) {
    const n = u.name.trim();
    if (n && !names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
  }
  const list = [...names.values()];
  const boardColors = colorMap(distinctNames());
  for (const n of list.slice(0, 6)) {
    const av = document.createElement("div");
    av.className = "avatar";
    av.title = n;
    av.textContent = n[0].toUpperCase();
    av.style.background = (boardColors.get(n.toLowerCase()) ?? colorFor(n)).c;
    box.append(av);
  }
  if (list.length > 6) {
    const more = document.createElement("div");
    more.className = "avatar more";
    more.textContent = `+${list.length - 6}`;
    box.append(more);
  }
}

function updatePwLabel(): void {
  $("pwlabel").textContent = isProtected ? "Change password…" : "Set password…";
}

$("themetoggle").addEventListener("click", () => setTheme(effectiveDark() ? "light" : "dark"));

$("setpassword").addEventListener("click", () => {
  openPasswordDialog({
    isProtected,
    currentPassword: boardPassword(slug),
    onSet(password) {
      pendingPassword = password;
      return sync.live({ t: "setPassword", password });
    },
    onRemove() {
      return sync.live({ t: "removePassword" });
    },
  });
});

$("exportjson").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(board, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `skrami-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("deleteboard").addEventListener("click", () => {
  if (!confirm("Delete this board? It becomes inaccessible immediately and is permanently removed after 30 days.")) return;
  userDeleted = true;
  emit({ t: "board.del" });
  setTimeout(() => void leaveBoard(), 1500); // offline fallback — the queued op still lands on next open
});

async function leaveBoard(message?: string): Promise<void> {
  if (leaving) return;
  leaving = true;
  await cacheDel(slug);
  dropRecent(slug);
  setBoardToken(slug, null);
  setBoardPassword(slug, null);
  if (message) alert(message);
  location.replace("/");
}

// ---------- boot ----------

const cached = await cacheGet(slug);
if (cached) board = cached.board;
render();
await sync.start(board, cached?.version ?? 0, boardToken(slug));
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
