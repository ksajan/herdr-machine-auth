# Machine login

A slim bottom strip for the Herdr desktop app that watches saved SSH machines.
When one needs authentication it shows a **Login** button; clicking it opens a
normal local terminal inside Herdr and runs `hc machine login <machine>`, so the
password or code prompt appears where the person already is. The **Machines**
label opens a full machine list with the same actions, plus **Install key…** for
a permanent key-based fix, and **Go** to a machine's first space. It also posts
a clickable notification for the same login action. It stores no credentials and
never tries to answer SSH itself.

![Machine login](preview.png)

## What you see

A 34px strip across the bottom of the window, on Herdr's `chrome` background.
From left to right:

- **Machines**, 12px medium in `foreground`.
- While the first read runs: `checking…`, 11px `dim`.
- When every machine is connected: a 6px `ansi2` dot and `N connected`, 11px
  `dim`. With no machines: a `dim` dot and `none added`.
- When one or more need attention: rows laid out left to right, scrolling
  horizontally when they do not fit. Each row has a 6px dot (`blocked` for
  `needs_login`, `dim` otherwise), the machine name in `foreground` (up to
  140px, truncated), the state in 11px (`blocked` for `needs_login`, otherwise
  `dim`), a **Login** button, a **Copy** button and a 1×16px `border` divider.
  - Login / Retry: 24px high, 8px horizontal padding, radius 5, `solid`
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

Clicking **Machines** (or pressing `Ctrl+Alt+M`) opens a 760×620 dialog on
`popover`:

- Header: **Machines** 17px semibold in `foreground`; `${connected} connected`
  and `${attention} need attention` in 12px `dim` when there is attention;
  a 24×24px refresh `↻`; a 24×24px `×` that closes the dialog.
- A 38px search field under the header: `accent` border, radius 9,
  `background` fill, a 15px `workspace-chrome/search.svg` in `dim`, and an
  auto-focused `Input` with placeholder `Search machines, spaces or tabs…`.
- A scrollable tree, attention first and connected after. Each machine is a
  9px-padded `surface` rounded 8 with a `border`:
  - Header row: a 7px state dot (`blocked` for `needs_login`, `ansi2` for
    connected, `dim` otherwise), name 13px medium in `foreground`, state 11px
    (`blocked` for `needs_login` else `dim`), the target in 11px `dim` (with
    `why` when `hc` gives one), the top agent status and count in the status's
    color, the space count in 10.5px `dim`, then **Go** (first space),
    **Login** / **Retry**, **Install key…** and **Copy**. The status summary
    uses only the spaces currently shown after filtering.
  - Space rows: 30px high, 10px left padding, a 5px status dot, the name 12.5px
    (`muted`, or `foreground` when active), the status word on the right in
    `working`/`blocked`/`done`/`idle` color (or `—`), and `${tabs} tab(s)` in
    10.5px `dim`.
  - Tab rows: 26px high, 28px left padding, a 4px status dot, the tab name
    12px (`dim`, or `foreground` when selected or active), and the tab's own
    status word on the right. A space whose only tab has the same name as the
    space hides that tab row; the space row opens it.
  - The highlighted row uses `selected`; the hovered row uses `hover`. Clicking
    a space row calls `space.select`; clicking a tab row calls `tab.select`.
    With no spaces: `No spaces on this screen.` or `Log in to see its spaces.`
  - Buttons are 26px high, radius 5. Primary is `solid`/`solid_foreground`,
    secondary `raised`/`foreground`; hover dims primary or uses `hover`.
- Footer, 10.5px `dim`: `↑↓ select · Enter open · Esc close` on the left and
  `Login opens hc machine login in a local terminal.` on the right.

The preview uses synthetic `build-box`, `build-01` and `gpu-box` machines; the
running mod reads the real `hc machine ls`.

## How it behaves

- Every 5 seconds it runs `hc machine ls --json`. The first read starts at
  init. The refresh button starts another read immediately. The strip copy and
  an open dialog copy each poll; the dialog copy does not post notifications.
