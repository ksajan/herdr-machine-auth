// Machine auth: a slim strip that watches saved SSH machines and offers a
// Login button when one needs authentication. The Machines label opens a
// dialog with the same actions for every machine. The actual login runs in a
// normal local terminal, because SSH must be able to ask for a password or a
// code. No credentials are read or stored here.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, notify, run, theme, props, openOverlay, closeOverlay, nextCommand } from "herdr";

const shellArg = (value) => /^[a-z0-9_@%+=:,./-]+$/i.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
const commandFor = (machine) => `hc machine login ${shellArg(machine)}`;

// A new local space keeps the login visible and leaves the machine being
// viewed alone. The terminal closes its own tab when it is done: after a
// successful login it waits a moment; after a failure it waits for Enter.
// The app's launch wrapper starts an interactive shell after `sh -c`, so
// closing the tab from inside the command is what prevents leftover tabs.
function closeTab() {
  return [
    'close_tab() {',
    '  [ -n "${HC_TERMINAL_ID:-}" ] || return 0',
    '  tab=$(hc get "$HC_TERMINAL_ID" --json 2>/dev/null | grep -o \'"herdr.tab":"[^"]*"\' | cut -d\'"\' -f4)',
    '  [ -n "$tab" ] || return 0',
    '  app=$(command -v herdr-app 2>/dev/null || printf "%s" "$HOME/.local/bin/herdr-app")',
    '  "$app" do tab.close --id "$tab" --confirmed true >/dev/null 2>&1 || true',
    '}',
  ].join("\n");
}

function loginArgs(machine) {
  const command = commandFor(machine);
  const line = [
    closeTab(),
    `${command}; code=$?`,
    'if [ "$code" -eq 0 ]; then',
    '  printf "\\nLogged in. Closing…\\n"',
    '  sleep 1',
    'else',
    '  printf "\\nLogin exited %s. Press Enter to close.\\n" "$code"',
    '  read _',
    'fi',
    'close_tab',
  ].join("\n");
  return {
    name: `${machine} login`,
    tab: "login",
    machine: "",
    argv: ["sh", "-c", line],
  };
}

// The optional permanent fix: install this computer's public key, then log in
// once. Only public keys are read; ssh-copy-id writes them to the machine's
// authorized_keys. The terminal asks for the password itself.
function keyArgs(machine, target) {
  const line = [
    closeTab(),
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
    'if [ "$status" -eq 0 ]; then',
    '  printf "\\nKey installed and logged in. Closing…\\n"',
    '  sleep 1',
    'else',
    '  printf "\\nInstall key exited %s. Press Enter to close.\\n" "$status"',
    '  read _',
    'fi',
    'close_tab',
  ].join("\n");
  return {
    name: `${machine} key`,
    tab: "key",
    machine: "",
    argv: ["sh", "-c", line],
  };
}

