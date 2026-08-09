import { colorFor, colorMap } from "../shared/color";
import { ATTACHMENTS_MAX, NOTE_MAX, type Attachment } from "../shared/types";
import { API_KEYS_URL, thumbUrl, uploadFile } from "./uploadcare";

const TRASH_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
const FILE_ICON =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

export type PopupResult = {
  title: string;
  note: string;
  assignee: string;
  priority: boolean;
  attachments: Attachment[];
};
export type RemoteSet = Partial<PopupResult>;

export type PopupOpts = {
  kind: "story" | "task";
  mode: "create" | "edit";
  entityId?: string;
  initial: Partial<PopupResult>;
  names?: string[];
  focusAssignee?: boolean;
  uploadcareKey?: string;
  onSave(r: PopupResult): void;
  onDelete?(): void;
  onOpenChange?(id: string | null): void; // presence: "who is editing this card"
  onSetKey?(key: string): boolean; // false = offline, key not stored
};

type Controller = {
  entityId: string | null;
  remoteUpdate(set: RemoteSet, editor: string): void;
  remoteDelete(): void;
};

let current: Controller | null = null;

export function popupOpen(): boolean {
  return current !== null;
}

export function popupEntity(): string | null {
  return current?.entityId ?? null;
}

export function popupRemoteUpdate(id: string, set: RemoteSet, editor: string): void {
  if (current?.entityId === id) current.remoteUpdate(set, editor);
}

export function popupRemoteDelete(id: string): void {
  if (current?.entityId === id) current.remoteDelete();
}