- Temporary machines (`temporary: true`) are left out.
- **Machines** in the strip opens the dialog with `openOverlay({ mod:
  "machine-login", kind: "dialog", width: 760, height: 620 })`. The mod's
  `keys.json` binds `ctrl-alt-m` to `mod.open:machine-login`, so the same dialog
  opens from a key. `mod.json` carries the same 760×620 dialog as its default
  overlay.
- `buildView()` filters the tree. It lowercases `filter`; `matchesQuery` first
  tries every whitespace token as a substring, then as an in-order subsequence.
  A machine matches by name, target or state; a space adds its name and status;
  a tab adds its name, status and each agent's `app`/`title` (from `agents()`).
  A machine match keeps all its spaces and tabs; a space match keeps its tabs;
  a tab match keeps the parent machine and space. Attention machines come
  first. `tabsFor(s, tabs)` drops the redundant single tab whose name equals its
  space's name.
- `pickable()` flattens the tree to space and tab rows for the keyboard.
  `renderList` starts at the active tab (or active space) and clamps `at`.
  `↑`/`↓` move `at` with wraparound; the root's `on_key_down` stops propagation
  so the focused `Input` does not also move its cursor. **Enter** calls
  `openSelected`, which uses `openItem` on the highlighted row. **Esc** and the
  `×` close the dialog.
- `openItem` runs `space.select` for a space or `tab.select` for a tab, then
  calls `close`. The command runs before the overlay closes, so a missing
  overlay id can never swallow the selection. `close` tries the known overlay
  id first, then falls back to `closeOverlay()` and swallows errors.
- **Go** is the same action with the machine's first space; it is hidden when
  that machine has no space on this screen.
- **Install key…** is the permanent fix. It opens a local space named
  `<machine> key` with a `key` tab and this shell, then closes the dialog:

  ```sh
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
  printf '\nInstall key exited %s. Press Enter to close.\n' "$status"
  read _
  ```

  The first existing default public key is installed, then the machine is
  logged in once. The terminal stays open. No private key or password is read
  by the mod; SSH asks for the password itself.
- The dialog's **Copy** writes the same `hc machine login <machine>` and reads
  `Copied` until another copy. The dialog's **×** closes it; Esc closes the
  dialog like any dialog.
- In the strip, every machine whose state is not `connected` gets a row. That
  includes `needs_login`, `unreachable`, `asleep` and unknown states. The button
  reads **Login** for `needs_login` and **Retry** otherwise; both run the same
  `hc machine login`, and the login terminal shows the real SSH error if the
  problem was not authentication. (The dialog lists all machines, connected
  included.)
- When a machine enters `needs_login`, it posts one notification:
  title `<name> needs a login`, body `Click here to log in in a terminal.`,
  level `error`, action `space.new` with the login arguments below. The action
  is an ordinary app command, so Herdr's shipped toast and any custom toast that
  runs actions can use it. While the machine stays in `needs_login`, the notice
  repeats after 10 minutes; when it leaves that state the record is cleared.
- **Login / Retry** calls `run("space.new", ...)` to make a **local** space
  (machine `""`) named `<machine> login`, with a tab named `login`. Its command
  is:

  ```sh
  hc machine login <machine>; code=$?; printf '\nLogin exited %s. Press Enter to close.\n' "$code"; read _
  ```

  Running it in `sh -c` keeps the terminal open after the command, so an error
  or a refused password is readable. The space is local even when the selected
  space is on another machine, so the login terminal is always available.
- **Copy** writes `hc machine login <machine>` to the clipboard. It is the same
  command the shipped Spaces mod offers; this mod adds the button.
- The strip does not switch to the machine, open settings or change the layout.
- No credentials are read, written or cached. The terminal asks; SSH owns the
  prompt.

## Built from

