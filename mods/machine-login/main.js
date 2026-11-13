// Machine login: a slim strip that watches saved SSH machines and offers a
// Login button when one needs authentication. The Machines label opens a
// dialog with every machine and the same actions. The actual login runs in a
// normal local terminal, because SSH must be able to ask for a password or a
// code. No credentials are read or stored here.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, notify, run, theme, props, openOverlay, closeOverlay, spaces } from "herdr";

const shellArg = (value) => /^[a-z0-9_@%+=:,./-]+$/i.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
const commandFor = (machine) => `hc machine login ${shellArg(machine)}`;

// A new local space keeps the login visible and leaves the machine being
// viewed alone. Keeping the terminal open after the command means a failed
// login stays readable.
function loginArgs(machine) {
  const command = commandFor(machine);
  return {
    name: `${machine} login`,
    tab: "login",
    machine: "",
    argv: ["sh", "-c", `${command}; code=$?; printf '\\nLogin exited %s. Press Enter to close.\\n' "$code"; read _`],
  };
}

// The optional permanent fix: install this computer's public key, then log in
// once. Only public keys are read; ssh-copy-id writes them to the machine's
// authorized_keys. The terminal asks for the password itself.
function keyArgs(machine, target) {
  const line = [
    'key=$(ls "$HOME"/.ssh/id_ed25519.pub "$HOME"/.ssh/id_rsa.pub 2>/dev/null | head -n 1)',
    'status=1',
    'if [ -z "$key" ]; then',
    '  echo "No public key found in ~/.ssh (looked for id_ed25519.pub and id_rsa.pub)."',
    'elif ! command -v ssh-copy-id >/dev/null 2>&1; then',
    '  echo "ssh-copy-id is not installed."',
    `elif ssh-copy-id -i "$key" ${shellArg(target)}; then`,
    `  hc machine login ${shellArg(machine)}`,
    '  status=$?',
    'else',
    '  status=$?',
    '  echo "ssh-copy-id did not finish; nothing was changed."',
    'fi',
    `printf '\\nInstall key exited %s. Press Enter to close.\\n' "$status"`,
    'read _',
  ].join("\n");
  return {
    name: `${machine} key`,
    tab: "key",
    machine: "",
    argv: ["sh", "-c", line],
  };
}

