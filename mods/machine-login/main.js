// Machine login: a slim strip that watches saved SSH machines and offers a
// Login button when one needs authentication. It also posts a clickable
// notification on the transition into "needs_login". The actual login runs in
// a normal local terminal, because SSH must be able to ask for a password or
// a code. No credentials are read or stored here.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, notify, run, theme } from "herdr";

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

export default class MachineLogin extends View {
  init(_props, cx) {
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
        this.notifyLogins();
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

  row(m, t) {
    const state = String(m.state ?? "unknown").replace(/_/g, " ");
    const login = m.state === "needs_login";
    const command = commandFor(m.name);
    return h_flex().flex_none().gap(6).items_center()
      .child(div().size(6).rounded(3).flex_none().bg(login ? t.blocked : t.dim))
      .child(div().max_w(140).truncate().text_color(t.foreground).child(m.name))
      .child(div().flex_none().text_size(11).text_color(login ? t.blocked : t.dim).child(state))
      .child(div().id(`machine-login-${m.name}`).flex_none().h(24).px(8).flex().items_center().rounded(5)
        .bg(t.solid).text_color(t.solid_foreground).text_size(11).font_medium()
        .cursor_pointer().hover((s) => s.opacity(0.88))
        .tooltip(`${m.target ?? m.name} is ${state}. Opens a terminal here and runs ${command}.`)
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", loginArgs(m.name)); })
        .child("Login"))
      .child(div().id(`machine-login-copy-${m.name}`).flex_none().h(24).px(6).flex().items_center().rounded(5)
        .bg(t.raised).text_color(t.foreground).text_size(11).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip(command)
        .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); })
        .child(this.copied === m.name ? "Copied" : "Copy"))
      .child(div().w(1).h(16).flex_none().bg(t.border));
  }

  render() {
    const t = theme();
    const attention = this.machines.filter((m) => m.state !== "connected");
    const connected = this.machines.filter((m) => m.state === "connected");
    return v_flex().size_full().px(10).bg(t.chrome).text_size(12).text_color(t.muted)
      .child(h_flex().size_full().gap(8).items_center()
        .child(div().flex_none().font_medium().text_color(t.foreground).child("Machines"))
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
}