- One mod, `mods/machine-login/`:
  - `mod.json`: `{ "place": "bottom", "size": 34, "title": "Machine login",
    "version": "0.5.0", "overlay": { "kind": "dialog", "width": 760,
    "height": 620 } }`. The first time Herdr sees the folder it docks the strip
    into the shown layout; the overlay is what `mod.open` uses for the list.
  - `keys.json`: `{ "global": { "ctrl-alt-m": "mod.open:machine-login" } }`.
  - `main.js`: imports `View`, `div`, `svg` from `gpui-kit`, `v_flex`,
    `h_flex`, `InputState`, `Input` from `gpui-base`, and `hc`, `notify`,
    `run`, `theme`, `props`, `openOverlay`, `closeOverlay`, `spaces` from
    `herdr`.
    - `shellArg(value)` leaves plain machine names alone and single-quotes
      anything else, escaping embedded single quotes.
    - `commandFor(machine)` returns `hc machine login <quoted>`.
    - `loginArgs(machine)` returns the `space.new` arguments above.
    - `keyArgs(machine, target)` builds the optional `ssh-copy-id` shell above.
    - `init` sets `this.overlay = props()?.overlay`, empty/loading state, a
      5-second `cx.timer.every`, and starts the first read. On the overlay copy
      it also creates the search `InputState`, wires `change`/`submit`, focuses
      it, and focuses it again after 600ms.
    - `refresh` uses `cx.spawn(async (cx) => ...)`, checks `r.code`, parses
      `r.stdout` as JSON, filters temporary machines, calls `notifyLogins` only
      when this is not the overlay copy, and sets `loading`/`error` before
      `cx.notify()`.
    - `notifyLogins` keeps `this.notified` as a per-machine timestamp and posts
      at most one notice per 10 minutes for a machine in `needs_login`.
    - `openList` calls `openOverlay` with the same 760×620 dialog.
    - `spacesFor(machine)` filters `spaces()` by `machine`.
    - `fuzzy(hay, q)` is the in-order subsequence match; `matchesQuery(text, q)`
      is token-substring or token-fuzzy; `tabsFor(s, tabs)` hides a redundant
      single same-name tab; `statusColor(t, status)` maps a status to its theme
      color.
    - `buildView()` returns the attention-first machine tree with filtered
      spaces and tabs; `pickable()` flattens it for the keyboard; `keyOf(row)`
      identifies a space or tab.
    - `openItem(row)` closes first, then runs `space.select` or `tab.select`.
      `openSelected` uses the highlighted `at`; `close` tries the overlay id,
      falls back to `closeOverlay()`, and swallows errors.
    - `button(id, label, primary, tooltip, onClick)` is the shared 26px action
      button; it stops propagation with `cx.stop_propagation()` so a click does
      not also close/select.
    - `row` draws the strip's dot, name, state, Login/Retry, Copy and divider.
    - `renderStrip` chooses checking / error / all-connected / attention, makes
      **Machines** open the list, and always draws the refresh button.
    - `machineHeader` draws the machine dot/name/state/target, the top status
      and count from the filtered spaces, the space count, and the Go / Login /
      Retry / Install key / Copy buttons.
    - `spaceRow` and `tabRow` draw the selectable tree rows, their status words
      and their click handlers (which stop propagation through `cx`). A tab row
      uses `tab.status`; a space row uses `s.status`.
    - `machineBlock` composes a machine with its filtered space and tab rows.
    - `renderList` draws the header, the search field, the scrollable tree and
      the footer; it wires `↑`/`↓`/Esc on the root and starts at the active tab.
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
  separate catalog; use `herdr machine reconnect` for those. Do not assume
  `herdr machine list` sees the same machines.
- **The login wrapper assumes a POSIX shell.** `sh -c` and `read _` work on
  Linux and macOS. On Windows `hc machine login` has no password prompt, so the
  button is not useful there. Do not replace `sh` with the user's interactive
  shell: fish and nushell parse the wrapper differently.
- **The space is deliberately local.** Passing the machine being viewed would
  put the login terminal on the broken machine. `machine: ""` is this computer.
  A local space is created even if the current space is remote.
- **The notification action is `space.new`**, not a mod command. Mod commands
  receive no args through `notify`; using `space.new` keeps the action working
  with the shipped toast and with custom toasts that call `run(action.name,
  action.args)`.
- **Only one copy per layout.** The strip polls while its block is shown, like
  any mod. If the person uses several layouts, add the block to each one; a
  layout without it has no strip and no notifications. The dialog copy also
  polls while open, but it must not post notifications; otherwise opening the
  list could add a second toast.