export default class MachineLogin extends View {
  init(_props, cx) {
    const p = props();
    this.overlay = p?.overlay ?? null;
    this.machines = [];
    this.error = null;
    this.loading = true;
    this.copied = null;
    this.notified = {}; // machine -> when its login notice was last posted
    this.filter = "";
    this.at = null;
    if (this.overlay) {
      this.handle = cx.focus_handle();
      this.input = InputState.new({ placeholder: "Search machines, spaces or tabs…" });
      this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.openSelected());
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    cx.timer.every(5000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || "hc machine ls failed");
        const data = JSON.parse(r.stdout);
        this.machines = (data.machines ?? []).filter((m) => !m.temporary);
        this.error = null;
        if (!this.overlay) this.notifyLogins();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  // One toast per machine per 10 minutes while it still needs a login. The
  // toast's action is an ordinary `space.new`, so it works with the shipped
  // toast and with a custom one that runs actions.
  notifyLogins() {
    const now = Date.now();
    for (const m of this.machines) {
      if (m.state !== "needs_login") {
        delete this.notified[m.name];
        continue;
      }
      if (now - (this.notified[m.name] ?? 0) < 10 * 60 * 1000) continue;
      this.notified[m.name] = now;
      notify({
        title: `${m.name} needs a login`,
        body: "Click here to log in in a terminal.",
        level: "error",
        action: { name: "space.new", args: loginArgs(m.name) },
      });
    }
  }

  openList() {
    openOverlay({ mod: "machine-login", kind: "dialog", width: 760, height: 620 });
  }

  spacesFor(machine) {
    return spaces().filter((s) => (s.machine ?? null) === (machine ?? null));
  }

  buildView() {
    const q = this.filter.trim().toLowerCase();
    const ordered = [
      ...this.machines.filter((m) => m.state !== "connected"),
      ...this.machines.filter((m) => m.state === "connected"),
    ];
    const out = [];
    for (const m of ordered) {
      const machineHit = !q || `${m.name} ${m.target ?? ""} ${m.state ?? ""}`.toLowerCase().includes(q);
      const spaces = [];
      for (const s of this.spacesFor(m.name)) {
        const spaceHit = !q || machineHit || s.name.toLowerCase().includes(q);
        const tabs = (s.tabs ?? []).filter((tab) => !q || machineHit || spaceHit || (tab.name ?? "").toLowerCase().includes(q));
        if (!spaceHit && !tabs.length) continue;
        spaces.push({ s, tabs });
      }
      if (q && !machineHit && !spaces.length) continue;
      out.push({ m, spaces });
    }
    return out;
  }

  pickable() {
    const out = [];
    for (const group of this.buildView()) {
      for (const { s, tabs } of group.spaces) {
        out.push({ kind: "space", m: group.m, s });
        for (const tab of tabs) out.push({ kind: "tab", m: group.m, s, tab });
      }
    }
    return out;
  }

  keyOf(row) {
    return row.kind === "tab" ? row.tab.id : row.s.id;
  }

  openItem(row) {
    if (!row) return;
    if (row.kind === "space") run("space.select", { id: row.s.id });
    else if (row.kind === "tab") run("tab.select", { id: row.tab.id });
    this.close();
  }

  openSelected() {
    const list = this.pickable();
    if (!list.length) return;
    this.openItem(list[Math.max(0, Math.min(this.at ?? 0, list.length - 1))]);
  }

  close() {
    try {
      if (this.overlay) closeOverlay(this.overlay);
      else closeOverlay();
    } catch {
      try { closeOverlay(); } catch {}
    }
  }

  button(id, label, primary, tooltip, onClick) {
    return div().id(id).flex_none().h(26).px(9).flex().items_center().rounded(5)
      .bg(primary ? theme().solid : theme().raised)
      .text_color(primary ? theme().solid_foreground : theme().foreground)
      .text_size(11).font_medium().cursor_pointer()
      .hover((s) => primary ? s.opacity(0.88) : s.bg(theme().hover))
      .tooltip(tooltip)
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(label);
  }

  row(m, t) {
    const state = String(m.state ?? "unknown").replace(/_/g, " ");
    const login = m.state === "needs_login";
    const reason = m.why ? ` (${m.why})` : "";
    const command = commandFor(m.name);
    return h_flex().flex_none().gap(6).items_center()
      .child(div().size(6).rounded(3).flex_none().bg(login ? t.blocked : t.dim))
      .child(div().max_w(140).truncate().text_color(t.foreground).child(m.name))
      .child(div().flex_none().text_size(11).text_color(login ? t.blocked : t.dim).child(state))
      .child(this.button(`machine-login-${m.name}`, login ? "Login" : "Retry", true,
        `${m.target ?? m.name} is ${state}${reason}. Opens a terminal here and runs ${command}.`,
        () => run("space.new", loginArgs(m.name))))
      .child(this.button(`machine-login-copy-${m.name}`, this.copied === m.name ? "Copied" : "Copy", false,
        command,
        (_e, cx) => { cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); }))
      .child(div().w(1).h(16).flex_none().bg(t.border));
  }

