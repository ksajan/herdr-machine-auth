// Machine login: a slim strip that watches saved SSH machines and offers a
// Login button when one needs authentication. The Machines label opens a
// dialog with every machine and the same actions. The actual login runs in a
// normal local terminal, because SSH must be able to ask for a password or a
// code. No credentials are read or stored here.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
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
    openOverlay({ mod: "machine-login", kind: "dialog", width: 680, height: 520 });
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

  card(m, t, cx) {
    const state = String(m.state ?? "unknown").replace(/_/g, " ");
    const login = m.state === "needs_login";
    const reason = m.why ? ` (${m.why})` : "";
    const command = commandFor(m.name);
    const first = spaces().find((s) => (s.machine ?? null) === (m.name ?? null));
    return v_flex().gap(7).p(11).rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().gap(7).items_center()
        .child(div().size(7).rounded(4).flex_none().bg(login ? t.blocked : m.state === "connected" ? t.ansi2 : t.dim))
        .child(div().text_size(13).font_medium().text_color(t.foreground).child(m.name))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(login ? t.blocked : t.dim).child(state)))
      .child(h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(reason || m.target || "")
          .child(m.target ? `${m.target}${reason}` : "no target"))
        .when(Boolean(first), (el) => el.child(this.button(`machine-login-go-${m.name}`, "Go", false,
          `Show the first space on ${m.name}.`,
          () => { closeOverlay(this.overlay); run("space.select", { id: first.id }); })))
        .when(m.state !== "connected", (el) => el.child(this.button(`machine-login-${m.name}`, login ? "Login" : "Retry", true,
          `Open a terminal here and run ${command}.`,
          () => { closeOverlay(this.overlay); run("space.new", loginArgs(m.name)); })))
        .when(login && m.target && !m.via, (el) => el.child(this.button(`machine-login-key-${m.name}`, "Install key…", false,
          "Install the first of ~/.ssh/id_ed25519.pub or id_rsa.pub on the machine, then log in. Reads only public keys.",
          () => { closeOverlay(this.overlay); run("space.new", keyArgs(m.name, m.target)); })))
        .child(this.button(`machine-login-copy-${m.name}`, this.copied === m.name ? "Copied" : "Copy", false,
          command,
          (_e, cx) => { cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); })));
  }

  renderList(t, cx) {
    const attention = this.machines.filter((m) => m.state !== "connected");
    const connected = this.machines.filter((m) => m.state === "connected");
    const ordered = [...attention, ...connected];
    return v_flex().size_full().p(16).gap(12).bg(t.popover).text_color(t.muted)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child("Machines"))
        .child(div().text_size(12).text_color(t.dim).child(`${connected.length} connected${attention.length ? ` · ${attention.length} need attention` : ""}`))
        .child(div().flex_1())
        .child(div().id("machine-login-list-refresh").size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Check machines now")
          .on_click((_e, cx) => { this.loading = true; this.refresh(cx); })
          .child("↻"))
        .child(div().id("machine-login-close").size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Close")
          .on_click((_e, cx) => { cx.stop_propagation(); closeOverlay(this.overlay); })
          .child("×")))
      .when(this.loading, (el) => el.child(div().text_size(12).text_color(t.dim).child("checking…")))
      .when(!this.loading && this.error, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Couldn't check machines: ${this.error}`)))
      .child(v_flex().flex_1().min_h(0).gap(7).overflow_y_scrollbar()
        .when(!this.loading && !this.error && ordered.length === 0, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("No saved machines yet.")))
        .children(ordered.map((m) => this.card(m, t, cx))))
      .child(div().text_size(11).text_color(t.dim).child("Login opens hc machine login in a local terminal. Install key reads only public keys and writes authorized_keys; no credentials are stored."));
  }

  render(cx) {
    const t = theme();
    return this.overlay ? this.renderList(t, cx) : this.renderStrip(t, cx);
  }
}
