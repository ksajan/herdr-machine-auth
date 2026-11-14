# Machine auth

A slim bottom strip for the Herdr desktop app that watches saved SSH machines.
When one needs authentication it shows a **Login** button; clicking it opens a
normal local terminal inside Herdr and runs `hc machine login <machine>`, so the
password or code prompt appears where the person already is. The **Machines**
label opens a compact auth dialog with the same actions, and a clickable
notification does the same as Login. It stores no credentials and never tries to
answer SSH itself.

![Machine auth](preview.png)

## What you see

A 34px strip across the bottom of the window, on Herdr's `chrome` background:

- **Machines**, 12px medium in `foreground`; clicking it opens the auth dialog.
- While the first read runs: `checking…`, 11px `dim`.
- When every machine is connected: a 6px `ansi2` dot and `N connected`, 11px
  `dim`. With no machines: a `dim` dot and `none added`.
- When one or more need attention: rows left to right, scrolling horizontally.
  Each row has a 6px dot (`blocked` for `needs_login`, `dim` otherwise), the
  machine name in `foreground` (up to 140px, truncated), the state in 11px
  (`blocked` for `needs_login`, otherwise `dim`), a **Login** button, a **Copy**
  button and a 1×16px `border` divider.
  - Login / Retry: 26px high, 9px horizontal padding, radius 5, `solid`
    background, `solid_foreground` text, 11px medium. It reads `Login` for
    `needs_login` and `Retry` for every other non-connected state. Hover dims it
    to 0.88; its tooltip names the target, state, `why` when `hc` gives one, and
    the exact command.
  - Copy: same size, radius 5, `raised` background, `foreground` text. After a
    copy it reads `Copied` until another copy.
- A refresh button at the far right: 24×24px, radius 5, `↻`, `hover`
  background and `foreground` text on hover.
- If the check fails, the middle is one truncated line in `blocked`:
  `Couldn't check machines: <error>`; its tooltip has the full error.

Clicking **Machines** (or pressing `Ctrl+Alt+A`) opens a 640×460 dialog on
`popover`:

- Header: **Machine auth** 17px semibold in `foreground`; `${connected}
  connected` and `${attention} need attention` in 12px `dim`; a 24×24px
  refresh `↻`; a 24×24px `×` that closes the dialog.
- A scrollable column of machine cards, attention first and connected after.
  Each card is a 10px-padded `surface` rounded 8 with a `border`:
  - a 7px state dot (`blocked` for `needs_login`, `ansi2` for connected,
    `dim` otherwise), the name 13px medium in `foreground`, the state 11px in
    `blocked` for `needs_login` else `dim`, then the actions at the right:
    **Login / Retry** (non-connected only), **Install key…** (only
    `needs_login`, a target, and `via: false`), and **Copy**;
  - an 11px `dim` target line, with the `why` reason appended when `hc` gives
    one.
- Footer, 11px `dim`: `Login opens hc machine login in a local terminal.
  Install key reads only public keys and writes authorized_keys; no credentials
  are stored.`

The preview uses a synthetic `build-box` machine; the running mod reads the real
`hc machine ls`.

## How it behaves

- Every 5 seconds it runs `hc machine ls --json`. The first read starts at
  init. The refresh button starts another read immediately. The strip copy and
  an open dialog copy each poll; the dialog copy does not post notifications.
- Temporary machines (`temporary: true`) are left out.
- **Machines** opens the dialog with `openOverlay({ mod: "machine-auth", kind:
  "dialog", width: 640, height: 460 })`. The mod's `keys.json` binds
  `ctrl-alt-a` to `mod.open:machine-auth`; `mod.json` carries the same 640×460
  dialog as its default overlay.
- When a machine enters `needs_login`, it posts one notification:
  title `<name> needs a login`, body `Click here to log in in a terminal.`,
  level `error`, action `space.new` with the login arguments below. The action
  is an ordinary app command, so Herdr's shipped toast and any custom toast that
  runs actions can use it. While the machine stays in `needs_login`, the notice
  repeats after 10 minutes; when it leaves that state the record is cleared.
- `Ctrl+Alt+A` opens the dialog. `Ctrl+Alt+L` logs in to the first
  `needs_login` machine; `Ctrl+Alt+K` installs a key on the first
  `needs_login` machine with a target and `via: false`. The keys deliver
  `machine-auth.login` and `machine-auth.install-key` to `nextCommand()`;
  there are no arguments, so the mod picks the first attention machine. If
  there is nothing to do, it posts an info notification.
- **Login / Retry** calls `run("space.new", ...)` to make a **local** space
  (machine `""`) named `<machine> login`, with a tab named `login`. A success
  closes its tab after a second; a failure waits for Enter, then closes the tab.
  The app's launch wrapper starts an interactive shell after `sh -c`, so the
  command itself closes the tab:

  ```sh
  close_tab() {
    [ -n "${HC_TERMINAL_ID:-}" ] || return 0
    tab=$(hc get "$HC_TERMINAL_ID" --json 2>/dev/null | grep -o '"herdr.tab":"[^"]*"' | cut -d'"' -f4)
    [ -n "$tab" ] || return 0
    app=$(command -v herdr-app 2>/dev/null || printf "%s" "$HOME/.local/bin/herdr-app")
    "$app" do tab.close --id "$tab" --confirmed true >/dev/null 2>&1 || true
  }
  hc machine login <machine>; code=$?
  if [ "$code" -eq 0 ]; then
    printf '\nLogged in. Closing…\n'
    sleep 1
  else
    printf '\nLogin exited %s. Press Enter to close.\n' "$code"
    read _
  fi
  close_tab
  ```

  The space is local even when the selected space is on another machine, so the
  login terminal is always available.
