// Machine auth: a slim strip that watches saved SSH machines and offers a
// Login button when one needs authentication. A floating panel asks for the
// password or code and runs the actual login in a hidden local terminal, so
// no terminal tab is left behind. The strip is also the entry point to the
// auth dialog and the first-machine shortcuts.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, notify, theme, props, openOverlay, closeOverlay, nextCommand, setShared, shared } from "herdr";

const shellArg = (value) => /^[a-z0-9_@%+=:,./-]+$/i.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
const commandFor = (machine) => `hc machine login ${shellArg(machine)}`;

// The hidden key install: public key, ssh-copy-id, then one login. The password
// prompt is answered by the floating panel through hc send.
function keyLine(machine, target) {
  return [
    'key=$(ls "$HOME"/.ssh/id_ed25519.pub "$HOME"/.ssh/id_rsa.pub 2>/dev/null | head -n 1)',
    'if [ -z "$key" ]; then echo "No public key found in ~/.ssh (looked for id_ed25519.pub and id_rsa.pub)."; exit 1; fi',
    'if ! command -v ssh-copy-id >/dev/null 2>&1; then echo "ssh-copy-id is not installed."; exit 1; fi',
    `ssh-copy-id -i "$key" ${shellArg(target)} || exit $?`,
    `hc machine login ${shellArg(machine)}`,
  ].join("\n");
}

export default class MachineAuth extends View {
  init(_props, cx) {
    const p = props();
    this.overlay = p?.overlay ?? null;
    this.promptMachine = p?.prompt ?? null;
    this.promptTarget = p?.target ?? null;
    this.promptAction = p?.action === "key" ? "key" : "login";
    this.machines = [];
    this.error = null;
    this.loading = true;
    this.copied = null;
    this.notified = {};
    this.busy = false;
    this.status = null;
    this.address = null;
    this.pendingPassword = null;
    this.cancelled = false;
    this.remember = Boolean(shared("machine-auth.remember"));
    this.installing = false;
    this.message = null;

    if (this.promptMachine) {
      this.loading = false;
      this.handle = cx.focus_handle();
      this.password = InputState.new({ placeholder: "Password or code" });
      this.password.set_masked(true);
      this.password.on("submit", (_e, cx) => this.submit(cx));
      this.password.focus();
      cx.timer.after(200, () => this.password.focus());
      return;
    }

    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "install-key") this.installKeyShortcut();
        else if (command === "login") this.loginShortcut();
        else if (command === "prompt") {
          const machine = shared("machine-auth.pending");
          if (machine) this.openPrompt(machine, "login");
        }
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

  notifyLogins() {
    const now = Date.now();
    for (const m of this.machines) {
      if (m.state !== "needs_login") {
        delete this.notified[m.name];
        continue;
      }
      if (now - (this.notified[m.name] ?? 0) < 10 * 60 * 1000) continue;
      this.notified[m.name] = now;
      setShared("machine-auth.pending", m.name);
      notify({
        title: `${m.name} needs a login`,
        body: "Click here to open the password panel.",
        level: "error",
        action: { name: "machine-auth.prompt" },
      });
    }
  }

  openList() {
    openOverlay({ mod: "machine-auth", kind: "dialog", width: 640, height: 460 });
  }

  openPrompt(machine, action) {
    const m = this.machines.find((x) => x.name === machine);
    const target = m?.target ?? null;
    if (action === "key" && !target) {
      notify({ title: "No target for this machine", body: "Install key needs a standard SSH target.", level: "warning" });
      return;
    }
    if (this.overlay) this.close();
    openOverlay({
      mod: "machine-auth",
      kind: "dialog",
      width: 440,
      height: 280,
      props: { prompt: machine, target, action },
    });
  }

  installKeyShortcut() {
    const need = this.machines.filter((m) => m.state === "needs_login" && m.target && !m.via);
    if (!need.length) {
      notify({ title: "No machine needs a login key", body: "Only needs_login machines with a standard target can use Install key.", level: "info" });
      return;
    }
    this.openPrompt(need[0].name, "key");
  }

  loginShortcut() {
    const m = this.machines.find((x) => x.state === "needs_login");
    if (!m) {
      notify({ title: "No machine needs a login", body: "All saved machines are connected.", level: "info" });
      return;
    }
    this.openPrompt(m.name, "login");
  }

  close() {
    try {
      if (this.overlay) closeOverlay(this.overlay);
      else closeOverlay();
    } catch {
      try { closeOverlay(); } catch {}
    }
  }