- **Do not filter out unknown states.** A machine can be `unreachable` or
  `asleep` and still need a login attempt; showing Login/Retry for every
  non-connected state is the safe behavior. The terminal reports the real
  failure.
- **Do not auto-run the login or the key install.** Starting SSH without a
  click would put a credential prompt on screen at arbitrary times. Both actions
  open a terminal only after a click, refresh, or notification action.
- **Install key… is deliberately conservative.** It only appears for
  `needs_login`, a target, and `via: false`. It uses the first of
  `~/.ssh/id_ed25519.pub` and `~/.ssh/id_rsa.pub`, never a private key. A
  custom port, a Host alias `ssh-copy-id` cannot parse, a different key, or
  `ssh-copy-id` not being installed are all left to the person's own terminal;
  the key terminal prints the reason and stays open.
- **Go uses the screen's spaces.** `spaces()` only has the current screen's
  spaces; if the machine has no space there, Go is hidden. The dialog still
  shows the machine and its actions.
- **The dialog is a second copy of the same mod.** It gets `props().overlay`;
  `render` must branch on that. Both copies keep their own `copied` and
  `notified` state. Do not assume the strip's state is visible to the dialog.
- **`ctrl-alt-m` may be taken.** The mod ships it in `keys.json`; the person
  can change or drop it. If it is taken, the app reports the conflict when the
  key is pressed; the Machines label still opens the list.
- **The 10-minute repeat is intentional.** A dismissed notification should not
  hide a machine that still needs a person forever; a successful login clears
  the state and the timer.
- **The refresh button does not clear `notified`.** If a machine is still in
  `needs_login`, a manual refresh must not spam a new toast; the timestamps are
  the throttle.
- **Machine names may contain punctuation.** Always pass them through
  `shellArg` for the wrapper. Never interpolate an unquoted name into a shell
  line.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/machine-login` passes.
- With all machines connected, the strip reads `Machines ● N connected` and the
  ↻ button triggers a fresh read without changing the layout.
- Temporarily forcing one machine to `{ state: "needs_login", target:
  "you@build-box.local", via: false }` shows `Machines ● build-box needs login`
  with **Login** and **Copy**, and posts one notification whose click would run
  the same login.
- Clicking **Machines** (or pressing `Ctrl+Alt+M`) opens the 760×620 dialog.
  Attention is first; the needs-login card shows **Login**, **Install key…** and
  **Copy**. Connected cards show **Copy**, **Go** when they have a space, and
  their space and tab rows; no **Retry** on connected cards.
- Typing a space or tab name (for example `slack`) filters the tree to the
  matching spaces/tabs; **↑/↓** moves the highlight and **Enter** closes the
  dialog and opens the highlighted space or tab. Typing `working`, `blocked`,
  `done` or `idle` filters by status. Multi-word and fuzzy queries match. With
  no match the list says `No machine, space or tab matches.`
- Clicking a space row selects that space; clicking a tab row selects that exact
  tab. Both close the dialog. Clicking **Go** selects the machine's first space.
- Space and tab rows show their live status word on the right, with the status
  color; the machine header shows its top status and count. Filtering to
  `working` changes the machine header's summary to the visible working spaces.
- A space with one tab whose name equals the space name shows no tab row; the
  space row opens that tab.
- Clicking **Login** creates a local space named `build-box login` with a
  `login` tab, and the terminal shows the `(user@host) Password:` prompt (or the
  real SSH error). Closing the space leaves the saved machine untouched.
- Clicking **Install key…** creates a local space named `build-box key` with a
  `key` tab, prompts for the password, runs `ssh-copy-id`, then logs in once
  with `hc machine login`. It reads only the first default public key and keeps
  the terminal open on failure.
- **Copy** puts `hc machine login build-box` on the clipboard and briefly reads
  `Copied`.
- A successful `hc machine login work` changes the strip back to `connected`
  within one poll or one manual refresh.
- Removing the block from the layout removes the strip; deleting the mod folder
  and the `ctrl-alt-m` key leaves layouts, machines and SSH auth untouched.