- **Install key…** is the permanent fix. It opens a local space named
  `<machine> key` with a `key` tab and this shell, then closes the dialog:

  ```sh
  # Same close_tab helper as the login command.
  key=$(ls "$HOME"/.ssh/id_ed25519.pub "$HOME"/.ssh/id_rsa.pub 2>/dev/null | head -n 1)
  status=1
  if [ -z "$key" ]; then
    echo "No public key found in ~/.ssh (looked for id_ed25519.pub and id_rsa.pub)."
  elif ! command -v ssh-copy-id >/dev/null 2>&1; then
    echo "ssh-copy-id is not installed."
  elif ssh-copy-id -i "$key" <target>; then
    hc machine login <machine>
    status=$?
  else
    status=$?
    echo "ssh-copy-id did not finish; nothing was changed."
  fi
  if [ "$status" -eq 0 ]; then
    printf '\nKey installed and logged in. Closing…\n'
    sleep 1
  else
    printf '\nInstall key exited %s. Press Enter to close.\n' "$status"
    read _
  fi
  close_tab
  ```

  The first existing default public key is installed, then the machine is
  logged in once. A success closes its tab; a failure waits for Enter, then
  closes it. No private key or password is read by the mod; SSH asks for the
  password itself.
- **Copy** writes `hc machine login <machine>` to the clipboard. It is the same
  command the shipped Spaces mod offers; this mod adds the button.
- The strip does not change the layout or switch machines. The dialog only
  closes; it does not select a machine.
- No credentials are read, written or cached. The terminal asks; SSH owns the
  prompt.

## Built from

- One mod, `mods/machine-auth/`:
  - `mod.json`: `{ "place": "bottom", "size": 34, "title": "Machine auth",
    "version": "0.7.0", "overlay": { "kind": "dialog", "width": 640,
    "height": 460 } }`. The first time Herdr sees the folder it docks the strip
    into the shown layout; the overlay is what `mod.open` uses for the dialog.
  - `keys.json`: `ctrl-alt-a` opens the dialog, `ctrl-alt-l` logs in to the
    first machine needing it, and `ctrl-alt-k` installs its key.
  - `main.js`: imports `View`, `div` from `gpui-kit`, `v_flex`, `h_flex` from
    `gpui-base`, and `hc`, `notify`, `run`, `theme`, `props`, `openOverlay`,
    `closeOverlay`, `nextCommand` from `herdr`.
    - `shellArg(value)` leaves plain machine names alone and single-quotes
      anything else, escaping embedded single quotes.
    - `commandFor(machine)` returns `hc machine login <quoted>`.
    - `loginArgs(machine)` returns the `space.new` arguments above.
    - `keyArgs(machine, target)` builds the optional `ssh-copy-id` shell above.
    - `closeTab()` builds the shell helper that reads `HC_TERMINAL_ID`, gets
      `herdr.tab` from `hc get`, and closes that tab with `herdr-app do
      tab.close --confirmed true`.
    - `init` sets `this.overlay = props()?.overlay`, empty/loading state, a
      5-second `cx.timer.every`, starts the first read, and runs a
      `nextCommand()` loop for `install-key` / `login`.
    - `installKeyShortcut` and `loginShortcut` pick the first attention machine
      and run `keyArgs` / `loginArgs`; an empty case posts an info notification.
    - `refresh` uses `cx.spawn(async (cx) => ...)`, checks `r.code`, parses
      `r.stdout` as JSON, filters temporary machines, calls `notifyLogins` only
      on the strip copy, and sets `loading`/`error` before `cx.notify()`.
    - `notifyLogins` keeps `this.notified` as a per-machine timestamp and posts
      at most one notice per 10 minutes for a machine in `needs_login`.
    - `openList` calls `openOverlay` with the same 640×460 dialog; `close` tries
      the overlay id, falls back to `closeOverlay()`, and swallows errors.
    - `button(id, label, primary, tooltip, onClick)` is the shared 26px action
      button; it stops propagation with `cx.stop_propagation()`.
    - `row` draws the strip's dot, name, state, Login/Retry, Copy and divider.
    - `renderStrip` chooses checking / error / all-connected / attention, makes
      **Machines** open the dialog, and always draws the refresh button.
    - `authCard` draws one dialog card: state dot, name, state, Login/Retry,
      Install key…, Copy and target.
    - `renderList` draws the dialog header, the scrollable cards and the footer.
    - `render(cx)` returns `renderList` when `this.overlay` is set, otherwise
      `renderStrip`.