export default class MachineAuth extends View {
  init(_props, cx) {
    this.overlay = props()?.overlay ?? null;
    this.machines = [];
    this.error = null;
    this.loading = true;
    this.copied = null;
    this.notified = {}; // machine -> when its login notice was last posted
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "install-key") this.installKeyShortcut();
        else if (command === "login") this.loginShortcut();
        cx.notify();
      }
    });
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
    openOverlay({ mod: "machine-auth", kind: "dialog", width: 640, height: 460 });
  }

  // Ctrl+Alt+K: install a key on the first machine that needs one, then log in.
  installKeyShortcut() {
    const need = this.machines.filter((m) => m.state === "needs_login" && m.target && !m.via);
    if (!need.length) {
      notify({ title: "No machine needs a login key", body: "Only needs_login machines with a standard target can use Install key.", level: "info" });
      return;
    }
    const m = need[0];
    run("space.new", keyArgs(m.name, m.target));
  }

  // Ctrl+Alt+L: log in to the first machine that needs it.
  loginShortcut() {
    const m = this.machines.find((x) => x.state === "needs_login");
    if (!m) {
      notify({ title: "No machine needs a login", body: "All saved machines are connected.", level: "info" });
      return;
    }
    run("space.new", loginArgs(m.name));
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
      .child(this.button(`machine-auth-${m.name}`, login ? "Login" : "Retry", true,
        `${m.target ?? m.name} is ${state}${reason}. Opens a terminal here and runs ${command}.`,
        () => run("space.new", loginArgs(m.name))))
      .child(this.button(`machine-auth-copy-${m.name}`, this.copied === m.name ? "Copied" : "Copy", false,
        command,
        (_e, cx) => { cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); }))
      .child(div().w(1).h(16).flex_none().bg(t.border));
  }

  renderStrip(t, cx) {
    const attention = this.machines.filter((m) => m.state !== "connected");
    const connected = this.machines.filter((m) => m.state === "connected");
    return v_flex().size_full().px(10).bg(t.chrome).text_size(12).text_color(t.muted)
      .child(h_flex().size_full().gap(8).items_center()
        .child(div().id("machine-auth-open").flex_none().font_medium().text_color(t.foreground).cursor_pointer()
          .hover((s) => s.text_color(t.accent)).tooltip("Machine authentication")
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
        .child(div().id("machine-auth-refresh").flex_none().size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Check machines now")
          .on_click((_e, cx) => { this.loading = true; this.refresh(cx); })
          .child("↻")));
  }

  authCard(m, t) {
    const state = String(m.state ?? "unknown").replace(/_/g, " ");
    const login = m.state === "needs_login";
    const reason = m.why ? ` (${m.why})` : "";
    const command = commandFor(m.name);
    return v_flex().gap(7).p(10).rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().gap(7).items_center()
        .child(div().size(7).rounded(4).flex_none().bg(login ? t.blocked : m.state === "connected" ? t.ansi2 : t.dim))
        .child(div().text_size(13).font_medium().text_color(t.foreground).child(m.name))
        .child(div().text_size(11).text_color(login ? t.blocked : t.dim).child(state))
        .child(div().flex_1())
        .when(m.state !== "connected", (el) => el.child(this.button(`machine-auth-login-${m.name}`, login ? "Login" : "Retry", true,
          `Open a terminal here and run ${command}.`,
          () => { run("space.new", loginArgs(m.name)); this.close(); })))
        .when(login && m.target && !m.via, (el) => el.child(this.button(`machine-auth-key-${m.name}`, "Install key…", false,
          "Install the first of ~/.ssh/id_ed25519.pub or id_rsa.pub, then log in. Reads only public keys.",
          () => { run("space.new", keyArgs(m.name, m.target)); this.close(); })))
        .child(this.button(`machine-auth-copy-card-${m.name}`, this.copied === m.name ? "Copied" : "Copy", false,
          command,
          (_e, cx) => { cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); })))
      .child(div().text_size(11).text_color(t.dim).truncate().tooltip(reason || m.target || "")
        .child(m.target ? `${m.target}${reason}` : "no target"));
  }

  renderList(t, cx) {
    const attention = this.machines.filter((m) => m.state !== "connected");
    const connected = this.machines.filter((m) => m.state === "connected");
    const ordered = [...attention, ...connected];
    return v_flex().size_full().p(16).gap(10).bg(t.popover).text_color(t.muted)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(17).font_semibold().text_color(t.foreground).child("Machine auth"))
        .child(div().text_size(12).text_color(t.dim).child(`${connected.length} connected${attention.length ? ` · ${attention.length} need attention` : ""}`))
        .child(div().flex_1())
        .child(div().id("machine-auth-list-refresh").size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Check machines now")
          .on_click((_e, cx) => { this.loading = true; this.refresh(cx); })
          .child("↻"))
        .child(div().id("machine-auth-close").size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Close")
          .on_click((_e, cx) => { cx.stop_propagation(); this.close(); })
          .child("×")))
      .when(this.loading, (el) => el.child(div().text_size(12).text_color(t.dim).child("checking…")))
      .when(!this.loading && this.error, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Couldn't check machines: ${this.error}`)))
      .child(v_flex().flex_1().min_h(0).gap(7).overflow_y_scrollbar()
        .when(!this.loading && !this.error && ordered.length === 0, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("No saved machines yet.")))
        .children(ordered.map((m) => this.authCard(m, t))))
      .child(v_flex().gap(2).flex_none()
        .child(div().text_size(10.5).text_color(t.dim).child("Ctrl+Alt+L logs in to the first machine needing it. Ctrl+Alt+K installs its SSH key."))
        .child(div().text_size(10.5).text_color(t.dim).child("Login runs hc machine login in a local terminal; no credentials are stored.")));
  }

  render(cx) {
    const t = theme();
    return this.overlay ? this.renderList(t, cx) : this.renderStrip(t, cx);
  }
}
