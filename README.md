# Machine login for Herdr

A slim strip for the **Herdr desktop app** that watches your saved SSH machines
and offers a **Login** button when one needs authentication. Click it and a
normal local terminal opens inside Herdr running `hc machine login <name>`, so
the password or MFA prompt appears where you are already working. No more
switching to an external terminal and copying the command.

![Machine login](preview.png)

## Why

Herdr reconnects saved machines in the background, where SSH cannot ask for a
password or a code. After sleep, a network change, or an expired MFA approval,
the machine moves to `needs_login` and Herdr shows the CLI command. This mod puts
the missing button next to the message.

It does not store credentials and does not try to answer SSH prompts itself. It
starts the same `hc machine login` command you would run by hand, in a terminal
that can ask.

## What it does

- Adds a 34px **Machines** strip at the bottom of the layout.
- When everything is connected: `Machines ● N connected`.
- When one needs attention: `Machines ● work needs login` with **Login** and
  **Copy** buttons. Several machines scroll horizontally.
- **Login** opens a local space named `<machine> login` and runs
  `hc machine login <machine>`. The terminal stays open after the command so a
  failed login is readable.
- **Copy** copies `hc machine login <machine>` for use in your own terminal.
- Posts a clickable notification when a machine enters `needs_login`. Clicking
  it does the same as **Login**. It repeats after 10 minutes while the machine
  still needs a login, so a dismissed toast is not the end of the story.
- Refreshes every 5 seconds; the ↻ button checks immediately.

## Install

Ask the agent in your Herdr window:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod:
https://github.com/ksajan/herdr-machine-login
```

Or copy it by hand:

```sh
cp -R mods/machine-login ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/machine-login
```

The app docks it at the bottom of the layout shown at install time. If you use
several layouts, add this block to each one:

```json
{
  "id": "machine-login",
  "type": "block",
  "size": { "px": 34 },
  "content": { "mod": "machine-login" }
}
```

Requires the Herdr desktop app and `hc` (herdr-core) on `PATH`. Linux and macOS.
On Windows, `hc machine login` has no password prompt, so this mod's Login
button is not useful there.

## Use

- Click **Login**. Type the password or code when the terminal asks.
- After a successful login, Herdr rechecks the machine within about 30 seconds;
  the strip updates by itself.
- If you already have a terminal open, **Copy** gives you the command.
- If the machine is connected but you want to force a fresh check, click ↻.

## What it runs and reads

- Runs `hc machine ls --json` locally every 5 seconds. No network requests from
  the mod.
- Runs `hc machine login <name>` in a normal terminal when you click Login.
- Posts notifications through Herdr's `notify`.
- Reads no files outside its own folder and stores no credentials.

## Limits

- The strip only runs while its block is in the shown layout. Add the block to
  every layout you use.
- It watches **herdr-core** machines (`hc machine ls`), which is what the app's
  sidebar and spaces use. Machines saved only in the `herdr` TUI are a separate
  catalog; use `herdr machine reconnect` for those.
- The notification action uses `space.new`, so it works with Herdr's shipped
  toast and with custom toasts that run notification actions.
- A machine that is merely unreachable gets the same Login button. It will try
  authentication and then show the actual SSH error in the login terminal.
- The mod quotes machine names for the `sh -c` wrapper; names from `hc` are
  already constrained, but the quoting keeps a renamed machine safe.

## Uninstall

Remove the block from your layouts, or delete the folder:

```sh
rm -rf ~/.config/herdr-app/mods/machine-login
```

Then switch layouts or restart Herdr. The saved machines and their SSH auth are
untouched.

## License

MIT. See [LICENSE](LICENSE).