- No images, fonts, SVGs or other assets. No network requests.
  `hc machine ls` runs on a timer; the login and key actions run only after a
  click, in a normal terminal. **Install key…** runs `ssh-copy-id`, which reads
  the chosen public key and writes `authorized_keys`; no private key or password
  is read by the mod.

## Watch out

- **`hc` must be on `PATH`** in the app's environment. Herdr installs it; a
  custom setup that only has `herdr-core` needs a symlink or a different command.
  If `hc` fails, the strip shows `Couldn't check machines: ...`.
- **This watches herdr-core's machine catalog**, the one the app's spaces and
  sidebar use (`hc machine ls`). Machines saved only in the `herdr` TUI are a
  separate catalog; use `herdr machine reconnect` for those.
- **The login wrapper assumes a POSIX shell.** `sh -c` and `read _` work on
  Linux and macOS. On Windows `hc machine login` has no password prompt, so the
  button is not useful there. Do not replace `sh` with the user's interactive
  shell: fish and nushell parse the wrapper differently.
- **The space is deliberately local.** Passing the machine being viewed would
  put the login terminal on the broken machine. `machine: ""` is this computer.
- **The notification action is `space.new`**, not a mod command. Mod commands
  receive no args through `notify`; using `space.new` keeps the action working
  with the shipped toast and with custom toasts that call `run(action.name,
  action.args)`.
- **Only one copy per layout.** The strip polls while its block is shown. If the
  person uses several layouts, add the block to each one; a layout without it has
  no strip and no notifications. The dialog copy polls while open but does not
  notify.
- **Do not filter out unknown states.** A machine can be `unreachable` or
  `asleep` and still need a login attempt; showing Login/Retry for every
  non-connected state is the safe behavior.
- **Do not auto-run the login or the key install.** Starting SSH without a click
  would put a credential prompt on screen at arbitrary times. Both actions open
  a terminal only after a click, refresh, or notification action.
- **Install key… is deliberately conservative.** It only appears for
  `needs_login`, a target, and `via: false`. It uses the first of
  `~/.ssh/id_ed25519.pub` and `~/.ssh/id_rsa.pub`, never a private key. A custom
  port, a Host alias `ssh-copy-id` cannot parse, a different key, or
  `ssh-copy-id` not being installed are left to the person's own terminal; the
  key terminal prints the reason and stays open.
- **The 10-minute repeat is intentional.** A dismissed notification should not
  hide a machine that still needs a person forever; a successful login clears
  the state and the timer.
- **The refresh button does not clear `notified`.** If a machine is still in
  `needs_login`, a manual refresh must not spam a new toast.
- **Machine names may contain punctuation.** Always pass them through
  `shellArg`. Never interpolate an unquoted name into a shell line.
- **`ctrl-alt-a` may be taken.** The mod ships it in `keys.json`; the person can
  change or drop it. The Machines label still opens the dialog. The same applies
  to `ctrl-alt-l` and `ctrl-alt-k`.
- **The `Ctrl+Shift+P` palette lists app commands only.** Herdr does not list a
  mod's own `<mod>.<command>` actions there. The direct keys are the quick route;
  the dialog's buttons remain the discoverable route.
- **Auto-close needs `HC_TERMINAL_ID` and `herdr-app`.** App-created terminals
  have the id. A terminal without it (or a missing `herdr-app`) falls back to
  leaving the tab open; the login itself still works.
- **Do not call `hc get` without the terminal id.** The helper must no-op when
  `HC_TERMINAL_ID` is empty rather than inspecting `t1`.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/machine-auth` passes.
- With all machines connected, the strip reads `Machines ● N connected` and the
  ↻ button triggers a fresh read without changing the layout.
- Temporarily forcing one machine to `{ state: "needs_login", target:
  "you@build-box.local", via: false }` shows `Machines ● build-box needs login`
  with **Login** and **Copy**, and posts one notification whose click would run
  the same login.
- Clicking **Machines** (or pressing `Ctrl+Alt+A`) opens the 640×460 dialog.
  Attention is first; the needs-login card shows **Login**, **Install key…** and
  **Copy**; connected cards show **Copy** only.
- Clicking **Login** creates a local space named `build-box login` with a
  `login` tab, and the terminal shows the `(user@host) Password:` prompt (or the
  real SSH error). A successful login closes the tab after a second; a failed
  one waits for Enter, then closes it. No leftover login tabs.
- `Ctrl+Alt+L` logs in to the first machine that needs it; `Ctrl+Alt+K` installs
  its key. With nothing to do, each posts an info notification instead of opening
  a terminal.
- Clicking **Install key…** creates a local space named `build-box key` with a
  `key` tab, prompts for the password, runs `ssh-copy-id`, then logs in once
  with `hc machine login`. It reads only the first default public key and keeps
  the terminal open on failure.
- **Copy** puts `hc machine login build-box` on the clipboard and briefly reads
  `Copied`.
- A successful `hc machine login work` changes the strip back to `connected`
  within one poll or one manual refresh.
- Removing the block from the layout removes the strip; deleting the mod folder
  and the `ctrl-alt-a` key leaves layouts, machines and SSH auth untouched.