export function openPopup(o: PopupOpts): void {
  if (current) return;

  const root = document.getElementById("popup-root")!;
  const overlay = div("overlay");
  const pop = div(`pop ${o.kind} ${o.mode}`);
  const pbar = div("pbar");
  pop.append(pbar);

  if (o.mode === "edit" && o.onDelete) {
    const trash = document.createElement("button");
    trash.className = "ptrash";
    trash.title = o.kind === "story" ? "Delete story" : "Delete card";
    trash.innerHTML = TRASH_ICON;
    trash.onclick = () => {
      if (confirm(o.kind === "story" ? "Delete this story and all its cards?" : "Delete this card?")) {
        o.onDelete!();
        close();
      }
    };
    pop.append(trash);
  }

  const ttl = document.createElement("textarea");
  ttl.className = "ttl";
  ttl.rows = 2;
  ttl.value = o.initial.title ?? "";
  ttl.setAttribute("aria-label", o.kind === "story" ? "Story title" : "Card text");
  pop.append(ttl);

  // note shows clickable links at rest and flips to plain text while editing
  const note = div("note");
  note.contentEditable = "true";
  note.setAttribute("aria-label", "Note");
  linkifyInto(note, o.initial.note ?? "");
  note.addEventListener("focus", () => {
    const text = note.innerText;
    note.textContent = text.replace(/\n$/, "");
  });
  note.addEventListener("blur", () => linkifyInto(note, note.innerText));
  pop.append(note);

  let attachments: Attachment[] = [...(o.initial.attachments ?? [])];
  let uploadcareKey = o.uploadcareKey ?? "";
  const files = div("files");
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener("change", () => {
    const chosen = [...(picker.files ?? [])];
    picker.value = "";
    void addFiles(chosen);
  });
  pop.append(files, picker);

  // OS file drags can land anywhere on the dialog, not just through the picker
  const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let dragDepth = 0;
  pop.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  pop.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    pop.classList.add("dropping");
  });
  pop.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      pop.classList.remove("dropping");
    }
  });
  pop.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    pop.classList.remove("dropping");
    const dropped = [...(e.dataTransfer?.files ?? [])];
    if (!dropped.length) return;
    if (!uploadcareKey) return askForKey(); // can't upload yet — surface the key prompt instead of eating the drop
    void addFiles(dropped);
  });

  // ⌘V with a screenshot or a Finder-copied file lands like a drop; text pastes stay native
  function onPaste(e: ClipboardEvent): void {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (!pasted.length) return;
    e.preventDefault();
    if (!uploadcareKey) return askForKey();
    void addFiles(pasted);
  }
  document.addEventListener("paste", onPaste);

  async function addFiles(chosen: File[]): Promise<void> {
    const room = ATTACHMENTS_MAX - attachments.length;
    if (room <= 0) return renderFiles(`Up to ${ATTACHMENTS_MAX} attachments.`);
    const batch = chosen.slice(0, room);
    const dropped = chosen.length - batch.length;
    renderFiles(`Uploading ${batch.length}…`);
    const results = await Promise.allSettled(batch.map((f) => uploadFile(f, uploadcareKey)));
    for (const r of results) if (r.status === "fulfilled") attachments.push(r.value);
    const failed = results.filter((r) => r.status === "rejected").length;
    touched.add("attachments");
    renderFiles(
      failed ? `${failed} upload${failed > 1 ? "s" : ""} failed — check your connection.` : dropped ? `Only ${ATTACHMENTS_MAX} attachments per card.` : "",
    );
  }

  function renderFiles(status = ""): void {
    files.textContent = "";
    attachments.forEach((a, i) => {
      const wrap = div("fitem");
      const open = document.createElement("a");
      open.href = a.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.title = a.name;
      if (a.isImage) {
        const img = document.createElement("img");
        img.className = "fthumb";
        img.src = thumbUrl(a.url, 112, 84);
        img.alt = a.name;
        open.append(img);
      } else {
        open.className = "fchip";
        open.innerHTML = FILE_ICON;
        open.append(a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name);
      }
      const rm = document.createElement("button");
      rm.className = "frm";
      rm.title = "Remove attachment";
      rm.textContent = "✕";
      rm.onclick = () => {
        attachments.splice(i, 1);
        touched.add("attachments");
        renderFiles();
      };
      wrap.append(open, rm);
      files.append(wrap);
    });
    if (attachments.length < ATTACHMENTS_MAX) {
      const add = document.createElement("button");
      add.className = "fadd";
      add.title = "Attach";
      add.textContent = "＋";
      // no key on this board yet → explain instead of opening an empty file dialog
      add.onclick = () => (uploadcareKey ? picker.click() : askForKey());
      files.append(add);
    }
    if (status) {
      const s = div("fstatus");
      s.textContent = status;
      files.append(s);
    }
  }

  // Files go straight to the board's own Uploadcare account, so the board needs a
  // key before the first attachment. Copy follows skryn: name it, link it, ask for
  // the key, point at the page that has it.
  function saveKey(input: HTMLInputElement): void {
    const k = input.value.trim();
    if (!k) return input.focus();
    if (!o.onSetKey || !o.onSetKey(k)) {
      renderFiles("You're offline — reconnect to save the key.");
      return;
    }
    uploadcareKey = k;
    renderFiles();
    picker.click();
  }

  function askForKey(): void {
    // prompt already open: "+" acts as Save for the typed key instead of doing nothing
    const prior = files.querySelector<HTMLInputElement>(".fkey input");
    if (prior) return saveKey(prior);
    const box = div("fkey");
    box.innerHTML = `
      <p>Attachments upload to <a href="https://uploadcare.com" target="_blank" rel="noopener">Uploadcare</a>.
      This board needs its own public key — it's stored with the board, so everyone here can attach files.</p>
      <div class="fkeyrow">
        <input type="text" placeholder="Public key" aria-label="Uploadcare public key" autocomplete="off">
        <button class="fkeysave">Save</button>
      </div>
      <a class="fkeylink" href="${API_KEYS_URL}" target="_blank" rel="noopener">Get API key ↗</a>`;
    files.append(box);
    const input = box.querySelector("input")!;
    box.querySelector<HTMLElement>(".fkeysave")!.onclick = () => saveKey(input);
    input.addEventListener("keydown", (e) => {
      if (e.code === "Enter") {
        e.preventDefault();
        saveKey(input);
      }
    });
    input.focus();
  }

  let assignee: HTMLInputElement | undefined;
  let prio = o.initial.priority ?? false;
  let pflag: HTMLButtonElement | undefined;
  const nameColors = colorMap(o.names ?? []);
  const colorOf = (n: string) => nameColors.get(n.trim().toLowerCase()) ?? colorFor(n);
  // the name dropdown, coordinated with onKey (which owns Esc/Enter/arrows in capture)
  const combo = { open: false, move: (_d: number) => {}, pick: (): boolean => false, close: () => {} };
  if (o.kind === "task") {
    const arow = div("arow");
    assignee = document.createElement("input");
    assignee.placeholder = "UNASSIGNED";
    assignee.setAttribute("aria-label", "Assignee");
    assignee.value = o.initial.assignee ?? "";
    assignee.addEventListener("input", paint);
    pflag = document.createElement("button");
    pflag.className = "pflag" + (prio ? " on" : "");
    pflag.title = "Priority";
    pflag.textContent = "⚑";
    pflag.onclick = () => {
      prio = !prio;
      pflag!.classList.toggle("on", prio);
      touched.add("priority");
      paint();
    };

    // clicking the field selects the whole name, so typing replaces it
    let selectPending = false;
    assignee.addEventListener("focus", () => {
      selectPending = true;
      assignee!.select();
    });
    assignee.addEventListener("mouseup", (e) => {
      if (selectPending) e.preventDefault(); // don't let the click collapse the fresh selection
      selectPending = false;
    });

    // all known names on focus, filtered while typing — the datalist, hand-rolled
    const list = div("adrop");
    list.hidden = true;
    let hi = -1;
    const closeList = () => {
      list.hidden = true;
      combo.open = false;
      hi = -1;
    };
    const renderList = (q: string) => {
      const opts = (o.names ?? []).filter((n) => n.toLowerCase().includes(q));
      list.textContent = "";
      hi = -1;
      if (!opts.length) return closeList();
      for (const n of opts) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "aopt";
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = colorOf(n).a;
        b.append(dot, document.createTextNode(n));
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the input focused
        b.addEventListener("click", () => {
          assignee!.value = n;
          assignee!.dispatchEvent(new Event("input"));
          closeList();
        });
        list.append(b);
      }
      list.hidden = false;
      combo.open = true;
    };
    combo.move = (d) => {
      const opts = [...list.children] as HTMLElement[];
      if (!opts.length) return;
      hi = (hi + d + opts.length) % opts.length;
      opts.forEach((el, i) => el.classList.toggle("hi", i === hi));
    };
    combo.pick = () => {
      const el = list.children[hi] as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    };
    combo.close = closeList;
    assignee.addEventListener("focus", () => renderList(""));
    assignee.addEventListener("input", () => renderList(assignee!.value.trim().toLowerCase()));
    assignee.addEventListener("blur", () => closeList());

    arow.append(assignee, pflag, list);
    pop.append(arow);
  }

  const notice = div("pnotice");
  notice.hidden = true;
  pop.append(notice);

  const acts = div("acts");
  const okBtn = document.createElement("button");
  okBtn.className = "abtn create";
  okBtn.textContent = o.mode === "create" ? "✓ Create" : "✓ Save";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "abtn cancel";
  cancelBtn.textContent = "✕ Cancel";
  acts.append(okBtn, cancelBtn);
  pop.append(acts);

  const touched = new Set<string>();
  ttl.addEventListener("input", () => touched.add("title"));
  note.addEventListener("input", () => touched.add("note"));
  assignee?.addEventListener("input", () => touched.add("assignee"));

  function paint(): void {
    const a = assignee?.value.trim() ?? "";
    pbar.style.background = prio ? "var(--prio)" : a ? colorOf(a).a : "";
  }
  paint();
  renderFiles();

  function save(): void {
    const r: PopupResult = {
      title: ttl.value.trim(),
      note: note.innerText.trim().slice(0, NOTE_MAX),
      assignee: assignee?.value.trim() ?? "",
      priority: prio,
      attachments,
    };
    if (!r.title && o.mode === "create") return close(); // an untouched create just closes
    if (!r.title) r.title = o.initial.title ?? "";
    close();
    o.onSave(r);
  }

  function close(): void {
    current = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("paste", onPaste);
    overlay.remove();
    pop.remove();
    o.onOpenChange?.(null);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (combo.open) return combo.close(); // the dropdown eats the first Esc, not the dialog
      if (!touched.size || confirm("Discard changes?")) close();
      return;
    }
    if ((e.code === "ArrowDown" || e.code === "ArrowUp") && e.target === assignee && combo.open) {
      e.preventDefault();
      combo.move(e.code === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.code === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
      return;
    }
    if (e.code === "Enter" && !e.shiftKey && e.target === ttl && o.mode === "create") {
      e.preventDefault();
      save();
      return;
    }
    if (e.code === "Enter" && assignee && e.target === assignee) {
      e.preventDefault();
      if (combo.pick()) return; // a highlighted name is a choice, not a save
      save();
    }
  }
  document.addEventListener("keydown", onKey, true);

  okBtn.onclick = save;
  cancelBtn.onclick = close; // a deliberate click discards without confirmation
  const openedAt = performance.now();
  overlay.addEventListener("mousedown", () => {
    if (performance.now() - openedAt < 300) return; // the tail of a double-click, not a click-outside
    if (touched.size) save();
    else close();
  }); // click-outside saves

  current = {
    entityId: o.entityId ?? null,
    // remote ops land in the open dialog: untouched fields update in place,
    // a touched field turns into a one-line notice instead of a silent overwrite
    remoteUpdate(set, editor) {
      let conflict = false;
      for (const [field, value] of Object.entries(set)) {
        if (value === undefined) continue;
        if (touched.has(field)) {
          conflict = true;
          continue;
        }
        if (field === "title") ttl.value = value as string;
        else if (field === "note" && document.activeElement !== note) linkifyInto(note, value as string);
        else if (field === "note") note.textContent = value as string;
        else if (field === "assignee" && assignee) assignee.value = value as string;
        else if (field === "attachments") {
          attachments = [...(value as Attachment[])];
          renderFiles();
        } else if (field === "priority" && pflag) {
          prio = value as boolean;
          pflag.classList.toggle("on", prio);
        }
      }
      paint();
      if (conflict) {
        notice.textContent = `${editor || "Someone"} just edited this ${o.kind === "story" ? "story" : "card"}`;
        notice.hidden = false;
      }
    },
    remoteDelete: close,
  };

  root.append(overlay, pop);
  (o.focusAssignee && assignee ? assignee : ttl).focus();
  if (o.entityId) o.onOpenChange?.(o.entityId);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/g;

function linkifyInto(el: HTMLElement, text: string): void {
  el.textContent = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) el.append(text.slice(last, m.index));
    const a = document.createElement("a");
    a.href = m[0];
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = m[0];
    a.contentEditable = "false";
    el.append(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

function div(cls: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}