  renderStrip(t, cx) {
    const attention = this.machines.filter((m) => m.state !== "connected");
    const connected = this.machines.filter((m) => m.state === "connected");
    return v_flex().size_full().px(10).bg(t.chrome).text_size(12).text_color(t.muted)
      .child(h_flex().size_full().gap(8).items_center()
        .child(div().id("machine-login-open").flex_none().font_medium().text_color(t.foreground).cursor_pointer()
          .hover((s) => s.text_color(t.accent)).tooltip("All machines")
          .on_click((_e, cx) => { cx.stop_propagation(); this.openList(); })
          .child("Machines"))
        .when(this.loading, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("checking…")))
        .when(!this.loading && this.error, (el) => el.child(div().flex_1().min_w(0).truncate()
          .text_color(t.blocked).tooltip(this.error).child(`Couldn't check machines: ${this.error}`)))
        .when(!this.loading && !this.error && attention.length === 0, (el) => el.child(h_flex().flex_1().gap(5).items_center()
          .child(div().size(6).rounded(3).flex_none().bg(connected.length ? t.ansi2 : t.dim))
          .child(div().text_size(11).text_color(t.dim).child(connected.length ? `${connected.length} connected` : "none added"))))
        .when(!this.loading && !this.error && attention.length > 0, (el) => el.child(h_flex().flex_1().min_w(0).gap(8).items_center().overflow_x_scrollbar()
          .children(attention.map((m) => this.row(m, t)))))
        .child(div().id("machine-login-refresh").flex_none().size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Check machines now")
          .on_click((_e, cx) => { this.loading = true; this.refresh(cx); })
          .child("↻")));
  }

  machineHeader(m, t, spaceCount) {
    const state = String(m.state ?? "unknown").replace(/_/g, " ");
    const login = m.state === "needs_login";
    const reason = m.why ? ` (${m.why})` : "";
    const command = commandFor(m.name);
    const first = this.spacesFor(m.name)[0];
    return h_flex().gap(7).items_center()
      .child(div().size(7).rounded(4).flex_none().bg(login ? t.blocked : m.state === "connected" ? t.ansi2 : t.dim))
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(m.name))
      .child(div().text_size(11).text_color(login ? t.blocked : t.dim).child(state))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(reason || m.target || "")
        .child(m.target ? `${m.target}${reason}` : "no target"))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${spaceCount} space${spaceCount === 1 ? "" : "s"}`))
      .when(Boolean(first), (el) => el.child(this.button(`machine-login-go-${m.name}`, "Go", false,
        `Show the first space on ${m.name}.`,
        () => this.openItem({ kind: "space", m, s: first }))))
      .when(m.state !== "connected", (el) => el.child(this.button(`machine-login-${m.name}`, login ? "Login" : "Retry", true,
        `Open a terminal here and run ${command}.`,
        () => { run("space.new", loginArgs(m.name)); this.close(); })))
      .when(login && m.target && !m.via, (el) => el.child(this.button(`machine-login-key-${m.name}`, "Install key…", false,
        "Install the first of ~/.ssh/id_ed25519.pub or id_rsa.pub on the machine, then log in. Reads only public keys.",
        () => { run("space.new", keyArgs(m.name, m.target)); this.close(); })))
      .child(this.button(`machine-login-copy-${m.name}`, this.copied === m.name ? "Copied" : "Copy", false,
        command,
        (_e, cx) => { cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); }));
  }

  spaceRow(row, t, selected) {
    const s = row.s;
    const status = s.status ? (t[s.status] ?? t.dim) : t.dim;
    const count = s.tabs?.length ?? 0;
    return h_flex().id(`ml-space-${s.id}`).h(30).pl(10).pr(8).gap(7).items_center().rounded(6)
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((e) => e.bg(t.hover)))
      .cursor_pointer().on_click((e, cx) => { e.stop_propagation(); this.openItem(row); })
      .child(div().size(5).rounded(3).flex_none().bg(status))
      .child(div().min_w(0).truncate().text_size(12.5).text_color(selected ? t.foreground : t.muted).child(s.name))
      .child(div().flex_1())
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${count} tab${count === 1 ? "" : "s"}`));
  }

  tabRow(row, t, selected) {
    const tab = row.tab;
    const status = row.s.status ? (t[row.s.status] ?? t.dim) : t.dim;
    return h_flex().id(`ml-tab-${tab.id}`).h(26).pl(28).pr(8).gap(7).items_center().rounded(5)
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((e) => e.bg(t.hover)))
      .cursor_pointer().on_click((e, cx) => { e.stop_propagation(); this.openItem(row); })
      .child(div().size(4).rounded(2).flex_none().bg(status))
      .child(div().min_w(0).truncate().text_size(12).text_color(selected ? t.foreground : t.dim).child(tab.name ?? "tab"))
      .child(div().flex_1())
      .when(tab.active, (el) => el.child(div().text_size(10).text_color(t.dim).child("shown")));
  }

  machineBlock(group, t, selKey) {
    const { m, spaces } = group;
    return v_flex().gap(3).p(9).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(this.machineHeader(m, t, spaces.length))
      .when(spaces.length === 0, (el) => el.child(div().pl(12).text_size(11).text_color(t.dim)
        .child(m.state === "connected" ? "No spaces on this screen." : "Log in to see its spaces.")))
      .children(spaces.map(({ s, tabs }) => {
        const spaceItem = { kind: "space", m, s };
        return v_flex().gap(1)
          .child(this.spaceRow(spaceItem, t, selKey === this.keyOf(spaceItem)))
          .children(tabs.map((tab) => {
            const tabItem = { kind: "tab", m, s, tab };
            return this.tabRow(tabItem, t, selKey === this.keyOf(tabItem));
          }));
      }));
  }

  renderList(t, cx) {
    const groups = this.buildView();
    const pickable = this.pickable();
    if (this.at == null) {
      const activeTab = pickable.findIndex((r) => r.kind === "tab" && r.tab.active);
      const activeSpace = pickable.findIndex((r) => r.kind === "space" && r.s.active);
      this.at = activeTab >= 0 ? activeTab : activeSpace >= 0 ? activeSpace : 0;
    }
    this.at = Math.max(0, Math.min(this.at ?? 0, Math.max(0, pickable.length - 1)));
    const selected = pickable[this.at];
    const selKey = selected ? this.keyOf(selected) : null;
    const attention = this.machines.filter((m) => m.state !== "connected").length;
    const connected = this.machines.length - attention;
    return v_flex().size_full().p(16).gap(10).bg(t.popover).text_color(t.muted)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.close(); return; }
        if (e.key !== "up" && e.key !== "down") return;
        const n = pickable.length;
        if (!n) return;
        this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(17).font_semibold().text_color(t.foreground).child("Machines"))
        .child(div().text_size(12).text_color(t.dim).child(`${connected} connected${attention ? ` · ${attention} need attention` : ""}`))
        .child(div().flex_1())
        .child(div().id("machine-login-list-refresh").size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Check machines now")
          .on_click((_e, cx) => { this.loading = true; this.refresh(cx); })
          .child("↻"))
        .child(div().id("machine-login-close").size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Close")
          .on_click((_e, cx) => { cx.stop_propagation(); this.close(); })
          .child("×")))
      .child(h_flex().h(38).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(this.loading, (el) => el.child(div().text_size(12).text_color(t.dim).child("checking…")))
      .when(!this.loading && this.error, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Couldn't check machines: ${this.error}`)))
      .child(v_flex().flex_1().min_h(0).gap(8).overflow_y_scrollbar()
        .when(!this.loading && !this.error && groups.length === 0, (el) => el.child(div().py(8).text_size(12).text_color(t.dim)
          .child(this.filter.trim() ? "No machine, space or tab matches." : "No saved machines yet.")))
        .children(groups.map((g) => this.machineBlock(g, t, selKey))))
      .child(h_flex().gap(8).items_center().text_size(10.5).text_color(t.dim)
        .child("↑↓ select · Enter open · Esc close")
        .child(div().flex_1())
        .child("Login opens hc machine login in a local terminal."));
  }

  render(cx) {
    const t = theme();
    return this.overlay ? this.renderList(t, cx) : this.renderStrip(t, cx);
  }
}