  button(id, label, primary, tooltip, onClick, disabled = false) {
    return div().id(id).flex_none().h(26).px(9).flex().items_center().rounded(5)
      .bg(primary ? theme().solid : theme().raised)
      .text_color(primary ? theme().solid_foreground : theme().foreground)
      .text_size(11).font_medium()
      .when(disabled, (el) => el.opacity(0.45))
      .when(!disabled, (el) => el.cursor_pointer()
        .hover((s) => primary ? s.opacity(0.88) : s.bg(theme().hover))
        .on_click((_e, cx) => { cx.stop_propagation(); onClick(); }))
      .tooltip(tooltip)
      .child(label);
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
          .children(attention.map((m) => this.stripRow(m, t, cx)))))
        .child(div().id("machine-auth-refresh").flex_none().size(24).flex().items_center().justify_center().rounded(5)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Check machines now")
          .on_click((_e, cx) => { this.loading = true; this.refresh(cx); })
          .child("↻")));
  }

  stripRow(m, t, cx) {
    const state = String(m.state ?? "unknown").replace(/_/g, " ");
    const login = m.state === "needs_login";
    const reason = m.why ? ` (${m.why})` : "";
    const command = commandFor(m.name);
    return h_flex().flex_none().gap(6).items_center()
      .child(div().size(6).rounded(3).flex_none().bg(login ? t.blocked : t.dim))
      .child(div().max_w(140).truncate().text_color(t.foreground).child(m.name))
      .child(div().flex_none().text_size(11).text_color(login ? t.blocked : t.dim).child(state))
      .child(this.button(`machine-auth-${m.name}`, login ? "Login" : "Retry", true,
        `${m.target ?? m.name} is ${state}${reason}. Opens the password panel.`,
        () => this.openPrompt(m.name, "login")))
      .child(div().id(`machine-auth-copy-${m.name}`).flex_none().h(26).px(6).flex().items_center().rounded(5)
        .bg(t.raised).text_color(t.foreground).text_size(11).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(command)
        .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); })
        .child(this.copied === m.name ? "Copied" : "Copy"))
      .child(div().w(1).h(16).flex_none().bg(t.border));
  }

  authCard(m, t, cx) {
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
          `Open the password panel for ${m.name}.`,
          () => this.openPrompt(m.name, "login"))))
        .when(login && m.target && !m.via, (el) => el.child(this.button(`machine-auth-key-${m.name}`, "Install key…", false,
          "Install the first of ~/.ssh/id_ed25519.pub or id_rsa.pub, then log in.",
          () => this.openPrompt(m.name, "key"))))
        .child(div().id(`machine-auth-copy-card-${m.name}`).flex_none().h(26).px(6).flex().items_center().rounded(5)
          .bg(t.raised).text_color(t.foreground).text_size(11).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(command)
          .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = m.name; cx.notify(); })
          .child(this.copied === m.name ? "Copied" : "Copy")))
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
        .children(ordered.map((m) => this.authCard(m, t, cx))))
      .child(v_flex().gap(2).flex_none()
        .child(div().text_size(10.5).text_color(t.dim).child("Ctrl+Alt+L opens the first machine needing a login. Ctrl+Alt+K installs its key."))
        .child(div().text_size(10.5).text_color(t.dim).child("Passwords go to a hidden local terminal; nothing is stored.")));
  }

  submit(cx) {
    if (this.busy) return;
    const password = this.password.value();
    if (!password) {
      this.error = "Enter the password or code.";
      cx.notify();
      return;
    }
    const install = this.promptAction === "key" || this.remember;
    if (install && !this.promptTarget) {
      this.error = "This machine has no standard target for Install key. Uncheck it and log in, or use Copy.";
      cx.notify();
      return;
    }
    this.busy = true;
    this.status = "starting";
    this.error = null;
    this.pendingPassword = password;
    this.installing = install;
    this.password.set_value("");
    cx.notify();
    this.startHidden(cx);
  }

  startHidden(cx) {
    cx.spawn(async (cx) => {
      try {
        const name = `auth-${Date.now().toString(36)}`;
        const install = Boolean(this.installing);
        const args = install
          ? ["run", "--bg", "--json", "--name", name, "--", "sh", "-c", keyLine(this.promptMachine, this.promptTarget)]
          : ["run", "--bg", "--json", "--name", name, "--", "hc", "machine", "login", this.promptMachine];
        const r = await hc(args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || "Couldn't start the login");
        const data = JSON.parse(r.stdout);
        this.address = data.address;
        this.status = "waiting";
        cx.notify();
        this.pollPrompt(cx, 0);
      } catch (e) {
        this.busy = false;
        this.status = "error";
        this.error = String(e?.message ?? e);
        this.pendingPassword = null;
        cx.notify();
      }
    });
  }

  pollPrompt(cx, tries) {
    if (this.cancelled || !this.address) return;
    cx.spawn(async (cx) => {
      const g = await hc(["get", this.address, "--json"]).catch(() => null);
      let state = null;
      try { state = JSON.parse(g?.stdout ?? ""); } catch {}
      if (state?.state === "finished") { this.finish(cx, state.exit_code); return; }
      const r = await hc(["read", this.address]).catch(() => null);
      const text = r?.stdout ?? "";
      if (/\(yes\/no|fingerprint|permission denied/i.test(text)) {
        this.fail(cx, "SSH wants an answer this panel cannot give. Use the terminal command from Copy.");
        return;
      }
      if (/password|passphrase|passcode|verification|authenticator/i.test(text)) {
        const password = this.pendingPassword;
        this.pendingPassword = null;
        if (password) await hc(["send", "--force", this.address, password]).catch(() => null);
        this.status = "waiting";
        cx.notify();
        this.watch(cx, 0);
        return;
      }
      if (tries >= 40) { this.fail(cx, "No password prompt appeared."); return; }
      cx.timer.after(300, () => this.pollPrompt(cx, tries + 1));
    });
  }

  watch(cx, tries) {
    if (this.cancelled || !this.address) return;
    cx.spawn(async (cx) => {
      const g = await hc(["get", this.address, "--json"]).catch(() => null);
      let state = null;
      try { state = JSON.parse(g?.stdout ?? ""); } catch {}
      if (state?.state === "finished") { this.finish(cx, state.exit_code); return; }
      const r = await hc(["read", this.address]).catch(() => null);
      const text = r?.stdout ?? "";
      if (/permission denied|authentication failed|incorrect|try again/i.test(text)) {
        this.fail(cx, "Authentication failed. Check the password or code.");
        return;
      }
      if (/passcode|verification code|authenticator/i.test(text)) {
        this.fail(cx, "This machine wants a one-time code. Use the terminal command from Copy.");
        return;
      }
      if (tries >= 60) { this.fail(cx, "Login timed out."); return; }
      cx.timer.after(500, () => this.watch(cx, tries + 1));
    });
  }

  finish(cx, code) {
    const address = this.address;
    this.address = null;
    this.pendingPassword = null;
    this.busy = false;
    cx.spawn(async (cx) => {
      const r = address ? await hc(["read", address]).catch(() => null) : null;
      if (address) await hc(["rm", address]).catch(() => null);
      const text = r?.stdout ?? "";
      if (code === 0) {
        this.status = "done";
        this.error = null;
        this.message = this.installing ? "Key installed and connected." : "Connected.";
        cx.timer.after(700, () => this.close());
      } else {
        this.status = "error";
        const tail = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3).join("\n");
        this.error = tail || `Login exited ${code}.`;
      }
      cx.notify();
    });
  }

  fail(cx, message) {
    const address = this.address;
    this.address = null;
    this.pendingPassword = null;
    this.busy = false;
    this.status = "error";
    this.error = message;
    if (address) {
      hc(["kill", address]).catch(() => null);
      hc(["rm", address]).catch(() => null);
    }
    cx.notify();
  }

  cancel() {
    this.cancelled = true;
    if (this.address) {
      hc(["kill", this.address]).catch(() => null);
      hc(["rm", this.address]).catch(() => null);
    }
    this.close();
  }

  renderPrompt(t, cx) {
    const key = this.promptAction === "key";
    const install = key || this.remember;
    const title = key ? `Install key on ${this.promptMachine}` : `Log in to ${this.promptMachine}`;
    return v_flex().size_full().p(18).gap(9).bg(t.popover).text_color(t.muted)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.cancel(); } })
      .child(div().text_size(16).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(this.promptTarget), (el) => el.child(div().text_size(11).text_color(t.dim).child(this.promptTarget)))
      .child(h_flex().h(38).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.password).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(!key, (el) => el.child(h_flex().id("machine-auth-remember").gap(7).items_center()
        .when(!this.busy, (x) => x.cursor_pointer().on_click((_e, cx) => {
          cx.stop_propagation();
          this.remember = !this.remember;
          setShared("machine-auth.remember", this.remember);
          cx.notify();
        }))
        .when(this.busy, (x) => x.opacity(0.5))
        .child(div().size(14).rounded(3).border_1().flex().items_center().justify_center()
          .border_color(this.remember ? t.accent : t.border)
          .bg(this.remember ? t.accent : t.background)
          .when(this.remember, (el) => el.child(div().text_size(10).text_color(t.accent_foreground).child("✓"))))
        .child(div().text_size(11).text_color(t.muted).child("Install my SSH key permanently"))))
      .when(this.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.error)))
      .when(this.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child(this.message ?? "Connected.")))
      .when(this.busy && !this.error, (el) => el.child(div().text_size(11).text_color(t.dim).child("Waiting for the password prompt…")))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1())
        .child(this.button("machine-auth-submit", this.busy ? "Working…" : install ? "Log in and install key" : "Log in", true,
          "Send the password to a hidden local terminal.", () => this.submit(cx), this.busy))
        .child(this.button("machine-auth-cancel", "Cancel", false, "Close this panel.", () => this.cancel())))
      .child(div().text_size(10.5).text_color(t.dim)
        .child(install ? "The password installs your public key and logs in once. The hidden terminal is removed; nothing is stored." : "The password goes to a hidden local terminal and is not stored. A successful login closes this panel."));
  }

  render(cx) {
    const t = theme();
    if (this.promptMachine) return this.renderPrompt(t, cx);
    if (this.overlay) return this.renderList(t, cx);
    return this.renderStrip(t, cx);
  }
}
