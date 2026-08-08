const LOCK_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const UNLOCK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

// Full-page gate: replaces the board entirely until the password checks out.
// The field is plain text, never masked — a mistyped invisible password locks the team out.
export function showUnlockGate(slug: string, onUnlocked: (token: string, password: string) => void): void {
  if (document.getElementById("gate")) return;
  const gate = document.createElement("div");
  gate.id = "gate";
  gate.innerHTML = `
    <header>
      <div><span class="title">Skrami</span> <span class="slug">/b/${slug}</span></div>
    </header>
    <main class="gate">
      <span class="glock">${LOCK_ICON}</span>
      <p class="gline">This board is password-protected.</p>
      <form class="grow">
        <input type="text" placeholder="Password" aria-label="Board password" autocomplete="off">
        <button class="gbtn" type="submit">Open</button>
      </form>
      <p class="gerr" hidden></p>
    </main>`;
  document.body.append(gate);
  const form = gate.querySelector("form")!;
  const input = gate.querySelector("input")!;
  const err = gate.querySelector<HTMLElement>(".gerr")!;
  input.focus();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      const password = input.value;
      if (!password) return;
      const res = await fetch(`/b/${slug}/auth`, { method: "POST", body: JSON.stringify({ password }) }).catch(
        () => null,
      );
      if (res?.ok) {
        const { token } = (await res.json()) as { token: string };
        gate.remove();
        onUnlocked(token, password);
        return;
      }
      err.hidden = false;
      gate.classList.add("wrong");
      if (res?.status === 429) {
        const { retryAfter } = (await res.json()) as { retryAfter: number };
        err.textContent = `Too many attempts — try again in ${retryAfter}s.`;
      } else {
        err.textContent = res ? "Wrong password." : "You're offline.";
      }
    })();
  });
}

// Set/change dialog in the unified-popup language. onSet returns false when the
// socket is down — auth changes are live-only, so the dialog stays open and says so.
export function openPasswordDialog(o: {
  isProtected: boolean;
  currentPassword: string;
  onSet(password: string): boolean;
  onRemove(): boolean;
}): void {
  const root = document.getElementById("popup-root")!;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const pop = document.createElement("div");
  pop.className = "pop password";
  pop.innerHTML = `
    <div class="pbar"></div>
    ${o.isProtected ? `<button class="punlock" title="Remove password">${UNLOCK_ICON}</button>` : ""}
    <div class="phead">${o.isProtected ? "Change password" : "Protect this board"}</div>
    <div class="prow"><input type="text" placeholder="Password" aria-label="Password" autocomplete="off"></div>
    <p class="phint">${
      o.isProtected
        ? "That's the current password. Type a new one — everyone else will need it."
        : "Anyone opening this board will be asked for it.<br>There is no reset — save it somewhere."
    }</p>
    <div class="acts">
      <button class="abtn create">✓ ${o.isProtected ? "Change password" : "Set password"}</button>
      <button class="abtn cancel">✕ Cancel</button>
    </div>`;

  const input = pop.querySelector("input")!;
  const hint = pop.querySelector<HTMLElement>(".phint")!;
  input.value = o.currentPassword;

  function close(): void {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    pop.remove();
  }

  function offline(): void {
    hint.textContent = "You're offline — reconnect to change the password.";
  }

  function save(): void {
    const password = input.value.trim();
    if (!password || (o.isProtected && password === o.currentPassword)) return close();
    if (o.onSet(password)) close();
    else offline();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (e.code === "Enter") {
      e.preventDefault();
      save();
    }
  }
  document.addEventListener("keydown", onKey, true);

  pop.querySelector<HTMLElement>(".abtn.create")!.onclick = save;
  pop.querySelector<HTMLElement>(".abtn.cancel")!.onclick = close;
  overlay.addEventListener("mousedown", close);
  pop.querySelector<HTMLElement>(".punlock")?.addEventListener("click", () => {
    if (!confirm("Remove the password? Anyone with the link will be able to open this board.")) return;
    if (o.onRemove()) close();
    else offline();
  });

  root.append(overlay, pop);
  input.focus();
  input.select();
}
